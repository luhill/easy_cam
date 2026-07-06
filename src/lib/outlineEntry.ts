import type { LoopPoint, OperationDefaults, SelectedGeometry, ToolpathPoint } from '../types/operations';
import {
  closestPointOnLoop2D,
  offsetLoop2D,
} from './geometryProcessing';
import {
  advanceGuideArcLength,
  buildArcLengthGuide,
  findClosestSOnGuide,
  sampleGuideAtS,
} from './trochoidalPath';
import {
  ensureEntryOutsidePart,
  resolveHelixRadius,
} from './entryPath';

export type OutlineEntryType = 'linear' | 'helix' | 'straight';

export function outlineRampLengthMm(settings: OperationDefaults): number {
  const toolD = Math.max(settings.toolDiameter, 0.1);
  const mult = Math.max(settings.rampLengthToolDiameters ?? 5, 0.1);
  return toolD * mult;
}

function toolRadius(settings: OperationDefaults): number {
  return Math.max(settings.toolDiameter, 0.1) / 2;
}

function innerToolCenterOffset(settings: OperationDefaults, stockAllowance = 0): number {
  return toolRadius(settings) + (settings.radialOffset ?? 0) + stockAllowance;
}

/** Minimum bore-center distance from part outline for standard helix entry. */
export function minimumStandardHelixEntryCenterDist(
  settings: OperationDefaults,
  stockAllowance = 0
): number {
  return innerToolCenterOffset(settings, stockAllowance) + resolveHelixRadius(settings);
}

export interface StandardHelixEntryLayout {
  toolStart: { x: number; y: number };
  joinPoint: { x: number; y: number };
}

export function resolveStandardHelixEntryLayout(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance: number,
  geometry: SelectedGeometry | null | undefined
): StandardHelixEntryLayout | null {
  if (partLoop.length < 2) return null;

  const innerOffset = innerToolCenterOffset(settings, stockAllowance);
  const toolLoop = offsetLoop2D(partLoop, innerOffset);
  if (toolLoop.length < 2) return null;

  const joinOverride = geometry?.slotJoinPoint;
  const joinPoint = joinOverride
    ? (() => {
        const hit = closestPointOnLoop2D(joinOverride.x, joinOverride.y, toolLoop);
        return { x: hit.x, y: hit.y };
      })()
    : { x: toolLoop[0].x, y: toolLoop[0].y };

  const minDist = minimumStandardHelixEntryCenterDist(settings, stockAllowance);
  const helixR = resolveHelixRadius(settings);
  const toolStartOverride = geometry?.toolStartPoint ?? geometry?.entryPoint ?? null;

  if (toolStartOverride) {
    return {
      toolStart: ensureEntryOutsidePart(partLoop, toolStartOverride, minDist),
      joinPoint,
    };
  }

  const outward = closestPointOnLoop2D(joinPoint.x, joinPoint.y, partLoop);
  const candidate = {
    x: joinPoint.x + outward.outX * helixR,
    y: joinPoint.y + outward.outY * helixR,
  };

  return {
    toolStart: ensureEntryOutsidePart(partLoop, candidate, minDist * 0.98),
    joinPoint,
  };
}

/**
 * Forward/backward linear ramp along a closed contour until target Z is reached.
 * Each leg travels rampLength horizontally at rampAngle before reversing direction.
 */
export function generateContourLinearRamp(
  traverse: LoopPoint[],
  startPoint: { x: number; y: number },
  fromZ: number,
  toZ: number,
  rampLengthMm: number,
  rampAngleDeg: number,
  feedRate: number | undefined,
  sampleSpacing: number,
  traverseForward = true
): ToolpathPoint[] {
  if (Math.abs(fromZ - toZ) < 1e-5) {
    return [{ x: startPoint.x, y: startPoint.y, z: toZ, feedRate }];
  }

  const guide = buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  if (guide.totalLength <= 0) {
    return [{ x: startPoint.x, y: startPoint.y, z: toZ, feedRate }];
  }

  const startS = findClosestSOnGuide(guide, startPoint).s;
  const angleRad = (Math.max(rampAngleDeg, 0.5) * Math.PI) / 180;
  const dzPerLeg = rampLengthMm * Math.tan(angleRad);
  if (dzPerLeg < 1e-6) {
    return [{ x: startPoint.x, y: startPoint.y, z: toZ, feedRate }];
  }

  const points: ToolpathPoint[] = [];
  let currentZ = fromZ;
  let currentS = startS;
  let forward = traverseForward;
  let iterations = 0;
  const maxIterations = 5000;

  while (currentZ > toZ + 1e-5 && iterations < maxIterations) {
    const legDz = Math.min(dzPerLeg, currentZ - toZ);
    const legLen = legDz / Math.tan(angleRad);
    const legEndZ = currentZ - legDz;
    const steps = Math.max(1, Math.ceil(legLen / sampleSpacing));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const dist = t * legLen;
      const s = advanceGuideArcLength(guide, currentS, dist, forward);
      const frame = sampleGuideAtS(guide, s);
      points.push({
        x: frame.x,
        y: frame.y,
        z: currentZ - legDz * t,
        feedRate,
      });
      iterations++;
    }

    currentZ = legEndZ;
    currentS = advanceGuideArcLength(guide, currentS, legLen, forward);

    if (currentZ <= toZ + 1e-5) break;
    forward = !forward;
  }

  const endFrame = sampleGuideAtS(guide, startS);
  points.push({ x: endFrame.x, y: endFrame.y, z: toZ, feedRate });
  return points;
}
