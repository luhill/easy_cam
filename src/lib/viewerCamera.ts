import type * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { partDimensionsFromBounds, type PartBounds } from './geometryProcessing';

export interface ViewerCameraBridge {
  goHome: () => void;
}

let bridge: ViewerCameraBridge | null = null;

export function registerViewerCameraBridge(next: ViewerCameraBridge | null): void {
  bridge = next;
}

export function goToViewerHome(): void {
  bridge?.goHome();
}

/** Top-down view: camera on +Z looking at part center, screen +Y up. */
export function setTopDownHomeView(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControlsImpl | null,
  bounds: PartBounds | null
): void {
  if (!bounds) return;

  const dims = partDimensionsFromBounds(bounds);
  const maxDim = Math.max(dims.width, dims.depth, 1);
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const distance = maxDim * 1.2;

  camera.position.set(0, 0, bounds.maxZ + distance);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, centerZ);
  camera.far = Math.max(1000, distance * 8);
  camera.updateProjectionMatrix();

  if (controls) {
    controls.target.set(0, 0, centerZ);
    controls.update();
  }
}
