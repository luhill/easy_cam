/** Base spacing values at resolution factor 1.0 (fine). Default factor 2.0 = half the points. */
export const BASE_PATH_SAMPLE_SPACING = 0.4;
export const BASE_HELIX_SEGMENTS_PER_REV = 24;
export const BASE_MINKOWSKI_SEGMENT = 0.3;
export const BASE_CONTOUR_STEPS = 20;

export interface ToolpathGlobalOptions {
  safeHeight: number;
  /** 1 = finest, 2 = default (2× coarser), higher = fewer points */
  resolution: number;
  /** Feed rate for non-cutting repositioning (returns, retracts). */
  travelFeedRate: number;
}

export const DEFAULT_TOOLPATH_RESOLUTION = 2;
export const DEFAULT_SAFE_HEIGHT = 10;
export const DEFAULT_TRAVEL_FEED_RATE = 2000;

export function pathSampleSpacing(resolution: number): number {
  const factor = Math.max(resolution, 0.5);
  return BASE_PATH_SAMPLE_SPACING * factor;
}

export function helixSegmentsPerRev(resolution: number): number {
  const factor = Math.max(resolution, 0.5);
  return Math.max(8, Math.round(BASE_HELIX_SEGMENTS_PER_REV / factor));
}

export function minkowskiSegmentLen(resolution: number): number {
  const factor = Math.max(resolution, 0.5);
  return BASE_MINKOWSKI_SEGMENT * factor;
}

export function contourSteps(resolution: number): number {
  const factor = Math.max(resolution, 0.5);
  return Math.max(8, Math.round(BASE_CONTOUR_STEPS / factor));
}

export function trochoidSampleSpacing(
  forwardIncrement: number,
  trochoidR: number,
  resolution: number
): number {
  const base = Math.min(forwardIncrement / 4, trochoidR / 2, 0.5);
  return base * Math.max(resolution, 0.5);
}

/** Fixed arc-length step for spur range mapping — never scales with user resolution. */
export const SPUR_ARC_MAP_SPACING = 0.06;

export function spurArcMapSpacing(_trochoidR: number, _resolution: number): number {
  return SPUR_ARC_MAP_SPACING;
}

export function safeHeightWorldZ(ctx: { worldTopZ: number }, safeHeight: number): number {
  return ctx.worldTopZ + Math.max(safeHeight, 0);
}
