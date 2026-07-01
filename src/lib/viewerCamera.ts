import type * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { PartBounds } from './geometryProcessing';
import { setTopDownHomeView as applyTopDownHomeView } from './viewportCamera';

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

export { setTopDownHomeView } from './viewportCamera';

export function goHomeWithCamera(
  camera: THREE.Camera,
  controls: OrbitControlsImpl | null,
  bounds: PartBounds | null,
  aspect = 1
): void {
  applyTopDownHomeView(camera, controls, bounds, aspect);
}
