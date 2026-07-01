import type * as THREE from 'three';

export interface PartTransformBridge {
  applyRotationZ: (degrees: number) => void;
  commitOrientationSource: (geometry: THREE.BufferGeometry) => void;
}

let bridge: PartTransformBridge | null = null;

export function registerPartTransformBridge(next: PartTransformBridge | null): void {
  bridge = next;
}

export function getPartTransformBridge(): PartTransformBridge | null {
  return bridge;
}
