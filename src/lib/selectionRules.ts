import type { OperationType } from '../types/operations';
import type { HoleFeature, RegionKind, SelectionRegion } from './meshSelection';

const UP_DOT = 0.94;
const DOWN_DOT = -0.94;

export function classifyRegionKind(normal: { x: number; y: number; z: number }): RegionKind {
  if (normal.z >= UP_DOT) return 'top';
  if (normal.z <= DOWN_DOT) return 'bottom';
  if (Math.abs(normal.z) < 0.25) return 'side';
  return 'unknown';
}

export function isRegionSelectableForOperation(
  operationType: OperationType,
  region: SelectionRegion
): boolean {
  switch (operationType) {
    case 'outline':
    case 'adaptive-outline':
      return region.kind === 'top' && region.outerLoop !== null;
    case 'pocket':
      return region.kind === 'top';
    case 'contour':
      return region.kind === 'side';
    default:
      return false;
  }
}

export function isHoleSelectableForOperation(operationType: OperationType): boolean {
  return operationType === 'drill' || operationType === 'helix';
}

export function isHoleSelectable(operationType: OperationType, hole: HoleFeature): boolean {
  if (!isHoleSelectableForOperation(operationType)) return false;
  return hole.isVertical && hole.radius > 0;
}

export function getSelectionHint(
  operationType: OperationType | null,
  subMode?: 'geometry' | 'entry-point'
): string {
  if (subMode === 'entry-point') {
    return 'Click in stock to set helix entry point — right-drag to orbit';
  }
  switch (operationType) {
    case 'outline':
      return 'Select a top-facing surface for the outline loop';
    case 'adaptive-outline':
      return 'Select top-facing part outline, then set helix entry point in stock';
    case 'drill':
    case 'helix':
      return 'Select a circular hole (must face up and be round)';
    case 'pocket':
      return 'Select a top-facing surface to pocket';
    case 'contour':
      return 'Select a vertical side surface';
    default:
      return 'Select geometry from the model';
  }
}
