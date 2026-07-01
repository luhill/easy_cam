import * as THREE from 'three';
import type { LoopPoint, OperationType, SelectionStrategy } from '../types/operations';
import { loopArea2D, pointInPolygon2D, boundsFromGeometry, loopCentroid, distanceToLoop2D, type PartBounds } from './geometryProcessing';
import {
  classifyRegionKind,
  effectiveOutlineLoop,
  isHoleSelectable,
  isHoleSelectableForOperation,
  isUpwardFacingRegion,
  isRegionSelectableForOperation,
} from './selectionRules';

const COPLANAR_DOT_THRESHOLD = Math.cos((2 * Math.PI) / 180);
const CIRCLE_TOLERANCE = 0.45;
const MIN_HOLE_POINTS = 4;
const HOLE_PICK_TOLERANCE = 1.2;
/** Max inner/outer loop area ratio — rejects pocket openings misread as holes. */
const MAX_HOLE_TO_FACE_AREA_RATIO = 0.35;
/** On small upward faces, stricter ratio rejects top-rim pad cutouts above pocket bosses. */
const SMALL_FACE_AREA_THRESHOLD = 200;
const MAX_HOLE_TO_SMALL_FACE_RATIO = 0.15;
/** Max hole radius as a fraction of the part XY diagonal. */
const MAX_HOLE_RADIUS_PART_FRACTION = 0.12;

export type RegionKind = 'top' | 'bottom' | 'side' | 'unknown';

export interface SelectionGroup {
  faceIndices: number[];
  loops: LoopPoint[][];
  holeId?: number;
  outerLoop?: LoopPoint[] | null;
}

export interface HoleFeature {
  id: number;
  center: LoopPoint;
  radius: number;
  loop: LoopPoint[];
  isVertical: boolean;
  regionId: number;
  /** Cylindrical wall faces surrounding this hole. */
  wallFaceIndices: number[];
  /** Mean Z of the hole opening (boss/pocket floor). */
  topZ: number;
}

export interface SelectionRegion {
  id: number;
  faceIndices: number[];
  loops: LoopPoint[][];
  normal: { x: number; y: number; z: number };
  centroid: LoopPoint;
  kind: RegionKind;
  outerLoop: LoopPoint[] | null;
  innerLoops: LoopPoint[][];
}

function computeEpsilon(bounds: PartBounds): number {
  const size = Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
    1
  );
  return Math.max(size * 1e-5, 1e-4);
}

function quantize(value: number, epsilon: number): string {
  return String(Math.round(value / epsilon));
}

function vertexKey(v: THREE.Vector3, epsilon: number): string {
  return `${quantize(v.x, epsilon)},${quantize(v.y, epsilon)},${quantize(v.z, epsilon)}`;
}

function edgeKey(a: THREE.Vector3, b: THREE.Vector3, epsilon: number): string {
  const ka = vertexKey(a, epsilon);
  const kb = vertexKey(b, epsilon);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function getFaceCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return index.count / 3;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  return position.count / 3;
}

function getTriangleVertexIndices(
  geometry: THREE.BufferGeometry,
  faceIndex: number
): [number, number, number] {
  const index = geometry.getIndex();
  if (index) {
    const i = faceIndex * 3;
    return [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
  }
  const base = faceIndex * 3;
  return [base, base + 1, base + 2];
}

function getFaceVertex(
  geometry: THREE.BufferGeometry,
  positions: THREE.BufferAttribute,
  faceIndex: number,
  corner: number,
  target: THREE.Vector3
): THREE.Vector3 {
  const vi = getTriangleVertexIndices(geometry, faceIndex)[corner];
  return target.fromBufferAttribute(positions, vi);
}

function toLoopPoint(v: THREE.Vector3): LoopPoint {
  return { x: v.x, y: v.y, z: v.z };
}

function regionCentroid(
  faceIndices: number[],
  geometry: THREE.BufferGeometry,
  positions: THREE.BufferAttribute
): LoopPoint {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  const v = new THREE.Vector3();
  for (const face of faceIndices) {
    for (let corner = 0; corner < 3; corner++) {
      getFaceVertex(geometry, positions, face, corner, v);
      x += v.x;
      y += v.y;
      z += v.z;
      count++;
    }
  }
  if (count === 0) return { x: 0, y: 0, z: 0 };
  return { x: x / count, y: y / count, z: z / count };
}

function averageNormal(faceIndices: number[], faceNormals: THREE.Vector3[]): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (const f of faceIndices) n.add(faceNormals[f]);
  return n.lengthSq() > 0 ? n.normalize() : new THREE.Vector3(0, 0, 1);
}

function planeKey(normal: THREE.Vector3, d: number, epsilon: number): string {
  const q = (v: number) => quantize(v, epsilon);
  return `${q(normal.x)},${q(normal.y)},${q(normal.z)},${q(d)}`;
}

function connectedComponents(faces: number[], adjacency: number[][]): number[][] {
  const faceSet = new Set(faces);
  const visited = new Set<number>();
  const components: number[][] = [];

  for (const start of faces) {
    if (visited.has(start)) continue;
    const component: number[] = [];
    const queue = [start];
    visited.add(start);

    while (queue.length > 0) {
      const face = queue.pop()!;
      component.push(face);
      for (const neighbor of adjacency[face]) {
        if (!faceSet.has(neighbor) || visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }

  return components;
}

function approximateCircleFromLoop(loop: LoopPoint[]): { center: LoopPoint; radius: number } {
  const center = loopCentroid(loop);
  let rSum = 0;
  let rMin = Infinity;
  let rMax = 0;
  for (const p of loop) {
    const r = Math.hypot(p.x - center.x, p.y - center.y);
    rSum += r;
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
  const radius = rSum / loop.length;
  return { center, radius: radius > 0 ? radius : (rMin + rMax) / 2 };
}

function fitCircle2D(loop: LoopPoint[]): { center: LoopPoint; radius: number } | null {
  if (loop.length < MIN_HOLE_POINTS) {
    return loop.length >= 3 ? approximateCircleFromLoop(loop) : null;
  }

  const approx = approximateCircleFromLoop(loop);
  let maxDev = 0;
  for (const p of loop) {
    const r = Math.hypot(p.x - approx.center.x, p.y - approx.center.y);
    maxDev = Math.max(maxDev, Math.abs(r - approx.radius));
  }

  if (approx.radius <= 0 || maxDev / approx.radius > CIRCLE_TOLERANCE) {
    return approx.radius > 0 ? approx : null;
  }

  return approx;
}

function loopMeanZ(loop: LoopPoint[]): number {
  if (loop.length === 0) return 0;
  let z = 0;
  for (const p of loop) z += p.z;
  return z / loop.length;
}

function isValidHoleCandidate(
  inner: LoopPoint[],
  fit: { center: LoopPoint; radius: number },
  outerLoop: LoopPoint[] | null,
  bounds: PartBounds
): boolean {
  if (fit.radius <= 0) return false;

  const loopArea = Math.abs(loopArea2D(inner));
  const circleArea = Math.PI * fit.radius * fit.radius;
  if (loopArea > 0 && Math.abs(loopArea - circleArea) / circleArea > 0.25) {
    return false;
  }

  const partDiag = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (fit.radius > partDiag * MAX_HOLE_RADIUS_PART_FRACTION) {
    return false;
  }

  if (outerLoop) {
    const outerArea = Math.abs(loopArea2D(outerLoop));
    if (outerArea > 0 && loopArea / outerArea > MAX_HOLE_TO_FACE_AREA_RATIO) {
      return false;
    }
    if (
      outerArea > 0 &&
      outerArea < SMALL_FACE_AREA_THRESHOLD &&
      loopArea / outerArea > MAX_HOLE_TO_SMALL_FACE_RATIO
    ) {
      return false;
    }
  }

  return true;
}

function classifyLoops(loops: LoopPoint[][]): {
  outerLoop: LoopPoint[] | null;
  innerLoops: LoopPoint[][];
} {
  if (loops.length === 0) return { outerLoop: null, innerLoops: [] };
  const sorted = [...loops].sort((a, b) => loopArea2D(b) - loopArea2D(a));
  return { outerLoop: sorted[0], innerLoops: sorted.slice(1) };
}

function traceLoops(edges: Array<[THREE.Vector3, THREE.Vector3]>, epsilon: number): LoopPoint[][] {
  if (edges.length === 0) return [];

  const unused = new Set(edges.map((_, i) => i));
  const loops: LoopPoint[][] = [];
  const adjacency = new Map<string, Array<{ key: string; point: THREE.Vector3 }>>();

  for (const [a, b] of edges) {
    const ka = vertexKey(a, epsilon);
    const kb = vertexKey(b, epsilon);
    if (!adjacency.has(ka)) adjacency.set(ka, []);
    if (!adjacency.has(kb)) adjacency.set(kb, []);
    adjacency.get(ka)!.push({ key: kb, point: b });
    adjacency.get(kb)!.push({ key: ka, point: a });
  }

  while (unused.size > 0) {
    const startIdx = unused.values().next().value as number;
    const [startA, startB] = edges[startIdx];
    unused.delete(startIdx);

    const loop: THREE.Vector3[] = [startA.clone()];
    let prevKey = vertexKey(startA, epsilon);
    let currentKey = vertexKey(startB, epsilon);
    let currentPoint = startB.clone();
    loop.push(currentPoint.clone());

    const maxSteps = edges.length + 2;
    for (let step = 0; step < maxSteps; step++) {
      const startLoopKey = vertexKey(startA, epsilon);
      if (currentKey === startLoopKey && loop.length > 2) break;

      const neighbors = adjacency.get(currentKey) ?? [];
      const next = neighbors.find((n) => n.key !== prevKey);
      if (!next) break;

      prevKey = currentKey;
      currentKey = next.key;
      currentPoint = next.point.clone();

      if (currentKey !== startLoopKey) {
        loop.push(currentPoint.clone());
      }

      for (const idx of unused) {
        const [ea, eb] = edges[idx];
        if (
          (vertexKey(ea, epsilon) === prevKey && vertexKey(eb, epsilon) === currentKey) ||
          (vertexKey(eb, epsilon) === prevKey && vertexKey(ea, epsilon) === currentKey)
        ) {
          unused.delete(idx);
          break;
        }
      }
    }

    if (loop.length >= 3) {
      loops.push(loop.map(toLoopPoint));
    }
  }

  return loops;
}

export class MeshIndex {
  readonly geometry: THREE.BufferGeometry;
  readonly faceCount: number;
  readonly regions: SelectionRegion[];
  readonly holes: HoleFeature[];
  readonly bounds: PartBounds;
  readonly faceToRegion: Int32Array;
  private readonly edgeToFaces: Map<string, number[]>;
  private readonly positions: THREE.BufferAttribute;
  private readonly faceNormals: THREE.Vector3[];
  private readonly epsilon: number;

  constructor(geometry: THREE.BufferGeometry) {
    this.geometry = geometry;
    this.positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    this.faceCount = getFaceCount(geometry);
    this.edgeToFaces = new Map();
    this.holes = [];
    this.bounds = boundsFromGeometry(geometry);
    this.epsilon = computeEpsilon(this.bounds);

    this.faceNormals = [];
    const facePlaneKeys: string[] = [];
    const adjacency: number[][] = Array.from({ length: this.faceCount }, () => []);

    for (let faceIndex = 0; faceIndex < this.faceCount; faceIndex++) {
      const v0 = getFaceVertex(geometry, this.positions, faceIndex, 0, new THREE.Vector3());
      const v1 = getFaceVertex(geometry, this.positions, faceIndex, 1, new THREE.Vector3());
      const v2 = getFaceVertex(geometry, this.positions, faceIndex, 2, new THREE.Vector3());

      const normal = new THREE.Vector3()
        .crossVectors(v1.clone().sub(v0), v2.clone().sub(v0))
        .normalize();
      this.faceNormals.push(normal);
      facePlaneKeys.push(planeKey(normal, normal.dot(v0), this.epsilon));

      const verts = [v0, v1, v2];
      for (let i = 0; i < 3; i++) {
        const key = edgeKey(verts[i], verts[(i + 1) % 3], this.epsilon);
        const faces = this.edgeToFaces.get(key) ?? [];
        faces.push(faceIndex);
        this.edgeToFaces.set(key, faces);
      }
    }

    for (const faces of this.edgeToFaces.values()) {
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          const a = faces[i];
          const b = faces[j];
          if (facePlaneKeys[a] !== facePlaneKeys[b]) continue;
          if (this.faceNormals[a].dot(this.faceNormals[b]) < COPLANAR_DOT_THRESHOLD) continue;
          adjacency[a].push(b);
          adjacency[b].push(a);
        }
      }
    }

    const planeBuckets = new Map<string, number[]>();
    for (let faceIndex = 0; faceIndex < this.faceCount; faceIndex++) {
      const key = facePlaneKeys[faceIndex];
      const bucket = planeBuckets.get(key) ?? [];
      bucket.push(faceIndex);
      planeBuckets.set(key, bucket);
    }

    this.faceToRegion = new Int32Array(this.faceCount).fill(-1);
    this.regions = [];

    for (const bucket of planeBuckets.values()) {
      const components = connectedComponents(bucket, adjacency);
      const useWholeBucket =
        bucket.length > 1 && components.every((component) => component.length === 1);
      const regionGroups = useWholeBucket ? [bucket] : components;

      for (const faceIndices of regionGroups) {
        if (faceIndices.length === 0) continue;

        const regionId = this.regions.length;
        const loops = this.computeBoundaryLoops(faceIndices);
        const normal = averageNormal(faceIndices, this.faceNormals);
        const centroid = regionCentroid(faceIndices, geometry, this.positions);
        const kind = classifyRegionKind(normal, centroid, this.bounds);
        const { outerLoop, innerLoops } = classifyLoops(loops);

        for (const face of faceIndices) {
          this.faceToRegion[face] = regionId;
        }

        this.regions.push({
          id: regionId,
          faceIndices,
          loops,
          normal: { x: normal.x, y: normal.y, z: normal.z },
          centroid,
          kind,
          outerLoop,
          innerLoops,
        });

        const region = this.regions[regionId];
        if (isUpwardFacingRegion(region)) {
          for (const inner of innerLoops) {
            const fit = fitCircle2D(inner);
            if (fit && isValidHoleCandidate(inner, fit, outerLoop, this.bounds)) {
              this.holes.push({
                id: this.holes.length,
                center: fit.center,
                radius: fit.radius,
                loop: inner,
                isVertical: true,
                regionId,
                wallFaceIndices: [],
                topZ: loopMeanZ(inner),
              });
            }
          }
        }
      }
    }

    for (const hole of this.holes) {
      hole.wallFaceIndices = this.findWallFacesForCylinder(hole.center, hole.radius);
    }
  }

  private faceCentroid(faceIndex: number): THREE.Vector3 {
    const sum = new THREE.Vector3();
    for (let i = 0; i < 3; i++) {
      sum.add(getFaceVertex(this.geometry, this.positions, faceIndex, i, new THREE.Vector3()));
    }
    return sum.multiplyScalar(1 / 3);
  }

  private findWallFacesForCylinder(center: LoopPoint, radius: number): number[] {
    if (radius <= 0) return [];

    const minR = radius * 0.82;
    const maxR = radius * 1.18;
    const zMin = this.bounds.minZ - this.epsilon;
    const zMax = this.bounds.maxZ + this.epsilon;
    const faces: number[] = [];

    for (let faceIndex = 0; faceIndex < this.faceCount; faceIndex++) {
      const normal = this.faceNormals[faceIndex];
      if (Math.abs(normal.z) > 0.35) continue;

      const c = this.faceCentroid(faceIndex);
      if (c.z < zMin || c.z > zMax) continue;

      const dist = Math.hypot(c.x - center.x, c.y - center.y);
      if (dist >= minR && dist <= maxR) {
        faces.push(faceIndex);
      }
    }

    return faces;
  }

  getWallFacesForHole(hole: { center: LoopPoint; radius: number; holeId?: number }): number[] {
    if (hole.holeId !== undefined && hole.holeId >= 0) {
      const feature = this.holes.find((h) => h.id === hole.holeId);
      if (feature?.wallFaceIndices.length) return feature.wallFaceIndices;
    }
    return this.findWallFacesForCylinder(hole.center, hole.radius);
  }

  private computeBoundaryLoops(faceIndices: number[]): LoopPoint[][] {
    if (faceIndices.length === 0) return [];

    const faceSet = new Set(faceIndices);
    const boundaryEdges: Array<[THREE.Vector3, THREE.Vector3]> = [];

    for (const faceIndex of faceIndices) {
      const verts = [
        getFaceVertex(this.geometry, this.positions, faceIndex, 0, new THREE.Vector3()),
        getFaceVertex(this.geometry, this.positions, faceIndex, 1, new THREE.Vector3()),
        getFaceVertex(this.geometry, this.positions, faceIndex, 2, new THREE.Vector3()),
      ];

      for (let i = 0; i < 3; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % 3];
        const key = edgeKey(a, b, this.epsilon);
        const facesOnEdge = this.edgeToFaces.get(key) ?? [];

        let countInGroup = 0;
        for (const f of facesOnEdge) {
          if (faceSet.has(f)) countInGroup++;
        }

        if (countInGroup === 1) {
          boundaryEdges.push([a, b]);
        }
      }
    }

    return traceLoops(boundaryEdges, this.epsilon);
  }

  getRegion(faceIndex: number): SelectionRegion | null {
    if (faceIndex < 0 || faceIndex >= this.faceCount) return null;
    const regionId = this.faceToRegion[faceIndex];
    return regionId >= 0 ? this.regions[regionId] : null;
  }

  getRegionId(faceIndex: number): number {
    if (faceIndex < 0 || faceIndex >= this.faceCount) return -1;
    return this.faceToRegion[faceIndex];
  }

  private scoreHolePick(
    hole: HoleFeature,
    x: number,
    y: number,
    z: number | undefined
  ): number | null {
    const inside = pointInPolygon2D(x, y, hole.loop);
    const distXY = Math.hypot(x - hole.center.x, y - hole.center.y);
    const distEdge = distanceToLoop2D(x, y, hole.loop);
    const nearXY =
      inside ||
      distXY <= hole.radius * HOLE_PICK_TOLERANCE ||
      distEdge <= hole.radius * 0.35;

    if (!nearXY) return null;

    const zWeight = 8;
    const zPenalty = z !== undefined ? Math.abs(hole.topZ - z) * zWeight : 0;
    const xyScore = inside ? 0 : Math.min(distXY, distEdge);
    // Prefer smaller holes when XY is ambiguous (avoid pocket openings).
    const sizePenalty = hole.radius * 0.05;
    return xyScore + zPenalty + sizePenalty;
  }

  findInnerLoopAtPoint(x: number, y: number, z?: number): HoleFeature | null {
    let best: { hole: HoleFeature; score: number } | null = null;

    for (const region of this.regions) {
      if (!isUpwardFacingRegion(region)) continue;
      if (z !== undefined && Math.abs(region.centroid.z - z) > 1.5) continue;

      for (const inner of region.innerLoops) {
        const fit = fitCircle2D(inner);
        if (!fit || !isValidHoleCandidate(inner, fit, region.outerLoop, this.bounds)) {
          continue;
        }

        const inside = pointInPolygon2D(x, y, inner);
        const distToCenter = Math.hypot(x - fit.center.x, y - fit.center.y);
        const distToEdge = distanceToLoop2D(x, y, inner);
        const insideByRadius = distToCenter <= fit.radius * HOLE_PICK_TOLERANCE;
        const nearEdge = distToEdge <= fit.radius * 0.35;

        if (!inside && !insideByRadius && !nearEdge) continue;

        const xyScore = inside ? 0 : insideByRadius ? distToCenter : distToEdge;
        const zPenalty = z !== undefined ? Math.abs(loopMeanZ(inner) - z) * 8 : 0;
        const score = xyScore + zPenalty + fit.radius * 0.05;

        const hole: HoleFeature = {
          id: -1,
          center: fit.center,
          radius: fit.radius,
          loop: inner,
          isVertical: true,
          regionId: region.id,
          wallFaceIndices: this.findWallFacesForCylinder(fit.center, fit.radius),
          topZ: loopMeanZ(inner),
        };

        if (!best || score < best.score) {
          best = { hole, score };
        }
      }
    }

    return best?.hole ?? null;
  }

  findHoleAtPoint(
    x: number,
    y: number,
    operationType: OperationType,
    z?: number
  ): HoleFeature | null {
    if (!isHoleSelectableForOperation(operationType)) return null;

    let best: { hole: HoleFeature; score: number } | null = null;

    for (const hole of this.holes) {
      if (!isHoleSelectable(operationType, hole)) continue;
      const score = this.scoreHolePick(hole, x, y, z);
      if (score === null) continue;
      if (!best || score < best.score) {
        best = { hole, score };
      }
    }

    if (best) return best.hole;

    return this.findInnerLoopAtPoint(x, y, z);
  }

  getOutlineLoop(region: SelectionRegion): LoopPoint[] | null {
    const existing = effectiveOutlineLoop(region);
    if (existing) return existing;

    const loops = this.computeBoundaryLoops(region.faceIndices);
    if (loops.length === 0) return null;
    return [...loops].sort((a, b) => loopArea2D(b) - loopArea2D(a))[0];
  }

  resolveSelection(
    faceIndex: number,
    operationType: OperationType,
    point?: THREE.Vector3
  ): SelectionGroup | null {
    const region = this.getRegion(faceIndex);
    if (!region) return null;

    if (isHoleSelectableForOperation(operationType)) {
      if (!point) return null;
      const hole = this.findHoleAtPoint(point.x, point.y, operationType, point.z);
      if (!hole) return null;

      return {
        faceIndices: hole.wallFaceIndices,
        loops: [hole.loop],
        holeId: hole.id >= 0 ? hole.id : undefined,
        outerLoop: null,
      };
    }

    if (!isRegionSelectableForOperation(operationType, region, this.bounds)) return null;

    const outline = this.getOutlineLoop(region);
    const loops =
      operationType === 'outline' || operationType === 'adaptive-outline'
        ? outline
          ? [outline]
          : []
        : region.loops;

    return {
      faceIndices: region.faceIndices,
      loops,
      outerLoop: outline,
    };
  }

  isSelectable(faceIndex: number, operationType: OperationType, point?: THREE.Vector3): boolean {
    return this.resolveSelection(faceIndex, operationType, point) !== null;
  }

  getSelectionGroup(faceIndex: number, strategy: SelectionStrategy): SelectionGroup {
    const region = this.getRegion(faceIndex);
    if (!region) return { faceIndices: [], loops: [] };
    const outline = this.getOutlineLoop(region);
    return {
      faceIndices: region.faceIndices,
      loops: strategy === 'outline-loop' && outline ? [outline] : region.loops,
      outerLoop: outline,
    };
  }

  getFaceVertexIndices(faceIndex: number): number[] {
    return [...getTriangleVertexIndices(this.geometry, faceIndex)];
  }
}

const meshIndexCache = new WeakMap<THREE.BufferGeometry, MeshIndex>();

export function clearMeshIndexCache(geometry?: THREE.BufferGeometry): void {
  if (geometry) {
    meshIndexCache.delete(geometry);
  }
}

export function getMeshIndex(geometry: THREE.BufferGeometry): MeshIndex {
  let index = meshIndexCache.get(geometry);
  if (!index) {
    index = new MeshIndex(geometry);
    meshIndexCache.set(geometry, index);
  }
  return index;
}

export function mergeLoops(existing: LoopPoint[][] | undefined, added: LoopPoint[][]): LoopPoint[][] {
  return [...(existing ?? []), ...added];
}

export function removeGroupFromSelection(
  existingFaces: number[],
  existingLoops: LoopPoint[][] | undefined,
  groupFaces: number[],
  groupLoops: LoopPoint[][] | undefined
): { faceIndices: number[]; loops: LoopPoint[][] | undefined } {
  const removeSet = new Set(groupFaces);
  const faceIndices = existingFaces.filter((f) => !removeSet.has(f));

  let loops = existingLoops;
  if (groupLoops && groupLoops.length > 0 && loops) {
    loops = loops.filter(
      (loop) =>
        !groupLoops.some(
          (candidate) => candidate.length === loop.length && loopsEqual(candidate, loop)
        )
    );
    if (loops.length === 0) loops = undefined;
  }

  return { faceIndices, loops };
}

function loopsEqual(a: LoopPoint[], b: LoopPoint[]): boolean {
  if (a.length !== b.length) return false;
  const q = (v: number) => v.toFixed(4);
  return a.every(
    (p, i) =>
      q(p.x) === q(b[i].x) && q(p.y) === q(b[i].y) && q(p.z) === q(b[i].z)
  );
}

export function isGroupSelected(existingFaces: number[], groupFaces: number[]): boolean {
  if (groupFaces.length === 0) return false;
  const selected = new Set(existingFaces);
  return groupFaces.every((f) => selected.has(f));
}

export function collectVertexIndices(meshIndex: MeshIndex, faceIndices: number[]): number[] {
  const verts = new Set<number>();
  for (const face of faceIndices) {
    for (const v of meshIndex.getFaceVertexIndices(face)) {
      verts.add(v);
    }
  }
  return [...verts];
}

export function isHoleInSelection(
  holes: Array<{ center: LoopPoint; holeId?: number }>,
  candidate: { center: LoopPoint; holeId?: number },
  epsilon = 0.5
): boolean {
  return holes.some((h) => {
    if (h.holeId !== undefined && candidate.holeId !== undefined && h.holeId === candidate.holeId) {
      return true;
    }
    return Math.hypot(h.center.x - candidate.center.x, h.center.y - candidate.center.y) < epsilon;
  });
}

export { getFaceCount as getMeshFaceCount };
