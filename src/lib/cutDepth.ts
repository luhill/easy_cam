import type { PartBounds } from './geometryProcessing';

const MIN_STEP_DOWN = 0.05;
const MAX_Z_LAYERS = 500;

function safeStepDown(stepDown: number): number {
  if (!Number.isFinite(stepDown) || stepDown <= 0) return MIN_STEP_DOWN;
  return Math.max(stepDown, MIN_STEP_DOWN);
}

/** Part thickness (mm) from mesh bounds. */
export function partHeightFromBounds(bounds: PartBounds | null): number {
  if (!bounds) return 0;
  return Math.max(bounds.maxZ - bounds.minZ, 0);
}

/** CAM Z of the part bottom (top of part is Z=0). */
export function partBottomCamZ(partHeight: number): number {
  return -partHeight;
}

/**
 * Final cut plane in CAM Z (0 = top, negative = into part).
 * Positive depth offset finishes above the part bottom; negative goes below.
 */
export function resolveFinalCutCamZ(partHeight: number, depthOffset: number): number {
  return -partHeight + depthOffset;
}

/** Total downward distance from stock top to the final cut plane (mm). */
export function totalCutDepth(partHeight: number, depthOffset: number): number {
  return Math.max(-resolveFinalCutCamZ(partHeight, depthOffset), 0);
}

/** Number of Z passes for the given stock and step-down limit. */
export function computePassCount(
  partHeight: number,
  depthOffset: number,
  maxStepDown: number
): number {
  const totalDepth = totalCutDepth(partHeight, depthOffset);
  if (totalDepth <= 1e-6) return 0;
  const maxStep = safeStepDown(maxStepDown);
  return Math.min(Math.max(1, Math.ceil(totalDepth / maxStep)), MAX_Z_LAYERS);
}

/**
 * Z layers in CAM coordinates with equal step-down per pass.
 * Pass count = ceil(totalDepth / maxStepDown); each pass removes totalDepth / passCount.
 */
export function computeCutLayersCamZ(
  partHeight: number,
  depthOffset: number,
  maxStepDown: number
): number[] {
  const finalZ = resolveFinalCutCamZ(partHeight, depthOffset);
  const totalDepth = -finalZ;
  if (totalDepth <= 1e-6) return [];

  const passCount = computePassCount(partHeight, depthOffset, maxStepDown);
  if (passCount <= 0) return [];

  const equalStep = totalDepth / passCount;

  const layers: number[] = [];
  for (let i = 1; i <= passCount; i++) {
    layers.push(-i * equalStep);
  }
  layers[layers.length - 1] = finalZ;
  return layers;
}

/** Clearance plane above stock top in CAM Z. */
export function clearanceCamZ(clearance: number): number {
  return Math.max(clearance, 0);
}

export function camZToWorld(camZ: number, worldTopZ: number): number {
  return worldTopZ + camZ;
}

export interface CutZContext {
  partHeight: number;
  worldTopZ: number;
  worldBottomZ: number;
  hasStock: boolean;
}

export function createCutZContext(bounds: PartBounds | null): CutZContext {
  if (!bounds) {
    return { partHeight: 0, worldTopZ: 0, worldBottomZ: 0, hasStock: false };
  }
  return {
    partHeight: partHeightFromBounds(bounds),
    worldTopZ: bounds.maxZ,
    worldBottomZ: bounds.minZ,
    hasStock: true,
  };
}

export function stockTopWorldZ(ctx: CutZContext): number {
  return ctx.worldTopZ;
}

export function clearanceWorldZ(ctx: CutZContext, clearance: number): number {
  if (!ctx.hasStock) return clearance;
  return camZToWorld(clearanceCamZ(clearance), ctx.worldTopZ);
}

export function cutLayersWorldZ(
  ctx: CutZContext,
  depthOffset: number,
  maxStepDown: number
): number[] {
  if (!ctx.hasStock || ctx.partHeight <= 1e-6) return [];
  return computeCutLayersCamZ(ctx.partHeight, depthOffset, maxStepDown).map((z) =>
    camZToWorld(z, ctx.worldTopZ)
  );
}

export function finalCutWorldZ(ctx: CutZContext, depthOffset: number): number {
  if (!ctx.hasStock) return ctx.worldTopZ;
  return camZToWorld(resolveFinalCutCamZ(ctx.partHeight, depthOffset), ctx.worldTopZ);
}

/** Cut extent for outline from selected vertical edge loop(s), or full stock when unset. */
export interface OutlineCutExtent {
  cutTopZ: number;
  cutBottomZ: number;
  cutHeight: number;
}

export function outlineCutExtentFromLoopZ(topZ: number, bottomZ: number): OutlineCutExtent {
  return {
    cutTopZ: topZ,
    cutBottomZ: bottomZ,
    cutHeight: Math.max(topZ - bottomZ, 0),
  };
}

export function defaultOutlineCutExtent(ctx: CutZContext): OutlineCutExtent {
  return {
    cutTopZ: ctx.worldTopZ,
    cutBottomZ: ctx.worldBottomZ,
    cutHeight: ctx.partHeight,
  };
}

/** Z layers from a selected edge-loop extent; depth offset is relative to cutBottomZ. */
export function cutLayersWorldZForExtent(
  extent: OutlineCutExtent,
  depthOffset: number,
  maxStepDown: number
): number[] {
  const finalZ = extent.cutBottomZ + depthOffset;
  const totalDepth = extent.cutTopZ - finalZ;
  if (totalDepth <= 1e-6) return [];

  const passCount = Math.min(
    Math.max(1, Math.ceil(totalDepth / safeStepDown(maxStepDown))),
    MAX_Z_LAYERS
  );
  const equalStep = totalDepth / passCount;
  const layers: number[] = [];
  for (let i = 1; i <= passCount; i++) {
    layers.push(extent.cutTopZ - i * equalStep);
  }
  layers[layers.length - 1] = finalZ;
  return layers;
}

export function finalCutWorldZForExtent(extent: OutlineCutExtent, depthOffset: number): number {
  return extent.cutBottomZ + depthOffset;
}

/** Convert world Z to CAM Z (0 at stock top). */
export function worldZToCamZ(worldZ: number, stockTopWorldZ: number): number {
  return worldZ - stockTopWorldZ;
}

/** Default WCS Z: 10 mm above stock top. */
export const DEFAULT_WCS_Z_ABOVE_STOCK = 10;
