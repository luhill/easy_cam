import type { Operation, ToolpathPoint, ToolpathSegment } from '../types/operations';
import type { LoopPoint } from '../types/operations';
import { DEFAULT_SETTINGS } from '../types/operations';
import type { PartBounds } from './geometryProcessing';
import {
  closestPointOnLoop2D,
  offsetLoop2D,
  offsetLoop2DMinkowski,
  signedLoopArea2D,
} from './geometryProcessing';
import { OPERATION_COLORS, getSelectedHoles } from '../types/operations';
import { clampOperationSettings } from './settingLimits';
import { resolveAdaptiveEntryPoint, resolveAdaptiveSlotGeometry } from './adaptiveOutline';
import {
  generateFourZoneAdaptivePath,
  generateOpenTrochoidPath,
  resolveGuideTraverseSign,
  resolveOrbitRotSign,
  wrapPathFromIndex,
} from './adaptiveFourZone';
import {
  buildEntryConnectorGuide,
  closestPointIndexOnPath,
  helixPitchForRadius,
  isGuideOutwardCCW,
  resolveHelixRadius,
  resolveHelixRotationDir,
  resolveSlotHelixRadius,
} from './entryPath';
import { buildArcLengthGuide, findClosestSOnGuide, sampleGuideAtS } from './trochoidalPath';

const MIN_STEP_DOWN = 0.05;
const MAX_Z_LAYERS = 500;
const MAX_TOOLPATH_POINTS = 500_000;

function partTopZ(bounds: PartBounds | null): number {
  return bounds?.maxZ ?? 10;
}

function safeStepDown(stepDown: number): number {
  if (!Number.isFinite(stepDown) || stepDown <= 0) return MIN_STEP_DOWN;
  return Math.max(stepDown, MIN_STEP_DOWN);
}

function computeZLayers(topZ: number, cutZ: number, stepDown: number): number[] {
  const step = safeStepDown(stepDown);
  const layers: number[] = [];
  let currentZ = topZ;

  while (currentZ > cutZ + 1e-6 && layers.length < MAX_Z_LAYERS) {
    currentZ = Math.max(currentZ - step, cutZ);
    layers.push(currentZ);
  }

  return layers;
}

function toolRadius(settings: Operation['settings']): number {
  return Math.max(settings.toolDiameter, 0.1) / 2;
}

function toolCenterlineOffset(settings: Operation['settings']): number {
  return toolRadius(settings) + (settings.radialOffset ?? 0);
}

function getBounds(geometry: Operation['geometry']): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  if (geometry?.loops && geometry.loops.length > 0) {
    const loop = geometry.loops[0];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of loop) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, maxX, minY, maxY };
  }

  const holes = getSelectedHoles(geometry);
  if (holes.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const hole of holes) {
      minX = Math.min(minX, hole.center.x - hole.radius);
      maxX = Math.max(maxX, hole.center.x + hole.radius);
      minY = Math.min(minY, hole.center.y - hole.radius);
      maxY = Math.max(maxY, hole.center.y + hole.radius);
    }
    return { minX, maxX, minY, maxY };
  }

  return { minX: -25, maxX: 25, minY: -25, maxY: 25 };
}

function appendPoints(target: ToolpathPoint[], points: ToolpathPoint[]): boolean {
  if (target.length + points.length > MAX_TOOLPATH_POINTS) {
    target.push(...points.slice(0, MAX_TOOLPATH_POINTS - target.length));
    return false;
  }
  target.push(...points);
  return true;
}

function loopToToolpathPoints(
  loop: LoopPoint[],
  settings: Operation['settings'],
  topZ: number
): ToolpathPoint[] {
  const cutZ = Math.max(topZ - settings.depth, 0);
  const clearance = topZ + settings.clearance;
  const points: ToolpathPoint[] = [];

  if (loop.length === 0) return points;

  const toolLoop = offsetLoop2D(loop, toolCenterlineOffset(settings));
  const ccw = signedLoopArea2D(loop) >= 0;
  const reverse = settings.climbMilling ? ccw : !ccw;
  const traverse = reverse ? [...toolLoop].reverse() : toolLoop;
  const layers = computeZLayers(topZ, cutZ, settings.stepDown);

  const start = traverse[0];
  points.push({ x: start.x, y: start.y, z: clearance, rapid: true });
  points.push({ x: start.x, y: start.y, z: topZ });

  for (const layerZ of layers) {
    for (const p of traverse) {
      points.push({ x: p.x, y: p.y, z: layerZ });
    }
    points.push({ x: traverse[0].x, y: traverse[0].y, z: layerZ });
  }

  points.push({ x: start.x, y: start.y, z: clearance, rapid: true });
  return points;
}

function generateOutlinePath(op: Operation, topZ: number): ToolpathPoint[] {
  const { settings, geometry } = op;

  if (geometry?.loops && geometry.loops.length > 0) {
    return loopToToolpathPoints(geometry.loops[0], settings, topZ);
  }

  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const fallbackLoop: LoopPoint[] = [
    { x: minX, y: minY, z: topZ },
    { x: maxX, y: minY, z: topZ },
    { x: maxX, y: maxY, z: topZ },
    { x: minX, y: maxY, z: topZ },
  ];
  return loopToToolpathPoints(fallbackLoop, settings, topZ);
}

function generateHelixBoreAt(
  center: { x: number; y: number },
  settings: Operation['settings'],
  startZ: number,
  targetZ: number,
  helixR: number
): ToolpathPoint[] {
  const pitch = helixPitchForRadius(helixR, settings.helixAngleDeg);
  const feedRate = settings.helixFeedRate;
  const rotDir = resolveHelixRotationDir(settings.climbMilling);
  const segments = 24;
  const points: ToolpathPoint[] = [];

  let z = startZ;
  let angle = 0;
  let iterations = 0;
  const maxIterations = MAX_Z_LAYERS * segments;

  while (z > targetZ + 1e-6 && iterations < maxIterations) {
    for (let i = 0; i < segments; i++) {
      angle += rotDir * ((Math.PI * 2) / segments);
      z = Math.max(z - pitch / segments, targetZ);
      points.push({
        x: center.x + Math.cos(angle) * helixR,
        y: center.y + Math.sin(angle) * helixR,
        z,
        feedRate,
      });
      iterations++;
    }
  }

  return points;
}

function generateHelixBore(
  entry: { x: number; y: number },
  settings: Operation['settings'],
  topZ: number,
  targetZ: number
): ToolpathPoint[] {
  return generateHelixBoreAt(
    entry,
    settings,
    topZ,
    targetZ,
    resolveHelixRadius(settings)
  );
}

function trochoidParams(
  partLoop: LoopPoint[],
  settings: Operation['settings'],
  slotCenterGuide: LoopPoint[],
  z: number,
  roughing: boolean,
  feedRate?: number
) {
  const slot = resolveAdaptiveSlotGeometry(settings, { roughing });
  const guideSign = resolveGuideTraverseSign(slotCenterGuide, settings.climbMilling);
  return {
    forwardIncrement: slot.forwardIncrement,
    slotClearance: slot.slotClearance,
    z,
    liftAmount: Math.max(settings.liftAmount ?? 0, 0),
    partLoop,
    minCenterDist: slot.minCenterDist,
    rotSign: resolveOrbitRotSign(slotCenterGuide, settings.climbMilling),
    guideSign,
    feedRate,
  };
}

function generateAdaptiveTrochoidalPath(
  partLoop: LoopPoint[],
  settings: Operation['settings'],
  z: number,
  roughing = true,
  startS?: number
): ToolpathPoint[] {
  const slot = resolveAdaptiveSlotGeometry(settings, { roughing });
  const slotCenterGuide = offsetLoop2DMinkowski(partLoop, slot.slotCenterOffset);
  return generateFourZoneAdaptivePath(
    slotCenterGuide,
    { ...trochoidParams(partLoop, settings, slotCenterGuide, z, roughing), startS }
  );
}

function appendGeneratedPath(
  target: ToolpathPoint[],
  generated: ToolpathPoint[]
): boolean {
  if (generated.length === 0) return true;
  const last = target[target.length - 1];
  const start =
    last && Math.hypot(generated[0].x - last.x, generated[0].y - last.y) < 0.12 ? 1 : 0;
  return appendPoints(target, generated.slice(start));
}

function appendPathFromGuideS(
  target: ToolpathPoint[],
  path: ToolpathPoint[],
  guide: ReturnType<typeof buildArcLengthGuide>,
  from: { x: number; y: number }
): boolean {
  if (path.length === 0) return true;
  const { s } = findClosestSOnGuide(guide, from);
  const joinIdx = closestPointIndexOnPath(path, sampleGuideAtS(guide, s));
  const loop = wrapPathFromIndex(path, joinIdx);
  const last = target[target.length - 1];
  const start =
    last && loop.length > 0 && Math.hypot(loop[0].x - last.x, loop[0].y - last.y) < 0.12 ? 1 : 0;
  return appendPoints(target, loop.slice(start));
}

function appendReturnToSlotCenter(
  target: ToolpathPoint[],
  guide: ReturnType<typeof buildArcLengthGuide>,
  joinS: number,
  z: number
): boolean {
  const center = sampleGuideAtS(guide, joinS);
  const last = lastPathPoint(target);
  if (!last) return true;
  if (Math.hypot(last.x - center.x, last.y - center.y) < 0.08) return true;
  return appendPoints(target, [{ x: center.x, y: center.y, z, rapid: true }]);
}

function generateFinishingOutline(
  partLoop: LoopPoint[],
  settings: Operation['settings'],
  layerZ: number
): ToolpathPoint[] {
  const roughSlot = resolveAdaptiveSlotGeometry(settings, { roughing: true });
  const finishSlot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
  const finishGuide = offsetLoop2DMinkowski(partLoop, finishSlot.innerCenterOffset);
  const roughCenterGuide = offsetLoop2DMinkowski(partLoop, roughSlot.slotCenterOffset);
  if (finishGuide.length < 3) return [];

  const sampleSpacing = 0.4;
  const arcGuide = buildArcLengthGuide(finishGuide, sampleSpacing);
  if (arcGuide.totalLength <= 0) return [];

  const guideSign = resolveGuideTraverseSign(finishGuide, settings.climbMilling);
  const steps = Math.max(2, Math.ceil(arcGuide.totalLength / sampleSpacing));
  const pts: ToolpathPoint[] = [];

  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * arcGuide.totalLength;
    const sSample = guideSign >= 0 ? s : arcGuide.totalLength - s;
    const f = sampleGuideAtS(arcGuide, sSample);
    let x = f.x;
    let y = f.y;

    const closest = closestPointOnLoop2D(x, y, partLoop);
    if (closest.dist < finishSlot.minCenterDist - 0.02) {
      x = closest.x + closest.outX * finishSlot.minCenterDist;
      y = closest.y + closest.outY * finishSlot.minCenterDist;
    }

    if (roughCenterGuide.length >= 3) {
      const onRoughGuide = closestPointOnLoop2D(x, y, roughCenterGuide);
      const partAtGuide = closestPointOnLoop2D(onRoughGuide.x, onRoughGuide.y, partLoop);
      const roughEnvelope = partAtGuide.dist - roughSlot.trochoidRadius;
      const atFinish = closestPointOnLoop2D(x, y, partLoop);
      if (atFinish.dist < roughEnvelope - 0.02) {
        x = partAtGuide.x + partAtGuide.outX * roughEnvelope;
        y = partAtGuide.y + partAtGuide.outY * roughEnvelope;
      }
    }

    pts.push({ x, y, z: layerZ });
  }

  if (pts.length > 1) {
    pts.push({ ...pts[0] });
  }
  return pts;
}

function appendVerticalRetract(
  points: ToolpathPoint[],
  clearanceZ: number
): void {
  const last = lastPathPoint(points);
  if (last) {
    points.push({ x: last.x, y: last.y, z: clearanceZ, rapid: true });
  }
}

function lastPathPoint(points: ToolpathPoint[]): { x: number; y: number; z: number } | null {
  if (points.length === 0) return null;
  const p = points[points.length - 1];
  return { x: p.x, y: p.y, z: p.z };
}

function generateAdaptiveOutlinePath(op: Operation, topZ: number): ToolpathPoint[] {
  const { settings, geometry } = op;
  const loop = geometry?.loops?.[0];

  if (!loop) {
    return generateOutlinePath(op, topZ);
  }

  const entry = resolveAdaptiveEntryPoint(loop, settings, geometry?.entryPoint);
  const cutZ = Math.max(topZ - settings.depth, 0);
  const clearance = topZ + settings.clearance;
  const points: ToolpathPoint[] = [];
  const layers = computeZLayers(topZ, cutZ, settings.stepDown);
  const helixFeed = settings.helixFeedRate;
  const roughSlot = resolveAdaptiveSlotGeometry(settings, { roughing: true });
  const slotCenterGuide = offsetLoop2DMinkowski(loop, roughSlot.slotCenterOffset);
  const arcGuide = buildArcLengthGuide(slotCenterGuide, 0.4);
  const join = findClosestSOnGuide(arcGuide, entry);
  const connectorGuide = buildEntryConnectorGuide(entry, slotCenterGuide, join.s);
  const outwardCCW = isGuideOutwardCCW(loop);
  const rotParams = trochoidParams(loop, settings, slotCenterGuide, 0, true, helixFeed);
  const slotHelixR = resolveSlotHelixRadius(roughSlot.slotClearance);

  points.push({ x: entry.x, y: entry.y, z: clearance, rapid: true });
  points.push({ x: entry.x, y: entry.y, z: topZ });

  const helixTarget = layers.length > 0 ? layers[0] : cutZ;
  appendPoints(points, generateHelixBore(entry, settings, topZ, helixTarget));

  for (let li = 0; li < layers.length; li++) {
    const layerZ = layers[li];
    const prevZ = li > 0 ? layers[li - 1] : helixTarget;

    if (li > 0) {
      if (!appendReturnToSlotCenter(points, arcGuide, join.s, prevZ)) break;
      const slotCenter = sampleGuideAtS(arcGuide, join.s);
      if (
        !appendPoints(
          points,
          generateHelixBoreAt(slotCenter, settings, prevZ, layerZ, slotHelixR)
        )
      ) {
        break;
      }
    } else if (Math.abs(layerZ - helixTarget) > 1e-4) {
      if (
        !appendPoints(
          points,
          generateHelixBoreAt(entry, settings, helixTarget, layerZ, resolveHelixRadius(settings))
        )
      ) {
        break;
      }
    }

    if (li === 0) {
      const connectorTroch = generateOpenTrochoidPath(
        connectorGuide,
        { ...rotParams, z: layerZ, liftAmount: 0 },
        outwardCCW
      );
      if (connectorTroch.length > 0) {
        if (!appendGeneratedPath(points, connectorTroch)) break;
      }
    }

    const startS = join.s;
    const troch = generateAdaptiveTrochoidalPath(loop, settings, layerZ, true, startS);
    if (troch.length === 0) continue;

    if (!appendGeneratedPath(points, troch)) break;
  }

  if (settings.finishingPass) {
    const finishZ = layers.length > 0 ? layers[layers.length - 1] : cutZ;
    const finishPath = generateFinishingOutline(loop, settings, finishZ);
    if (finishPath.length > 0) {
      const finishSlot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
      const finishGuide = offsetLoop2DMinkowski(loop, finishSlot.innerCenterOffset);
      const finishArcGuide = buildArcLengthGuide(finishGuide, 0.4);
      const at = lastPathPoint(points);
      if (at) {
        if (!appendPathFromGuideS(points, finishPath, finishArcGuide, at)) {
          appendVerticalRetract(points, clearance);
          return points;
        }
      } else if (!appendPoints(points, finishPath)) {
        appendVerticalRetract(points, clearance);
        return points;
      }
    }
  }

  appendVerticalRetract(points, clearance);
  return points;
}

function generateDrillPathForHole(
  cx: number,
  cy: number,
  settings: Operation['settings'],
  topZ: number,
  cutZ: number,
  clearance: number,
  isFirst: boolean
): ToolpathPoint[] {
  const points: ToolpathPoint[] = [];

  if (isFirst) {
    points.push({ x: cx, y: cy, z: clearance, rapid: true });
  } else {
    points.push({ x: cx, y: cy, z: clearance, rapid: true });
  }
  points.push({ x: cx, y: cy, z: topZ });

  const layers = computeZLayers(topZ, cutZ, settings.stepDown);
  for (const layerZ of layers) {
    points.push({ x: cx, y: cy, z: layerZ });
    points.push({ x: cx, y: cy, z: topZ, rapid: true });
  }

  return points;
}

function generateDrillPath(op: Operation, topZ: number): ToolpathPoint[] {
  const { settings, geometry } = op;
  const holes = getSelectedHoles(geometry);
  if (holes.length === 0) return [];

  const cutZ = Math.max(topZ - settings.depth, 0);
  const clearance = topZ + settings.clearance;
  const points: ToolpathPoint[] = [];

  holes.forEach((hole, index) => {
    appendPoints(
      points,
      generateDrillPathForHole(
        hole.center.x,
        hole.center.y,
        settings,
        topZ,
        cutZ,
        clearance,
        index === 0
      )
    );
  });

  const last = holes[holes.length - 1];
  points.push({ x: last.center.x, y: last.center.y, z: clearance, rapid: true });
  return points;
}

function generateHelixPathForHole(
  cx: number,
  cy: number,
  holeR: number,
  settings: Operation['settings'],
  topZ: number,
  cutZ: number,
  clearance: number,
  isFirst: boolean
): ToolpathPoint[] {
  const cutR = Math.max(holeR - toolRadius(settings), toolRadius(settings) * 0.25);
  const points: ToolpathPoint[] = [];
  const segments = 36;

  if (isFirst) {
    points.push({ x: cx + cutR, y: cy, z: clearance, rapid: true });
  } else {
    points.push({ x: cx, y: cy, z: clearance, rapid: true });
    points.push({ x: cx + cutR, y: cy, z: topZ });
  }

  let currentZ = topZ;
  let angle = 0;
  let iterations = 0;
  const maxIterations = MAX_Z_LAYERS * segments;

  while (currentZ > cutZ + 1e-6 && iterations < maxIterations) {
    const zStep = safeStepDown(settings.stepDown) / segments;
    for (let i = 0; i < segments; i++) {
      angle += (Math.PI * 2) / segments;
      currentZ = Math.max(currentZ - zStep, cutZ);
      points.push({
        x: cx + Math.cos(angle) * cutR,
        y: cy + Math.sin(angle) * cutR,
        z: currentZ,
      });
      iterations++;
    }
  }

  return points;
}

function generateHelixPath(op: Operation, topZ: number): ToolpathPoint[] {
  const { settings, geometry } = op;
  const holes = getSelectedHoles(geometry);
  if (holes.length === 0) return [];

  const cutZ = Math.max(topZ - settings.depth, 0);
  const clearance = topZ + settings.clearance;
  const points: ToolpathPoint[] = [];

  holes.forEach((hole, index) => {
    appendPoints(
      points,
      generateHelixPathForHole(
        hole.center.x,
        hole.center.y,
        hole.radius,
        settings,
        topZ,
        cutZ,
        clearance,
        index === 0
      )
    );
  });

  const last = holes[holes.length - 1];
  points.push({ x: last.center.x, y: last.center.y, z: clearance, rapid: true });
  return points;
}

function generatePocketPath(op: Operation, topZ: number): ToolpathPoint[] {
  const { settings, geometry } = op;
  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const stepover = settings.toolDiameter * (settings.stepover / 100);
  const cutZ = Math.max(topZ - settings.depth, 0);
  const clearance = topZ + settings.clearance;
  const points: ToolpathPoint[] = [];

  points.push({ x: minX, y: minY, z: clearance, rapid: true });
  points.push({ x: minX, y: minY, z: cutZ });

  let y = minY;
  let direction = 1;
  while (y <= maxY) {
    if (direction === 1) {
      points.push({ x: maxX, y, z: cutZ });
    } else {
      points.push({ x: minX, y, z: cutZ });
    }
    y += stepover;
    if (y <= maxY) {
      points.push({ x: direction === 1 ? maxX : minX, y, z: cutZ });
    }
    direction *= -1;
  }

  points.push({ x: minX, y: minY, z: clearance, rapid: true });
  return points;
}

function generateContourPath(op: Operation, topZ: number): ToolpathPoint[] {
  const { settings, geometry } = op;
  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const clearance = topZ + settings.clearance;
  const points: ToolpathPoint[] = [];
  const steps = 20;

  points.push({ x: minX, y: minY, z: clearance, rapid: true });

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = minX + (maxX - minX) * t;
    const wave = Math.sin(t * Math.PI * 4) * 2;
    const currentZ = topZ - settings.depth * t + wave;
    points.push({ x, y: minY + (maxY - minY) * t, z: currentZ });
  }

  points.push({ x: maxX, y: maxY, z: clearance, rapid: true });
  return points;
}

function normalizedSettings(settings: Operation['settings']): Operation['settings'] {
  return clampOperationSettings({ ...DEFAULT_SETTINGS, ...settings });
}

function generatePathForOperation(op: Operation, topZ: number): ToolpathPoint[] {
  const settings = normalizedSettings(op.settings);
  const operation = { ...op, settings };

  switch (operation.type) {
    case 'outline':
      return generateOutlinePath(operation, topZ);
    case 'adaptive-outline':
      return generateAdaptiveOutlinePath(operation, topZ);
    case 'drill':
      return generateDrillPath(operation, topZ);
    case 'helix':
      return generateHelixPath(operation, topZ);
    case 'pocket':
      return generatePocketPath(operation, topZ);
    case 'contour':
      return generateContourPath(operation, topZ);
    default:
      return [];
  }
}

export function generateToolpaths(
  operations: Operation[],
  partBounds: PartBounds | null = null
): ToolpathSegment[] {
  const topZ = partTopZ(partBounds);
  return operations
    .filter((op) => op.enabled)
    .map((op) => ({
      operationId: op.id,
      points: generatePathForOperation(op, topZ),
      color: OPERATION_COLORS[op.type],
    }));
}
