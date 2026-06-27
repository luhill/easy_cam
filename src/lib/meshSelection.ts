import * as THREE from 'three';
import type { LoopPoint, SelectionStrategy } from '../types/operations';

const POSITION_PRECISION = 4;
const COPLANAR_DOT_THRESHOLD = Math.cos((2 * Math.PI) / 180); // 2 degrees

export interface SelectionGroup {
  faceIndices: number[];
  loops: LoopPoint[][];
}

export interface SelectionRegion {
  id: number;
  faceIndices: number[];
  loops: LoopPoint[][];
}

function quantize(value: number): string {
  return value.toFixed(POSITION_PRECISION);
}

function vertexKey(v: THREE.Vector3): string {
  return `${quantize(v.x)},${quantize(v.y)},${quantize(v.z)}`;
}

function edgeKey(a: THREE.Vector3, b: THREE.Vector3): string {
  const ka = vertexKey(a);
  const kb = vertexKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function getFaceVertex(
  positions: THREE.BufferAttribute,
  faceIndex: number,
  corner: number,
  target: THREE.Vector3
): THREE.Vector3 {
  const i = faceIndex * 9 + corner * 3;
  return target.set(positions.array[i], positions.array[i + 1], positions.array[i + 2]);
}

function toLoopPoint(v: THREE.Vector3): LoopPoint {
  return { x: v.x, y: v.y, z: v.z };
}

function traceLoops(edges: Array<[THREE.Vector3, THREE.Vector3]>): LoopPoint[][] {
  if (edges.length === 0) return [];

  const unused = new Set(edges.map((_, i) => i));
  const loops: LoopPoint[][] = [];
  const adjacency = new Map<string, Array<{ key: string; point: THREE.Vector3 }>>();

  for (const [a, b] of edges) {
    const ka = vertexKey(a);
    const kb = vertexKey(b);
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
    let prevKey = vertexKey(startA);
    let currentKey = vertexKey(startB);
    let currentPoint = startB.clone();
    loop.push(currentPoint.clone());

    const maxSteps = edges.length + 2;
    for (let step = 0; step < maxSteps; step++) {
      const startLoopKey = vertexKey(startA);
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
          (vertexKey(ea) === prevKey && vertexKey(eb) === currentKey) ||
          (vertexKey(eb) === prevKey && vertexKey(ea) === currentKey)
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

  return loops.sort((a, b) => b.length - a.length);
}

export class MeshIndex {
  readonly faceCount: number;
  readonly regions: SelectionRegion[];
  readonly faceToRegion: Int32Array;
  private readonly edgeToFaces: Map<string, number[]>;
  private readonly positions: THREE.BufferAttribute;
  private readonly vTemp0 = new THREE.Vector3();
  private readonly vTemp1 = new THREE.Vector3();
  private readonly vTemp2 = new THREE.Vector3();

  constructor(geometry: THREE.BufferGeometry) {
    this.positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    this.faceCount = this.positions.count / 3;
    this.edgeToFaces = new Map();

    const faceNormals: THREE.Vector3[] = [];
    const adjacency: number[][] = Array.from({ length: this.faceCount }, () => []);

    for (let faceIndex = 0; faceIndex < this.faceCount; faceIndex++) {
      const v0 = getFaceVertex(this.positions, faceIndex, 0, this.vTemp0.clone());
      const v1 = getFaceVertex(this.positions, faceIndex, 1, this.vTemp1.clone());
      const v2 = getFaceVertex(this.positions, faceIndex, 2, this.vTemp2.clone());

      const normal = new THREE.Vector3()
        .crossVectors(v1.sub(v0), v2.clone().sub(v0))
        .normalize();
      faceNormals.push(normal);

      const verts = [
        getFaceVertex(this.positions, faceIndex, 0, new THREE.Vector3()),
        getFaceVertex(this.positions, faceIndex, 1, new THREE.Vector3()),
        getFaceVertex(this.positions, faceIndex, 2, new THREE.Vector3()),
      ];
      for (let i = 0; i < 3; i++) {
        const key = edgeKey(verts[i], verts[(i + 1) % 3]);
        const faces = this.edgeToFaces.get(key) ?? [];
        faces.push(faceIndex);
        this.edgeToFaces.set(key, faces);
      }
    }

    for (const faces of this.edgeToFaces.values()) {
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          adjacency[faces[i]].push(faces[j]);
          adjacency[faces[j]].push(faces[i]);
        }
      }
    }

    this.faceToRegion = new Int32Array(this.faceCount).fill(-1);
    this.regions = [];
    const visited = new Uint8Array(this.faceCount);

    for (let startFace = 0; startFace < this.faceCount; startFace++) {
      if (visited[startFace]) continue;

      const faceIndices = this.floodCoplanar(startFace, faceNormals, adjacency, visited);
      const regionId = this.regions.length;
      const loops = this.computeBoundaryLoops(faceIndices);

      for (const face of faceIndices) {
        this.faceToRegion[face] = regionId;
      }

      this.regions.push({ id: regionId, faceIndices, loops });
    }
  }

  private floodCoplanar(
    startFace: number,
    faceNormals: THREE.Vector3[],
    adjacency: number[][],
    visited: Uint8Array
  ): number[] {
    const reference = faceNormals[startFace];
    const group: number[] = [];
    const queue = [startFace];
    visited[startFace] = 1;

    while (queue.length > 0) {
      const face = queue.pop()!;
      group.push(face);

      for (const neighbor of adjacency[face]) {
        if (visited[neighbor]) continue;
        if (faceNormals[neighbor].dot(reference) >= COPLANAR_DOT_THRESHOLD) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }

    return group;
  }

  private computeBoundaryLoops(faceIndices: number[]): LoopPoint[][] {
    if (faceIndices.length === 0) return [];

    const faceSet = new Set(faceIndices);
    const boundaryEdges: Array<[THREE.Vector3, THREE.Vector3]> = [];
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    const vc = new THREE.Vector3();

    for (const faceIndex of faceIndices) {
      const verts = [
        getFaceVertex(this.positions, faceIndex, 0, va.clone()),
        getFaceVertex(this.positions, faceIndex, 1, vb.clone()),
        getFaceVertex(this.positions, faceIndex, 2, vc.clone()),
      ];

      for (let i = 0; i < 3; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % 3];
        const key = edgeKey(a, b);
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

    return traceLoops(boundaryEdges);
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

  getSelectionGroup(faceIndex: number, strategy: SelectionStrategy): SelectionGroup {
    const region = this.getRegion(faceIndex);
    if (!region) return { faceIndices: [], loops: [] };
    return {
      faceIndices: region.faceIndices,
      loops: strategy === 'outline-loop' ? region.loops : [],
    };
  }

  getFaceVertexIndices(faceIndex: number): number[] {
    return [faceIndex * 3, faceIndex * 3 + 1, faceIndex * 3 + 2];
  }
}

const meshIndexCache = new WeakMap<THREE.BufferGeometry, MeshIndex>();

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
  return a.every(
    (p, i) =>
      quantize(p.x) === quantize(b[i].x) &&
      quantize(p.y) === quantize(b[i].y) &&
      quantize(p.z) === quantize(b[i].z)
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
