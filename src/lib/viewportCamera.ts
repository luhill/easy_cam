import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { partDimensionsFromBounds, type PartBounds } from './geometryProcessing';

export function cameraAspect(width: number, height: number): number {
  return width / Math.max(height, 1);
}

export function orthographicFrustum(bounds: PartBounds | null, aspect: number): {
  halfW: number;
  halfH: number;
} {
  if (!bounds) {
    return { halfW: 60 * aspect, halfH: 60 };
  }

  const dims = partDimensionsFromBounds(bounds);
  const maxDim = Math.max(dims.width, dims.depth, dims.height, 1);
  const halfH = maxDim * 1.1;
  return { halfW: halfH * aspect, halfH };
}

export function applyOrthographicFrustum(
  camera: THREE.OrthographicCamera,
  bounds: PartBounds | null,
  aspect: number
): void {
  const { halfW, halfH } = orthographicFrustum(bounds, aspect);
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.near = 0.1;
  camera.far = Math.max(10000, halfH * 20);
  camera.updateProjectionMatrix();
}

export function fitPerspectiveToPartBounds(
  camera: THREE.PerspectiveCamera,
  bounds: PartBounds | null
): void {
  if (!bounds) {
    camera.position.set(60, -60, 60);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.far = 1000;
    camera.updateProjectionMatrix();
    return;
  }

  const dims = partDimensionsFromBounds(bounds);
  const maxDim = Math.max(dims.width, dims.depth, dims.height, 1);
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const distance = maxDim * 2.2;

  camera.position.set(distance, -distance, centerZ + distance * 0.75);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, centerZ);
  camera.far = Math.max(1000, distance * 8);
  camera.updateProjectionMatrix();
}

export function fitOrthographicToPartBounds(
  camera: THREE.OrthographicCamera,
  bounds: PartBounds | null,
  aspect: number
): void {
  applyOrthographicFrustum(camera, bounds, aspect);

  if (!bounds) {
    camera.position.set(60, -60, 60);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    return;
  }

  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const dims = partDimensionsFromBounds(bounds);
  const maxDim = Math.max(dims.width, dims.depth, dims.height, 1);
  const distance = maxDim * 2.2;

  camera.position.set(distance, -distance, centerZ + distance * 0.75);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, centerZ);
}

export function replaceWithOrthographicCamera(
  source: THREE.Camera,
  bounds: PartBounds | null,
  aspect: number
): THREE.OrthographicCamera {
  const { halfW, halfH } = orthographicFrustum(bounds, aspect);
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 10000);
  camera.position.copy(source.position);
  camera.quaternion.copy(source.quaternion);
  camera.up.copy(source.up);
  camera.updateProjectionMatrix();
  return camera;
}

export function replaceWithPerspectiveCamera(
  source: THREE.Camera,
  bounds: PartBounds | null,
  aspect: number
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  camera.position.copy(source.position);
  camera.quaternion.copy(source.quaternion);
  camera.up.copy(source.up);
  fitPerspectiveToPartBounds(camera, bounds);
  return camera;
}

/** Top-down view: camera on +Z looking at part center, screen +Y up. */
export function setTopDownHomeView(
  camera: THREE.Camera,
  controls: OrbitControlsImpl | null,
  bounds: PartBounds | null,
  aspect = 1
): void {
  if (!bounds) return;

  const dims = partDimensionsFromBounds(bounds);
  const maxDim = Math.max(dims.width, dims.depth, 1);
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const distance = maxDim * 1.2;

  camera.position.set(0, 0, bounds.maxZ + distance);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, centerZ);

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.far = Math.max(1000, distance * 8);
    camera.updateProjectionMatrix();
  } else if (camera instanceof THREE.OrthographicCamera) {
    applyOrthographicFrustum(camera, bounds, aspect);
  }

  if (controls) {
    controls.target.set(0, 0, centerZ);
    controls.update();
  }
}
