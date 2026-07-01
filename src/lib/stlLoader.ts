import * as THREE from 'three';
import { STLLoader } from 'three-stdlib';

const geometryCache = new Map<string, THREE.BufferGeometry>();
const inflight = new Map<string, Promise<THREE.BufferGeometry>>();

export function loadStlGeometry(url: string): Promise<THREE.BufferGeometry> {
  const cached = geometryCache.get(url);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(url);
  if (pending) return pending;

  const promise = fetch(url, import.meta.env.DEV ? { cache: 'no-store' } : undefined)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load STL (${response.status})`);
      }
      return response.arrayBuffer();
    })
    .then((buffer) => {
      const loader = new STLLoader();
      const geometry = loader.parse(buffer);
      geometryCache.set(url, geometry);
      inflight.delete(url);
      return geometry;
    })
    .catch((error) => {
      inflight.delete(url);
      throw error;
    });

  inflight.set(url, promise);
  return promise;
}

export function clearStlGeometryCache(url?: string): void {
  if (url) {
    geometryCache.get(url)?.dispose();
    geometryCache.delete(url);
    inflight.delete(url);
    return;
  }

  for (const geometry of geometryCache.values()) {
    geometry.dispose();
  }
  geometryCache.clear();
  inflight.clear();
}
