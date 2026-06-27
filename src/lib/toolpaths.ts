import type { Operation, ToolpathPoint, ToolpathSegment } from '../types/operations';
import { OPERATION_COLORS } from '../types/operations';

function getBounds(geometry: Operation['geometry']): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  if (!geometry || geometry.vertexIndices.length === 0) {
    return { minX: -25, maxX: 25, minY: -25, maxY: 25 };
  }
  const spread = 10 + geometry.vertexIndices.length * 2;
  const cx = (geometry.vertexIndices[0] % 10) * 3 - 15;
  const cy = Math.floor(geometry.vertexIndices[0] / 10) * 3 - 15;
  return {
    minX: cx - spread / 2,
    maxX: cx + spread / 2,
    minY: cy - spread / 2,
    maxY: cy + spread / 2,
  };
}

function generateOutlinePath(op: Operation): ToolpathPoint[] {
  const { settings, geometry } = op;
  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const z = -settings.depth;
  const clearance = settings.clearance;
  const points: ToolpathPoint[] = [];

  points.push({ x: minX, y: minY, z: clearance, rapid: true });
  points.push({ x: minX, y: minY, z: 0 });
  points.push({ x: minX, y: minY, z });

  let currentZ = 0;
  while (currentZ > z) {
    currentZ = Math.max(currentZ - settings.stepDown, z);
    points.push({ x: minX, y: minY, z: currentZ });
    points.push({ x: maxX, y: minY, z: currentZ });
    points.push({ x: maxX, y: maxY, z: currentZ });
    points.push({ x: minX, y: maxY, z: currentZ });
    points.push({ x: minX, y: minY, z: currentZ });
  }

  points.push({ x: minX, y: minY, z: clearance, rapid: true });
  return points;
}

function generateAdaptiveOutlinePath(op: Operation): ToolpathPoint[] {
  const base = generateOutlinePath(op);
  const { settings, geometry } = op;
  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const inset = settings.toolDiameter * (settings.stepover / 100);
  const points: ToolpathPoint[] = [...base];

  let x0 = minX + inset;
  let y0 = minY + inset;
  let x1 = maxX - inset;
  let y1 = maxY - inset;

  while (x1 - x0 > inset * 2) {
    const z = -settings.depth;
    points.push({ x: x0, y: y0, z, rapid: true });
    points.push({ x: x1, y: y0, z });
    points.push({ x: x1, y: y1, z });
    points.push({ x: x0, y: y1, z });
    points.push({ x: x0, y: y0, z });
    x0 += inset;
    y0 += inset;
    x1 -= inset;
    y1 -= inset;
  }

  return points;
}

function generateDrillPath(op: Operation): ToolpathPoint[] {
  const { settings, geometry } = op;
  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const z = -settings.depth;
  const clearance = settings.clearance;
  const points: ToolpathPoint[] = [];

  points.push({ x: cx, y: cy, z: clearance, rapid: true });
  points.push({ x: cx, y: cy, z: 0 });

  let currentZ = 0;
  const peckDepth = settings.stepDown;
  while (currentZ > z) {
    currentZ = Math.max(currentZ - peckDepth, z);
    points.push({ x: cx, y: cy, z: currentZ });
    points.push({ x: cx, y: cy, z: 0, rapid: true });
  }

  points.push({ x: cx, y: cy, z: clearance, rapid: true });
  return points;
}

function generateHelixPath(op: Operation): ToolpathPoint[] {
  const { settings, geometry } = op;
  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const radius = settings.toolDiameter / 2;
  const z = -settings.depth;
  const clearance = settings.clearance;
  const points: ToolpathPoint[] = [];
  const segments = 36;

  points.push({ x: cx + radius, y: cy, z: clearance, rapid: true });

  let currentZ = 0;
  let angle = 0;
  while (currentZ > z) {
    const zStep = settings.stepDown / segments;
    for (let i = 0; i < segments; i++) {
      angle += (Math.PI * 2) / segments;
      currentZ = Math.max(currentZ - zStep, z);
      points.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        z: currentZ,
      });
    }
  }

  points.push({ x: cx, y: cy, z: clearance, rapid: true });
  return points;
}

function generatePocketPath(op: Operation): ToolpathPoint[] {
  const { settings, geometry } = op;
  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const stepover = settings.toolDiameter * (settings.stepover / 100);
  const z = -settings.depth;
  const clearance = settings.clearance;
  const points: ToolpathPoint[] = [];

  points.push({ x: minX, y: minY, z: clearance, rapid: true });
  points.push({ x: minX, y: minY, z });

  let y = minY;
  let direction = 1;
  while (y <= maxY) {
    if (direction === 1) {
      points.push({ x: maxX, y, z });
    } else {
      points.push({ x: minX, y, z });
    }
    y += stepover;
    if (y <= maxY) {
      points.push({ x: direction === 1 ? maxX : minX, y, z });
    }
    direction *= -1;
  }

  points.push({ x: minX, y: minY, z: clearance, rapid: true });
  return points;
}

function generateContourPath(op: Operation): ToolpathPoint[] {
  const { settings, geometry } = op;
  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const clearance = settings.clearance;
  const points: ToolpathPoint[] = [];
  const steps = 20;

  points.push({ x: minX, y: minY, z: clearance, rapid: true });

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = minX + (maxX - minX) * t;
    const wave = Math.sin(t * Math.PI * 4) * 2;
    const currentZ = wave - settings.depth * t;
    points.push({ x, y: minY + (maxY - minY) * t, z: currentZ });
  }

  points.push({ x: maxX, y: maxY, z: clearance, rapid: true });
  return points;
}

function generatePathForOperation(op: Operation): ToolpathPoint[] {
  switch (op.type) {
    case 'outline':
      return generateOutlinePath(op);
    case 'adaptive-outline':
      return generateAdaptiveOutlinePath(op);
    case 'drill':
      return generateDrillPath(op);
    case 'helix':
      return generateHelixPath(op);
    case 'pocket':
      return generatePocketPath(op);
    case 'contour':
      return generateContourPath(op);
    default:
      return [];
  }
}

export function generateToolpaths(operations: Operation[]): ToolpathSegment[] {
  return operations
    .filter((op) => op.enabled)
    .map((op) => ({
      operationId: op.id,
      points: generatePathForOperation(op),
      color: OPERATION_COLORS[op.type],
    }));
}
