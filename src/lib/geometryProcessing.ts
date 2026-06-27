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
