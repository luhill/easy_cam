import type { Operation, ToolpathPoint, ToolpathSegment } from '../types/operations';
import type { LoopPoint } from '../types/operations';
import { loopCentroid } from './geometryProcessing';
import { OPERATION_COLORS } from '../types/operations';

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

  if (geometry?.holeCenter) {
    const r = geometry.holeRadius ?? 2;
    return {
      minX: geometry.holeCenter.x - r,
      maxX: geometry.holeCenter.x + r,
      minY: geometry.holeCenter.y - r,
      maxY: geometry.holeCenter.y + r,
    };
  }

  return { minX: -25, maxX: 25, minY: -25, maxY: 25 };
}

function loopToToolpathPoints(
  loop: LoopPoint[],
  settings: Operation['settings']
): ToolpathPoint[] {
  const cutZ = -settings.depth;
  const clearance = settings.clearance;
  const points: ToolpathPoint[] = [];

  if (loop.length === 0) return points;

  const start = loop[0];
  points.push({ x: start.x, y: start.y, z: clearance, rapid: true });
  points.push({ x: start.x, y: start.y, z: 0 });

  let currentZ = 0;
  while (currentZ > cutZ) {
    currentZ = Math.max(currentZ - settings.stepDown, cutZ);
    for (const p of loop) {
      points.push({ x: p.x, y: p.y, z: currentZ });
    }
    points.push({ x: loop[0].x, y: loop[0].y, z: currentZ });
  }

  points.push({ x: start.x, y: start.y, z: clearance, rapid: true });
  return points;
}

function offsetLoopOutward(loop: LoopPoint[], offset: number): LoopPoint[] {
  const c = loopCentroid(loop);
  return loop.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const scale = (len + offset) / len;
    return { x: c.x + dx * scale, y: c.y + dy * scale, z: p.z };
  });
}

function generateTrochoidalPath(
  loop: LoopPoint[],
  settings: Operation['settings'],
  z: number
): ToolpathPoint[] {
  const toolR = settings.toolDiameter / 2;
  const trochoidR =
    settings.trochoidRadius > 0 ? settings.trochoidRadius : toolR * 0.35;
  const step = Math.max(settings.toolDiameter * (settings.stepover / 100), 0.5);
  const offset = settings.channelClearance + toolR;
  const path = offsetLoopOutward(loop, offset);
  const points: ToolpathPoint[] = [];

  for (let i = 0; i < path.length; i++) {
    const p0 = path[i];
    const p1 = path[(i + 1) % path.length];
    const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const steps = Math.max(2, Math.ceil(segLen / step));

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const mx = p0.x + (p1.x - p0.x) * t;
      const my = p0.y + (p1.y - p0.y) * t;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const phase = t * Math.PI * 4;
      points.push({
        x: mx + nx * trochoidR * Math.sin(phase),
        y: my + ny * trochoidR * Math.sin(phase),
        z,
      });
    }
  }

  return points;
}

function generateOutlinePath(op: Operation): ToolpathPoint[] {
  const { settings, geometry } = op;

  if (geometry?.loops && geometry.loops.length > 0) {
    return loopToToolpathPoints(geometry.loops[0], settings);
  }

  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const cutZ = -settings.depth;
  const clearance = settings.clearance;
  const points: ToolpathPoint[] = [];

  points.push({ x: minX, y: minY, z: clearance, rapid: true });
  points.push({ x: minX, y: minY, z: 0 });

  let currentZ = 0;
  while (currentZ > cutZ) {
    currentZ = Math.max(currentZ - settings.stepDown, cutZ);
    points.push({ x: minX, y: minY, z: currentZ });
    points.push({ x: maxX, y: minY, z: currentZ });
    points.push({ x: maxX, y: maxY, z: currentZ });
    points.push({ x: minX, y: maxY, z: currentZ });
    points.push({ x: minX, y: minY, z: currentZ });
  }

  points.push({ x: minX, y: minY, z: clearance, rapid: true });
  return points;
}

function generateHelixBore(
  entry: { x: number; y: number },
  settings: Operation['settings'],
  targetZ: number
): ToolpathPoint[] {
  const helixR = settings.helixRadius > 0 ? settings.helixRadius : settings.toolDiameter / 2;
  const pitch = settings.helixPitch;
  const segments = 24;
  const points: ToolpathPoint[] = [];

  let z = 0;
  let angle = 0;
  while (z > targetZ) {
    for (let i = 0; i < segments; i++) {
      angle += (Math.PI * 2) / segments;
      z = Math.max(z - pitch / segments, targetZ);
      points.push({
        x: entry.x + Math.cos(angle) * helixR,
        y: entry.y + Math.sin(angle) * helixR,
        z,
      });
    }
  }

  return points;
}

function generateAdaptiveOutlinePath(op: Operation): ToolpathPoint[] {
  const { settings, geometry } = op;
  const loop = geometry?.loops?.[0];
  const entry = geometry?.entryPoint;

  if (!loop || !entry) {
    return generateOutlinePath(op);
  }

  const cutZ = -settings.depth;
  const clearance = settings.clearance;
  const points: ToolpathPoint[] = [];

  points.push({ x: entry.x, y: entry.y, z: clearance, rapid: true });
  points.push({ x: entry.x, y: entry.y, z: 0 });

  points.push(...generateHelixBore(entry, settings, cutZ));

  let layerZ = 0;
  while (layerZ > cutZ) {
    layerZ = Math.max(layerZ - settings.stepDown, cutZ);
    const troch = generateTrochoidalPath(loop, settings, layerZ);
    if (troch.length > 0) {
      points.push({ x: troch[0].x, y: troch[0].y, z: layerZ, rapid: true });
      points.push(...troch);
    }
  }

  points.push({ x: entry.x, y: entry.y, z: clearance, rapid: true });
  return points;
}

function generateDrillPath(op: Operation): ToolpathPoint[] {
  const { settings, geometry } = op;
  const cx = geometry?.holeCenter?.x ?? 0;
  const cy = geometry?.holeCenter?.y ?? 0;
  const cutZ = -settings.depth;
  const clearance = settings.clearance;
  const points: ToolpathPoint[] = [];

  points.push({ x: cx, y: cy, z: clearance, rapid: true });
  points.push({ x: cx, y: cy, z: 0 });

  let currentZ = 0;
  const peckDepth = settings.stepDown;
  while (currentZ > cutZ) {
    currentZ = Math.max(currentZ - peckDepth, cutZ);
    points.push({ x: cx, y: cy, z: currentZ });
    points.push({ x: cx, y: cy, z: 0, rapid: true });
  }

  points.push({ x: cx, y: cy, z: clearance, rapid: true });
  return points;
}

function generateHelixPath(op: Operation): ToolpathPoint[] {
  const { settings, geometry } = op;
  const cx = geometry?.holeCenter?.x ?? 0;
  const cy = geometry?.holeCenter?.y ?? 0;
  const radius = geometry?.holeRadius ?? settings.toolDiameter / 2;
  const cutZ = -settings.depth;
  const clearance = settings.clearance;
  const points: ToolpathPoint[] = [];
  const segments = 36;

  points.push({ x: cx + radius, y: cy, z: clearance, rapid: true });

  let currentZ = 0;
  let angle = 0;
  while (currentZ > cutZ) {
    const zStep = settings.stepDown / segments;
    for (let i = 0; i < segments; i++) {
      angle += (Math.PI * 2) / segments;
      currentZ = Math.max(currentZ - zStep, cutZ);
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
  const cutZ = -settings.depth;
  const clearance = settings.clearance;
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
