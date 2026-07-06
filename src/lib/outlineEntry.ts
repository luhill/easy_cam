import type { LoopPoint, OperationDefaults, SelectedGeometry, ToolpathPoint } from '../types/operations';
import type { ToolOrigin } from './geometryProcessing';
import {
  closestPointOnLoop2D,
  offsetLoop2DMinkowski,
  signedLoopArea2D,
} from './geometryProcessing';
import {
  advanceGuideArcLength,
  buildArcLengthGuide,
  findClosestSOnGuide,
  sampleGuideAtS,
  type ArcLengthGuide,
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

/** Entry / ramp start height above stock top — min(global safe height, Z start offset). */
export function outlineApproachWorldZ(
  stockTopZ: number,
  safeHeight: number,
  zStartOffset: number
): number {
  return stockTopZ + Math.min(Math.max(safeHeight, 0), Math.max(zStartOffset, 0));
}

function toolRadius(settings: OperationDefaults): number {
  return Math.max(settings.toolDiameter, 0.1) / 2;
}

function innerToolCenterOffset(settings: OperationDefaults, stockAllowance = 0): number {
  return toolRadius(settings) + (settings.radialOffset ?? 0) + stockAllowance;
}

export function buildOutlineToolCenterline(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance = 0,
  maxSegmentLen = 0.3
): LoopPoint[] {
  const offset = innerToolCenterOffset(settings, stockAllowance);
  const toolLoop = offsetLoop2DMinkowski(partLoop, offset, maxSegmentLen);
  const ccw = signedLoopArea2D(partLoop) >= 0;
  const reverse = settings.climbMilling ? ccw : !ccw;
  return reverse ? [...toolLoop].reverse() : toolLoop;
}

export function buildOutlineEntryArcGuide(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance: number,
  sampleSpacing: number
): ArcLengthGuide {
  return buildArcLengthGuide(
    buildOutlineToolCenterline(partLoop, settings, stockAllowance),
    Math.max(sampleSpacing, 0.25)
  );
}

export type ToolOriginXY = Pick<ToolOrigin, 'x' | 'y'>;

/** Closest point on a closed loop to the tool origin XY. */
export function closestPointOnLoopToOrigin(
  loop: LoopPoint[],
  origin: ToolOriginXY,
  sampleSpacing = 0.25
): { x: number; y: number } {
  if (loop.length === 0) return { x: origin.x, y: origin.y };
  const guide = buildArcLengthGuide(loop, Math.max(sampleSpacing, 0.25));
  if (guide.totalLength <= 0) return { x: loop[0].x, y: loop[0].y };
  const hit = findClosestSOnGuide(guide, origin);
  const frame = sampleGuideAtS(guide, hit.s);
  return { x: frame.x, y: frame.y };
}

/** Contour point where linear ramp, straight plunge, or helix tangent begins. */
export function resolveStandardOutlineEntryStart(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance: number,
  geometry: SelectedGeometry | null | undefined,
  toolOrigin?: ToolOriginXY | null
): { x: number; y: number } {
  const traverse = buildOutlineToolCenterline(partLoop, settings, stockAllowance);
  if (traverse.length === 0) return { x: toolOrigin?.x ?? 0, y: toolOrigin?.y ?? 0 };

  const override = geometry?.toolStartPoint ?? geometry?.entryPoint ?? null;
  if (override) {
    const hit = closestPointOnLoop2D(override.x, override.y, traverse);
    return { x: hit.x, y: hit.y };
  }

  if (toolOrigin) {
    return closestPointOnLoopToOrigin(traverse, toolOrigin);
  }

  return { x: traverse[0].x, y: traverse[0].y };
}

export function snapStandardOutlineEntryPoint(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance: number,
  point: { x: number; y: number },
  sampleSpacing: number
): { x: number; y: number } {
  const guide = buildOutlineEntryArcGuide(partLoop, settings, stockAllowance, sampleSpacing);
  const hit = findClosestSOnGuide(guide, point);
  const frame = sampleGuideAtS(guide, hit.s);
  return { x: frame.x, y: frame.y };
}

/** Minimum bore-center distance from part outline for standard helix entry. */
export function minimumStandardHelixEntryCenterDist(
  settings: OperationDefaults,
  stockAllowance = 0
): number {
  return innerToolCenterOffset(settings, stockAllowance) + resolveHelixRadius(settings);
}

export interface StandardHelixEntryLayout {
  entryStart: { x: number; y: number };
  toolStart: { x: number; y: number };
  joinPoint: { x: number; y: number };
}

export function resolveStandardHelixEntryLayout(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance: number,
  geometry: SelectedGeometry | null | undefined,
  toolOrigin?: ToolOriginXY | null
): StandardHelixEntryLayout | null {
  if (partLoop.length < 2) return null;

  const entryStart = resolveStandardOutlineEntryStart(
    partLoop,
    settings,
    stockAllowance,
    geometry,
    toolOrigin
  );
  const joinPoint = entryStart;
  const minDist = minimumStandardHelixEntryCenterDist(settings, stockAllowance);
  const helixR = resolveHelixRadius(settings);

  const outward = closestPointOnLoop2D(joinPoint.x, joinPoint.y, partLoop);
  const candidate = {
    x: joinPoint.x + outward.outX * helixR,
    y: joinPoint.y + outward.outY * helixR,
  };

  return {
    entryStart,
    toolStart: ensureEntryOutsidePart(partLoop, candidate, minDist * 0.98),
    joinPoint,
  };
}

export interface ContourRampResult {
  points: ToolpathPoint[];
  endPoint: { x: number; y: number };
  endS: number;
}

export function stationOnContour(
  traverse: LoopPoint[],
  point: { x: number; y: number },
  sampleSpacing: number
): number {
  const guide = buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  if (guide.totalLength <= 0) return 0;
  return findClosestSOnGuide(guide, point).s;
}

/** One contour loop sampled by arc length, starting at startS for up to arcLengthToCut. */
export function sampleContourLoopFromArcS(
  traverse: LoopPoint[],
  layerZ: number,
  feedRate: number,
  startS: number,
  sampleSpacing: number,
  forward = true,
  skipNear?: { x: number; y: number; z: number },
  arcLengthToCut?: number
): ToolpathPoint[] {
  const guide = buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  const total = guide.totalLength;
  if (total <= 0) return [];

  const cutLength = Math.min(Math.max(arcLengthToCut ?? total, 0), total);
  if (cutLength <= 1e-6) return [];

  const steps = Math.max(8, Math.ceil(cutLength / sampleSpacing));
  const points: ToolpathPoint[] = [];
  const startFrame = sampleGuideAtS(guide, startS);

  const skipFirstSample =
    !!skipNear &&
    Math.hypot(skipNear.x - startFrame.x, skipNear.y - startFrame.y) <
      sampleSpacing * 0.75 &&
    Math.abs(skipNear.z - layerZ) < 1e-4;

  if (!skipFirstSample) {
    points.push({
      x: startFrame.x,
      y: startFrame.y,
      z: layerZ,
      feedRate,
    });
  }

  for (let i = 1; i <= steps; i++) {
    const delta = (i / steps) * cutLength;
    const s = forward
      ? advanceGuideArcLength(guide, startS, delta, true)
      : advanceGuideArcLength(guide, startS, delta, false);
    const frame = sampleGuideAtS(guide, s);
    points.push({ x: frame.x, y: frame.y, z: layerZ, feedRate });
  }

  return points;
}

/** Walk along the contour between two XY points at constant Z (no straight chord). */
export function sampleContourTravelBetween(
  traverse: LoopPoint[],
  from: { x: number; y: number },
  to: { x: number; y: number },
  z: number,
  feedRate: number,
  sampleSpacing: number,
  forward = true
): ToolpathPoint[] {
  const guide = buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  const total = guide.totalLength;
  if (total <= 0) return [];

  const fromS = findClosestSOnGuide(guide, from).s;
  const toS = findClosestSOnGuide(guide, to).s;
  const toFrame = sampleGuideAtS(guide, toS);

  if (Math.hypot(from.x - toFrame.x, from.y - toFrame.y) < sampleSpacing * 0.75) {
    return [];
  }

  let arcLen = forward
    ? toS >= fromS - 1e-6
      ? toS - fromS
      : total - fromS + toS
    : fromS >= toS - 1e-6
      ? fromS - toS
      : fromS + total - toS;

  if (arcLen < 1e-3) return [];

  const steps = Math.max(1, Math.ceil(arcLen / sampleSpacing));
  const points: ToolpathPoint[] = [];

  for (let i = 1; i <= steps; i++) {
    const dist = (i / steps) * arcLen;
    const s = advanceGuideArcLength(guide, fromS, dist, forward);
    const frame = sampleGuideAtS(guide, s);
    points.push({ x: frame.x, y: frame.y, z, feedRate });
  }

  return points;
}

/**
 * Forward/backward linear ramp along a closed contour until target Z is reached.
 * Ends on the contour where the ramp finishes — not snapped back to the start station.
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
): ContourRampResult {
  if (Math.abs(fromZ - toZ) < 1e-5) {
    const s = findClosestSOnGuide(
      buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25)),
      startPoint
    ).s;
    return {
      points: [{ x: startPoint.x, y: startPoint.y, z: toZ, feedRate }],
      endPoint: { x: startPoint.x, y: startPoint.y },
      endS: s,
    };
  }

  const guide = buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  if (guide.totalLength <= 0) {
    return {
      points: [{ x: startPoint.x, y: startPoint.y, z: toZ, feedRate }],
      endPoint: { x: startPoint.x, y: startPoint.y },
      endS: 0,
    };
  }

  const startS = findClosestSOnGuide(guide, startPoint).s;
  const angleRad = (Math.max(rampAngleDeg, 0.5) * Math.PI) / 180;
  const dzPerLeg = rampLengthMm * Math.tan(angleRad);
  if (dzPerLeg < 1e-6) {
    return {
      points: [{ x: startPoint.x, y: startPoint.y, z: toZ, feedRate }],
      endPoint: { x: startPoint.x, y: startPoint.y },
      endS: startS,
    };
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

  const endFrame = sampleGuideAtS(guide, currentS);
  const endPoint = { x: endFrame.x, y: endFrame.y };
  const last = points[points.length - 1];
  if (
    !last ||
    Math.hypot(last.x - endPoint.x, last.y - endPoint.y) > 1e-4 ||
    Math.abs(last.z - toZ) > 1e-4
  ) {
    points.push({ x: endPoint.x, y: endPoint.y, z: toZ, feedRate });
  }

  return { points, endPoint, endS: currentS };
}
