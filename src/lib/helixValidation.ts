import type { HoleSelection, OperationDefaults } from '../types/operations';
import { finalCutWorldZ, stockTopWorldZ, type CutZContext } from './cutDepth';
import { resolveInteriorHelixRadius } from './entryPath';
import type { MeshIndex } from './meshSelection';

export type HelixHoleInvalidReason = 'hole-too-small' | 'taper-collapse';

export interface HelixHoleValidation {
  valid: boolean;
  reason?: HelixHoleInvalidReason;
}

const CLEARANCE_EPS = 1e-3;

export function validateHelixHole(
  holeRadius: number,
  settings: OperationDefaults,
  ctx: CutZContext
): HelixHoleValidation {
  const toolDiameter = Math.max(settings.toolDiameter, 0.1);
  const holeDiameter = holeRadius * 2;

  if (holeDiameter <= toolDiameter + CLEARANCE_EPS) {
    return { valid: false, reason: 'hole-too-small' };
  }

  const toolR = toolDiameter / 2;
  const cutR = resolveInteriorHelixRadius(holeRadius, toolR, settings.radialOffset ?? 0);

  if (cutR <= CLEARANCE_EPS) {
    return { valid: false, reason: 'hole-too-small' };
  }

  if (settings.boreTaperAngleDeg > 0 && ctx.hasStock) {
    const topZ = stockTopWorldZ(ctx);
    const finalZ = finalCutWorldZ(ctx, settings.depthOffset);
    const depthBelowTop = topZ - finalZ;
    if (depthBelowTop > CLEARANCE_EPS) {
      const taperRad = (settings.boreTaperAngleDeg * Math.PI) / 180;
      const rawBottomR = cutR - depthBelowTop * Math.tan(taperRad);
      if (rawBottomR <= CLEARANCE_EPS) {
        return { valid: false, reason: 'taper-collapse' };
      }
    }
  }

  return { valid: true };
}

export function helixHoleInvalidLabel(reason: HelixHoleInvalidReason): string {
  switch (reason) {
    case 'hole-too-small':
      return 'hole diameter must exceed tool diameter with usable radial clearance';
    case 'taper-collapse':
      return 'taper collapses helix radius to zero or below before final depth';
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
