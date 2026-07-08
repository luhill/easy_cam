import * as THREE from 'three';
import ClipperLib from 'clipper-lib';
import { mergeVertices } from 'three-stdlib';
import type { LoopPoint, SelectedGeometry } from '../types/operations';
import { offsetClosedLoop2D, CLIPPER_SCALE } from './polygonOffset';

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
  const welded = mergeVertices(geometry, 1e-4);
  welded.computeVertexNormals();
  const geo = welded;
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
    z: 10,
  };

  return { geometry: geo, bounds, defaultToolOrigin };
}

/** Import STL coordinates as millimeters, then bottom at Z=0 (Z+ up, part on build plate). */
export function processStlGeometry(source: THREE.BufferGeometry): ProcessedMesh {
  const geo = source.clone();
  geo.computeVertexNormals();
  return finalizePartPlacement(geo);
}

export function partDimensionsFromBounds(bounds: PartBounds): {
  width: number;
  depth: number;
  height: number;
} {
  return {
    width: Math.max(bounds.maxX - bounds.minX, 0),
    depth: Math.max(bounds.maxY - bounds.minY, 0),
    height: Math.max(bounds.maxZ - bounds.minZ, 0),
  };
}

export function partBoundsEqual(a: PartBounds | null, b: PartBounds | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.minX === b.minX &&
    a.maxX === b.maxX &&
    a.minY === b.minY &&
    a.maxY === b.maxY &&
    a.minZ === b.minZ &&
    a.maxZ === b.maxZ
  );
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

/** Wrap degrees to [0, 360). */
export function normalizeRotationDegrees(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped >= 360 - 1e-9 ? 0 : wrapped;
}

/** Snap rotation to fixed degree intervals (default 15°). */
export function snapRotationDegrees(deg: number, step = 15): number {
  const wrapped = normalizeRotationDegrees(deg);
  const snapped = Math.round(wrapped / step) * step;
  return snapped >= 360 ? 0 : snapped;
}

/** Rotate all vertices around the Z axis (degrees). Mutates geometry in place. */
export function rotateGeometryAroundZ(geometry: THREE.BufferGeometry, angleDeg: number): void {
  if (Math.abs(angleDeg) < 1e-9) return;
  const rad = (angleDeg * Math.PI) / 180;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    v.fromBufferAttribute(positions, i);
    v.applyQuaternion(q);
    positions.setXYZ(i, v.x, v.y, v.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
}

export function rotatePoint2D(x: number, y: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function rotateLoopPoints(points: LoopPoint[], angleDeg: number): LoopPoint[] {
  return points.map((p) => {
    const { x, y } = rotatePoint2D(p.x, p.y, angleDeg);
    return { x, y, z: p.z };
  });
}

/** Rotate stored operation geometry to match a part Z rotation. Face indices are cleared. */
export function rotateSelectedGeometry(
  geometry: SelectedGeometry,
  angleDeg: number
): SelectedGeometry {
  const rot = (p: { x: number; y: number }) => rotatePoint2D(p.x, p.y, angleDeg);

  return {
    ...geometry,
    faceIndices: [],
    vertexIndices: [],
    loops: geometry.loops?.map((loop) => rotateLoopPoints(loop, angleDeg)),
    holes: geometry.holes?.map((hole) => ({
      ...hole,
      center: { ...hole.center, ...rot(hole.center) },
      loop: hole.loop ? rotateLoopPoints(hole.loop, angleDeg) : undefined,
    })),
    toolStartPoint: geometry.toolStartPoint
      ? { ...geometry.toolStartPoint, ...rot(geometry.toolStartPoint) }
      : undefined,
    slotJoinPoint: geometry.slotJoinPoint
      ? { ...geometry.slotJoinPoint, ...rot(geometry.slotJoinPoint) }
      : undefined,
    entryPoint: geometry.entryPoint
      ? { ...geometry.entryPoint, ...rot(geometry.entryPoint) }
      : undefined,
  };
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
    result.push(offsetMiterVertex(prev, curr, next, offset, side));
  }

  return result;
}

/** Outward miter point for one loop vertex at a given tool-center offset. */
export function offsetVertexMiter(
  loop: LoopPoint[],
  vertexIndex: number,
  offset: number
): LoopPoint {
  const n = loop.length;
  const prev = loop[(vertexIndex - 1 + n) % n];
  const curr = loop[vertexIndex];
  const next = loop[(vertexIndex + 1) % n];
  const ccw = signedLoopArea2D(loop) >= 0;
  const side = ccw ? 1 : -1;
  return offsetMiterVertex(prev, curr, next, offset, side);
}

export function offsetMiterVertex(
  prev: LoopPoint,
  curr: LoopPoint,
  next: LoopPoint,
  offset: number,
  side: number,
  options: { clampToEdge?: boolean } = {}
): LoopPoint {
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
  const edgeLimit = Math.min(len1, len2) * 0.48;
  const clampToEdge = options.clampToEdge !== false;
  const maxDist = clampToEdge
    ? Math.min(Math.abs(offset) * 6, edgeLimit > 1e-6 ? edgeLimit : Math.abs(offset) * 6)
    : Math.abs(offset) * 6;
  const clamped = Math.sign(miter) * Math.min(Math.abs(miter), maxDist);

  return {
    x: curr.x + bx * clamped,
    y: curr.y + by * clamped,
    z: curr.z,
  };
}

/**
 * Exact offset-path vertex at a concave corner — intersection of the two offset edge lines.
 * Prefer over bisector extrapolation so spur tips land on the finish-inner miter, not past it.
 */
export function offsetConcaveMiter(
  prev: LoopPoint,
  curr: LoopPoint,
  next: LoopPoint,
  offset: number,
  side: number
): LoopPoint {
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

  const p1x = curr.x + n1x * offset;
  const p1y = curr.y + n1y * offset;
  const p2x = curr.x + n2x * offset;
  const p2y = curr.y + n2y * offset;

  const denom = e1x * e2y - e1y * e2x;
  if (Math.abs(denom) < 1e-10) {
    return offsetMiterVertex(prev, curr, next, offset, side);
  }

  const dx = p2x - p1x;
  const dy = p2y - p1y;
  const t = (dx * e2y - dy * e2x) / denom;

  return {
    x: p1x + e1x * t,
    y: p1y + e1y * t,
    z: curr.z,
  };
}

export function outwardEdgeNormal2D(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  side: number
): { nx: number; ny: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: side * (dy / len), ny: side * (-dx / len) };
}

export type OutlineWallSide = 'exterior' | 'interior';

/** Exterior walls CCW, interior void walls CW — matches Clipper offset contract. */
export function normalizeOutlineLoopWinding(
  loop: LoopPoint[],
  wallSide: OutlineWallSide
): LoopPoint[] {
  if (loop.length < 3) return loop;
  const ccw = signedLoopArea2D(loop) >= 0;
  if (wallSide === 'exterior' && !ccw) return [...loop].reverse();
  if (wallSide === 'interior' && ccw) return [...loop].reverse();
  return loop;
}

export function partCentroidXY(bounds: PartBounds): { x: number; y: number } {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

/** +1 or −1 so offset moves away from selected wall faces (given normalized winding). */
export function resolveWallOutwardOffsetSign(
  _loop: LoopPoint[],
  _wallNormalX: number,
  _wallNormalY: number,
  wallSide: OutlineWallSide = 'exterior'
): number {
  return wallSide === 'interior' ? -1 : 1;
}

/** Ray cast from (px, py) toward +X; count edge crossings (even-odd test). */
export function horizontalRayCrossings(px: number, py: number, loop: LoopPoint[]): number {
  let crossings = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if ((a.y > py) !== (b.y > py)) {
      const xInt = a.x + ((py - a.y) * (b.x - a.x)) / (b.y - a.y + 1e-12);
      if (xInt > px) crossings++;
    }
  }
  return crossings;
}

export function isPointInsideLoopByRay(px: number, py: number, loop: LoopPoint[]): boolean {
  return horizontalRayCrossings(px, py, loop) % 2 === 1;
}

/**
 * Classify wall side by loop nesting: shoot a ray from the loop centroid and test
 * whether that center lies inside other loops. Walk up the parent chain via the
 * smallest-area enclosing loop with strictly larger area — even depth is an
 * exterior material boundary, odd depth is an interior void wall.
 */
export function resolveOutlineWallSideByNesting(
  loop: LoopPoint[],
  allLoops: LoopPoint[][],
  loopIndex: number,
  _wallNormalX = 0,
  _wallNormalY = 0
): OutlineWallSide {
  if (loop.length < 3) return 'exterior';

  let depth = 0;
  let currentIndex = loopIndex;
  let currentArea = loopArea2D(loop);

  while (true) {
    const currentCenter = loopCentroid(allLoops[currentIndex]);
    let parentIndex = -1;
    let parentArea = Infinity;

    for (let j = 0; j < allLoops.length; j++) {
      if (j === currentIndex) continue;
      const otherArea = loopArea2D(allLoops[j]);
      if (otherArea <= currentArea) continue;
      if (!isPointInsideLoopByRay(currentCenter.x, currentCenter.y, allLoops[j])) continue;
      if (otherArea < parentArea) {
        parentArea = otherArea;
        parentIndex = j;
      }
    }

    if (parentIndex < 0) break;
    depth++;
    currentIndex = parentIndex;
    currentArea = parentArea;
  }

  return depth % 2 === 1 ? 'interior' : 'exterior';
}

/** @deprecated Use resolveOutlineWallSideByNesting with all indexed loops. */
export function resolveOutlineWallSide(
  loop: LoopPoint[],
  wallNormalX: number,
  wallNormalY: number,
  _partBounds?: PartBounds,
  allLoops?: LoopPoint[][],
  loopIndex?: number
): OutlineWallSide {
  const loops = allLoops ?? [loop];
  const index = loopIndex ?? 0;
  return resolveOutlineWallSideByNesting(loop, loops, index, wallNormalX, wallNormalY);
}

/**
 * Constant-distance offset of a closed XY loop for tool centerline guides.
 * Uses Clipper polygon offset (round joins, self-intersection cleanup).
 */
export function offsetLoop2DMinkowski(
  loop: LoopPoint[],
  offset: number,
  maxSegmentLen = 0.3,
  wallSide: OutlineWallSide = 'exterior'
): LoopPoint[] {
  const absOffset = Math.abs(offset);
  const segTol = Math.max(maxSegmentLen, 0.08);
  const arcTolMm = Math.min(0.025, Math.max(0.006, segTol * 0.08, absOffset * 0.015));

  return offsetClosedLoop2D(loop, offset, {
    joinType: ClipperLib.JoinType.jtRound,
    miterLimit: 2,
    arcTolerance: arcTolMm * CLIPPER_SCALE,
    maxSegmentLen: Math.max(maxSegmentLen, 0),
    wallSide,
  });
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

/** Push tool center outward if it violates minimum standoff from the part outline. */
export function clampToolCenterMinDistanceFromPart(
  partLoop: LoopPoint[],
  x: number,
  y: number,
  minDist: number
): { x: number; y: number } {
  const closest = closestPointOnLoop2D(x, y, partLoop);
  if (closest.dist >= minDist) return { x, y };
  return {
    x: closest.x + closest.outX * minDist,
    y: closest.y + closest.outY * minDist,
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
