import type { PartBounds } from './geometryProcessing';

const MIN_STEP_DOWN = 0.05;
const MAX_Z_LAYERS = 500;

function safeStepDown(stepDown: number): number {
  if (!Number.isFinite(stepDown) || stepDown <= 0) return MIN_STEP_DOWN;
  return Math.max(stepDown, MIN_STEP_DOWN);
}

/** Part thickness (mm). */
export function partHeightFromBounds(bounds: PartBounds | null): number {
  if (!bounds) return 10;
  return Math.max(bounds.maxZ - bounds.minZ, MIN_STEP_DOWN);
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

  const maxStep = safeStepDown(maxStepDown);
  const passCount = Math.min(Math.max(1, Math.ceil(totalDepth / maxStep)), MAX_Z_LAYERS);
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
}

export function createCutZContext(bounds: PartBounds | null): CutZContext {
  const worldTopZ = bounds?.maxZ ?? 10;
  return {
    partHeight: partHeightFromBounds(bounds),
    worldTopZ,
  };
}

export function stockTopWorldZ(ctx: CutZContext): number {
  return ctx.worldTopZ;
}

export function clearanceWorldZ(ctx: CutZContext, clearance: number): number {
  return camZToWorld(clearanceCamZ(clearance), ctx.worldTopZ);
}

export function cutLayersWorldZ(
  ctx: CutZContext,
  depthOffset: number,
  maxStepDown: number
): number[] {
  return computeCutLayersCamZ(ctx.partHeight, depthOffset, maxStepDown).map((z) =>
    camZToWorld(z, ctx.worldTopZ)
  );
}

export function finalCutWorldZ(ctx: CutZContext, depthOffset: number): number {
  return camZToWorld(resolveFinalCutCamZ(ctx.partHeight, depthOffset), ctx.worldTopZ);
}
