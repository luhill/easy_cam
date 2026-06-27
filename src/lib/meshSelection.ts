import * as THREE from 'three';
import type { LoopPoint, SelectionStrategy } from '../types/operations';

const POSITION_PRECISION = 4;
const COPLANAR_DOT_THRESHOLD = Math.cos((2 * Math.PI) / 180); // 2 degrees

export interface SelectionGroup {
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
  corner: number
): THREE.Vector3 {
  const i = faceIndex * 9 + corner * 3;
  return new THREE.Vector3(positions.array[i], positions.array[i + 1], positions.array[i + 2]);
}

export class MeshIndex {
  readonly faceCount: number;
  readonly faceNormals: THREE.Vector3[];
  private readonly positions: THREE.BufferAttribute;
  private readonly adjacency: number[][];

  constructor(geometry: THREE.BufferGeometry) {
    this.positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    this.faceCount = this.positions.count / 3;
    this.faceNormals = [];
    this.adjacency = Array.from({ length: this.faceCount }, () => []);

    const edgeToFaces = new Map<string, number[]>();

    for (let faceIndex = 0; faceIndex < this.faceCount; faceIndex++) {
      const v0 = getFaceVertex(this.positions, faceIndex, 0);
      const v1 = getFaceVertex(this.positions, faceIndex, 1);
      const v2 = getFaceVertex(this.positions, faceIndex, 2);

      const normal = new THREE.Vector3()
        .crossVectors(v1.clone().sub(v0), v2.clone().sub(v0))
        .normalize();
      this.faceNormals.push(normal);

      const verts = [v0, v1, v2];
      for (let i = 0; i < 3; i++) {
        const key = edgeKey(verts[i], verts[(i + 1) % 3]);
        const faces = edgeToFaces.get(key) ?? [];
        faces.push(faceIndex);
        edgeToFaces.set(key, faces);
      }
    }

    for (const faces of edgeToFaces.values()) {
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          const a = faces[i];
          const b = faces[j];
          this.adjacency[a].push(b);
          this.adjacency[b].push(a);
        }
      }
    }
  }

  getCoplanarGroup(startFace: number): number[] {
    if (startFace < 0 || startFace >= this.faceCount) return [];

    const reference = this.faceNormals[startFace];
    const visited = new Set<number>();
    const queue = [startFace];
    visited.add(startFace);

    while (queue.length > 0) {
      const face = queue.pop()!;
      for (const neighbor of this.adjacency[face]) {
        if (visited.has(neighbor)) continue;
        if (this.faceNormals[neighbor].dot(reference) >= COPLANAR_DOT_THRESHOLD) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    return [...visited];
  }

  getBoundaryLoops(faceIndices: number[]): LoopPoint[][] {
    const faceSet = new Set(faceIndices);
    if (faceSet.size === 0) return [];

    const boundaryEdges: Array<[THREE.Vector3, THREE.Vector3]> = [];

    for (const faceIndex of faceSet) {
      const verts = [
        getFaceVertex(this.positions, faceIndex, 0),
        getFaceVertex(this.positions, faceIndex, 1),
        getFaceVertex(this.positions, faceIndex, 2),
      ];

      for (let i = 0; i < 3; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % 3];
        const key = edgeKey(a, b);
        let sharedInGroup = 0;

        for (const other of faceSet) {
          if (other === faceIndex) continue;
          const oVerts = [
            getFaceVertex(this.positions, other, 0),
            getFaceVertex(this.positions, other, 1),
            getFaceVertex(this.positions, other, 2),
          ];
          for (let j = 0; j < 3; j++) {
            if (edgeKey(oVerts[j], oVerts[(j + 1) % 3]) === key) {
              sharedInGroup++;
              break;
            }
          }
        }

        if (sharedInGroup === 0) {
          boundaryEdges.push([a.clone(), b.clone()]);
        }
      }
    }

    return traceLoops(boundaryEdges);
  }

  getSelectionGroup(faceIndex: number, strategy: SelectionStrategy): SelectionGroup {
    const faceIndices = this.getCoplanarGroup(faceIndex);
    const loops =
      strategy === 'outline-loop' ? this.getBoundaryLoops(faceIndices) : [];

    return { faceIndices, loops };
  }

  getFaceVertexIndices(faceIndex: number): number[] {
    return [faceIndex * 3, faceIndex * 3 + 1, faceIndex * 3 + 2];
  }
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

function toLoopPoint(v: THREE.Vector3): LoopPoint {
  return { x: v.x, y: v.y, z: v.z };
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
