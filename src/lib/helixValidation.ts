import type { HoleSelection, OperationDefaults } from '../types/operations';
import { finalCutWorldZ, stockTopWorldZ, type CutZContext } from './cutDepth';
import { resolveInteriorHelixRadius } from './entryPath';
import type { MeshIndex } from './meshSelection';

export type HelixHoleInvalidReason = 'hole-too-small' | 'taper-collapse';

export interface HelixHoleValidation {
  valid: boolean;
  reason?: HelixHoleInvalidReason;
}

const MIN_VIABLE_HELIX_RADIUS = 0.05;

export function validateHelixHole(
  holeRadius: number,
  settings: OperationDefaults,
  ctx: CutZContext
): HelixHoleValidation {
  const toolDiameter = Math.max(settings.toolDiameter, 0.1);
  const holeDiameter = holeRadius * 2;

  if (holeDiameter <= toolDiameter + 1e-6) {
    return { valid: false, reason: 'hole-too-small' };
  }

  const toolR = toolDiameter / 2;
  const cutR = resolveInteriorHelixRadius(holeRadius, toolR, settings.radialOffset ?? 0);

  if (cutR <= MIN_VIABLE_HELIX_RADIUS + 1e-6) {
    return { valid: false, reason: 'hole-too-small' };
  }

  if (settings.boreTaperAngleDeg > 0 && ctx.hasStock) {
    const topZ = stockTopWorldZ(ctx);
    const finalZ = finalCutWorldZ(ctx, settings.depthOffset);
    const depthBelowTop = topZ - finalZ;
    if (depthBelowTop > 1e-6) {
      const taperRad = (settings.boreTaperAngleDeg * Math.PI) / 180;
      const rawBottomR = cutR - depthBelowTop * Math.tan(taperRad);
      if (rawBottomR <= MIN_VIABLE_HELIX_RADIUS + 1e-6) {
        return { valid: false, reason: 'taper-collapse' };
      }
    }
  }

  return { valid: true };
}

export function helixHoleInvalidLabel(reason: HelixHoleInvalidReason): string {
  switch (reason) {
    case 'hole-too-small':
      return 'hole diameter must exceed tool diameter';
    case 'taper-collapse':
      return 'taper collapses helix radius before final depth';
  }
}

export function collectInvalidHelixHoleFaces(
  holes: HoleSelection[],
  settings: OperationDefaults,
  ctx: CutZContext,
  meshIndex: MeshIndex
): Set<number> {
  const invalid = new Set<number>();
  for (const hole of holes) {
    if (validateHelixHole(hole.radius, settings, ctx).valid) continue;
    for (const faceIndex of meshIndex.getWallFacesForHole(hole)) {
      invalid.add(faceIndex);
    }
  }
  return invalid;
}
