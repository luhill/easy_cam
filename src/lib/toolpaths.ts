import type { Operation, ToolpathPoint, ToolpathSegment } from '../types/operations';
import type { LoopPoint } from '../types/operations';
import type { PartBounds } from './geometryProcessing';
import { offsetLoop2D } from './geometryProcessing';
import { OPERATION_COLORS, getSelectedHoles } from '../types/operations';
import { resolveAdaptiveEntryPoint, resolveAdaptiveSlotGeometry } from './adaptiveOutline';
import { generateConstantEngagementTrochoid } from './trochoidalPath';

const MIN_STEP_DOWN = 0.05;
const MAX_Z_LAYERS = 500;
const MAX_TOOLPATH_POINTS = 120_000;

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
  const layers = computeZLayers(topZ, cutZ, settings.stepDown);

  const start = toolLoop[0];
  points.push({ x: start.x, y: start.y, z: clearance, rapid: true });
  points.push({ x: start.x, y: start.y, z: topZ });

  for (const layerZ of layers) {
    for (const p of toolLoop) {
      points.push({ x: p.x, y: p.y, z: layerZ });
    }
    points.push({ x: toolLoop[0].x, y: toolLoop[0].y, z: layerZ });
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

function generateHelixBore(
  entry: { x: number; y: number },
  settings: Operation['settings'],
  topZ: number,
  targetZ: number
): ToolpathPoint[] {
  const helixR = toolRadius(settings);
  const pitch = safeStepDown(settings.stepDown);
  const segments = 24;
  const points: ToolpathPoint[] = [];

  let z = topZ;
  let angle = 0;
  let iterations = 0;
  const maxIterations = MAX_Z_LAYERS * segments;

  while (z > targetZ + 1e-6 && iterations < maxIterations) {
    for (let i = 0; i < segments; i++) {
      angle += (Math.PI * 2) / segments;
      z = Math.max(z - pitch / segments, targetZ);
      points.push({
        x: entry.x + Math.cos(angle) * helixR,
        y: entry.y + Math.sin(angle) * helixR,
        z,
      });
      iterations++;
    }
  }

  return points;
}

function generateAdaptiveTrochoidalPath(
  partLoop: LoopPoint[],
  settings: Operation['settings'],
  z: number
): ToolpathPoint[] {
  const slot = resolveAdaptiveSlotGeometry(settings);
  const innerGuide = offsetLoop2D(partLoop, slot.innerCenterOffset);

  return generateConstantEngagementTrochoid(innerGuide, {
    forwardIncrement: slot.forwardIncrement,
    slotClearance: slot.slotClearance,
    z,
    partLoop,
    minCenterDist: slot.minCenterDist,
    maxCenterDist: slot.maxCenterDist,
  });
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

  points.push({ x: entry.x, y: entry.y, z: clearance, rapid: true });
  points.push({ x: entry.x, y: entry.y, z: topZ });

  appendPoints(points, generateHelixBore(entry, settings, topZ, cutZ));

  const layers = computeZLayers(topZ, cutZ, settings.stepDown);
  for (const layerZ of layers) {
    const troch = generateAdaptiveTrochoidalPath(loop, settings, layerZ);
    if (troch.length > 0) {
      if (!appendPoints(points, [{ ...troch[0], rapid: true }])) break;
      if (!appendPoints(points, troch)) break;
    }
  }

  points.push({ x: entry.x, y: entry.y, z: clearance, rapid: true });
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

function generatePathForOperation(op: Operation, topZ: number): ToolpathPoint[] {
  switch (op.type) {
    case 'outline':
      return generateOutlinePath(op, topZ);
    case 'adaptive-outline':
      return generateAdaptiveOutlinePath(op, topZ);
    case 'drill':
      return generateDrillPath(op, topZ);
    case 'helix':
      return generateHelixPath(op, topZ);
    case 'pocket':
      return generatePocketPath(op, topZ);
    case 'contour':
      return generateContourPath(op, topZ);
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
