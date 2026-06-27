import type { OperationType } from '../types/operations';
import type { PartBounds } from './geometryProcessing';
import type { HoleFeature, RegionKind, SelectionRegion } from './meshSelection';

const HORIZONTAL_DOT = 0.65;

export function classifyRegionKind(
  normal: { x: number; y: number; z: number },
  _centroid: { x: number; y: number; z: number },
  _bounds: PartBounds
): RegionKind {
  const absZ = Math.abs(normal.z);

  if (absZ >= HORIZONTAL_DOT) {
    return normal.z >= 0 ? 'top' : 'bottom';
  }

  if (absZ <= 0.35) return 'side';

  return 'unknown';
}

export function isRegionSelectableForOperation(
  operationType: OperationType,
  region: SelectionRegion
): boolean {
  const hasOutline = region.outerLoop !== null || region.loops.length > 0;

  switch (operationType) {
    case 'outline':
    case 'adaptive-outline':
      return region.normal.z >= HORIZONTAL_DOT && hasOutline;
    case 'pocket':
      return region.normal.z >= HORIZONTAL_DOT;
    case 'contour':
      return region.kind === 'side';
    default:
      return false;
  }
}

export function isHoleSelectableForOperation(operationType: OperationType): boolean {
  return operationType === 'drill' || operationType === 'helix';
}

export function isHoleSelectable(_operationType: OperationType, hole: HoleFeature): boolean {
  return hole.isVertical && hole.radius > 0;
}

export function getSelectionHint(
  operationType: OperationType | null,
  subMode?: 'geometry' | 'entry-point' | 'bottom-face'
): string {
  if (subMode === 'bottom-face') {
    return 'Click the face that should sit on the build plate (Z=0)';
  }
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
      return 'Click inside a circular hole on the top surface';
    case 'pocket':
      return 'Select a top-facing surface to pocket';
    case 'contour':
      return 'Select a vertical side surface';
    default:
      return 'Select geometry from the model';
  }
}

export function effectiveOutlineLoop(region: SelectionRegion) {
  return region.outerLoop ?? (region.loops.length > 0 ? region.loops[0] : null);
}
