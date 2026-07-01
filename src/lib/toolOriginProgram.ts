import type { ToolOrigin } from './geometryProcessing';
import { worldZToCamZ } from './cutDepth';
import type { ToolpathPoint, ToolpathSegment } from '../types/operations';

export const ORIGIN_APPROACH_PREFIX = '__origin_approach__';

/** G-code X/Y relative to the tool origin offset (WCS zero at program start). */
export function gcodeXY(
  worldX: number,
  worldY: number,
  origin: ToolOrigin
): { x: number; y: number } {
  return { x: worldX - origin.x, y: worldY - origin.y };
}

/** G-code Z from world Z using stock top as CAM Z=0, minus origin Z offset. */
export function gcodeZFromWorld(
  worldZ: number,
  stockTopWorldZ: number,
  origin: ToolOrigin
): number {
  return worldZToCamZ(worldZ, stockTopWorldZ) - origin.z;
}

/** G-code Z for the clearance plane above stock top. */
export function gcodeSafeZ(safeHeight: number, origin: ToolOrigin): number {
  return safeHeight - origin.z;
}

export function toolOriginWorldPoint(toolOrigin: ToolOrigin, safeZWorld: number): ToolpathPoint {
  return { x: toolOrigin.x, y: toolOrigin.y, z: safeZWorld, rapid: true };
}

export function firstPreviewPoint(segments: ToolpathSegment[]): ToolpathPoint | null {
  for (const segment of segments) {
    if (segment.points.length > 0) return segment.points[0];
  }
  return null;
}

/** Prepend rapid travel from tool origin to the first visible toolpath point. */
export function prependToolOriginApproach(
  segments: ToolpathSegment[],
  toolOrigin: ToolOrigin,
  safeZWorld: number
): ToolpathSegment[] {
  if (segments.length === 0) return segments;

  const first = firstPreviewPoint(segments);
  if (!first) return segments;

  const origin = toolOriginWorldPoint(toolOrigin, safeZWorld);
  const span = Math.hypot(origin.x - first.x, origin.y - first.y, origin.z - first.z);
  if (span < 0.05) return segments;

  return [
    {
      operationId: ORIGIN_APPROACH_PREFIX,
      points: [origin, { ...first, rapid: true }],
      color: '#f59e0b',
    },
    ...segments,
  ];
}
