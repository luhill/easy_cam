import * as THREE from 'three';
import type { LoopPoint } from '../types/operations';

export interface PartBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface ToolOrigin {
  x: number;
  y: number;
  z: number;
}

export interface ProcessedMesh {
  geometry: THREE.BufferGeometry;
  bounds: PartBounds;
  defaultToolOrigin: ToolOrigin;
}

export function boundsFromGeometry(geometry: THREE.BufferGeometry): PartBounds {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
  };
}

/** Center XY footprint and place bottom of part at Z = 0. */
export function finalizePartPlacement(geometry: THREE.BufferGeometry): ProcessedMesh {
  const geo = geometry;
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const center = new THREE.Vector3();
  box.getCenter(center);
  geo.translate(-center.x, -center.y, -box.min.z);
  geo.computeBoundingBox();

  const finalBox = geo.boundingBox!;
  const bounds: PartBounds = {
    minX: finalBox.min.x,
    maxX: finalBox.max.x,
    minY: finalBox.min.y,
    maxY: finalBox.max.y,
    minZ: finalBox.min.z,
    maxZ: finalBox.max.z,
  };

  const defaultToolOrigin: ToolOrigin = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: bounds.maxZ,
  };

  return { geometry: geo, bounds, defaultToolOrigin };
}

/** Scale to fit, then bottom at Z=0 (Z+ up, part sits on build plate). */
export function processStlGeometry(source: THREE.BufferGeometry): ProcessedMesh {
  const geo = source.clone();
  geo.computeVertexNormals();
  geo.computeBoundingBox();

  const box = geo.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? 50 / maxDim : 1;
  geo.scale(scale, scale, scale);

  return finalizePartPlacement(geo);
}

/**
 * Rotate the model so the chosen face rests on the build plate (Z=0).
 * The face outward normal is aligned to -Z.
 */
export function orientFaceToBottom(
  geometry: THREE.BufferGeometry,
  faceNormal: THREE.Vector3
): THREE.BufferGeometry {
  const geo = geometry.clone();
  const n = faceNormal.clone().normalize();
  const plateNormal = new THREE.Vector3(0, 0, -1);

  const q = new THREE.Quaternion();
  if (n.dot(plateNormal) < 0.999) {
    q.setFromUnitVectors(n, plateNormal);
  }

  const positions = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    v.fromBufferAttribute(positions, i);
    v.applyQuaternion(q);
    positions.setXYZ(i, v.x, v.y, v.z);
  }
  positions.needsUpdate = true;
  geo.computeVertexNormals();

  return geo;
}

export function loopCentroid(loop: LoopPoint[]): LoopPoint {
  if (loop.length === 0) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of loop) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = loop.length;
  return { x: x / n, y: y / n, z: z / n };
}

export function loopArea2D(loop: LoopPoint[]): number {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

export function pointInPolygon2D(x: number, y: number, loop: LoopPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i].x;
    const yi = loop[i].y;
    const xj = loop[j].x;
    const yj = loop[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function signedLoopArea2D(loop: LoopPoint[]): number {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Offset a closed XY loop outward (positive offset) using vertex bisectors. */
export function offsetLoop2D(loop: LoopPoint[], offset: number): LoopPoint[] {
  const n = loop.length;
  if (n < 3 || Math.abs(offset) < 1e-9) return loop.map((p) => ({ ...p }));

  const ccw = signedLoopArea2D(loop) >= 0;
  const side = ccw ? 1 : -1;
  const result: LoopPoint[] = [];

  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const curr = loop[i];
    const next = loop[(i + 1) % n];

    const e1x = curr.x - prev.x;
    const e1y = curr.y - prev.y;
    const e2x = next.x - curr.x;
    const e2y = next.y - curr.y;
    const len1 = Math.hypot(e1x, e1y) || 1;
    const len2 = Math.hypot(e2x, e2y) || 1;

    const n1x = side * (e1y / len1);
    const n1y = side * (-e1x / len1);
    const n2x = side * (e2y / len2);
    const n2y = side * (-e2x / len2);

    let bx = n1x + n2x;
    let by = n1y + n2y;
    const blen = Math.hypot(bx, by);
    if (blen < 1e-8) {
      bx = n1x;
      by = n1y;
    } else {
      bx /= blen;
      by /= blen;
    }

    const dot = bx * n1x + by * n1y;
    const miter = dot > 0.05 ? offset / dot : offset;
    const clamped = Math.sign(miter) * Math.min(Math.abs(miter), Math.abs(offset) * 6);

    result.push({
      x: curr.x + bx * clamped,
      y: curr.y + by * clamped,
      z: curr.z,
    });
  }

  return result;
}

export function closestPointOnLoop2D(
  x: number,
  y: number,
  loop: LoopPoint[]
): { x: number; y: number; dist: number; outX: number; outY: number } {
  if (loop.length === 0) return { x, y, dist: 0, outX: 1, outY: 0 };

  let bestPx = loop[0].x;
  let bestPy = loop[0].y;
  let bestDist = Infinity;
  let bestOutX = 1;
  let bestOutY = 0;

  const ccw = signedLoopArea2D(loop) >= 0;
  const side = ccw ? 1 : -1;

  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq)) : 0;
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const dist = Math.hypot(x - px, y - py);
    if (dist < bestDist) {
      bestDist = dist;
      bestPx = px;
      bestPy = py;
      const elen = Math.hypot(dx, dy) || 1;
      bestOutX = side * (dy / elen);
      bestOutY = side * (-dx / elen);
    }
  }

  if (bestDist > 1e-9) {
    bestOutX = (x - bestPx) / bestDist;
    bestOutY = (y - bestPy) / bestDist;
  } else if (pointInPolygon2D(x, y, loop)) {
    bestDist = 0;
  }

  return { x: bestPx, y: bestPy, dist: bestDist, outX: bestOutX, outY: bestOutY };
}

/** Keep tool center in the exterior band: toolRadius+offset … offset+slotWidth-toolRadius from part. */
export function clampToolCenterToExteriorBand(
  partLoop: LoopPoint[],
  x: number,
  y: number,
  minDist: number,
  maxDist: number
): { x: number; y: number } {
  const closest = closestPointOnLoop2D(x, y, partLoop);
  const clampedDist = Math.max(minDist, Math.min(maxDist, closest.dist));
  return {
    x: closest.x + closest.outX * clampedDist,
    y: closest.y + closest.outY * clampedDist,
  };
}

export function distanceToLoop2D(x: number, y: number, loop: LoopPoint[]): number {
  if (loop.length === 0) return Infinity;
  if (pointInPolygon2D(x, y, loop)) return 0;

  let minDist = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lenSq)) : 0;
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    minDist = Math.min(minDist, Math.hypot(x - px, y - py));
  }
  return minDist;
}
