import type { PartBounds } from './geometryProcessing';

export type ToolOriginAlignTarget = 'left' | 'right' | 'up' | 'down' | 'center';

/** XY tool origin at the center of a part bounding-box edge (or bbox center). */
export function toolOriginXYForAlignTarget(
  bounds: PartBounds,
  target: ToolOriginAlignTarget
): { x: number; y: number } {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  switch (target) {
    case 'left':
      return { x: bounds.minX, y: centerY };
    case 'right':
      return { x: bounds.maxX, y: centerY };
    case 'up':
      return { x: centerX, y: bounds.maxY };
    case 'down':
      return { x: centerX, y: bounds.minY };
    case 'center':
      return { x: centerX, y: centerY };
  }
}
