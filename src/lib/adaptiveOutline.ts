import type { LoopPoint } from '../types/operations';
import type { OperationDefaults } from '../types/operations';
import { offsetLoop2DMinkowski, distanceToLoop2D, closestPointOnLoop2D } from './geometryProcessing';
import { adaptiveForwardIncrement } from './trochoidalPath';
import { ensureEntryOutsidePart, minimumEntryStandoff } from './entryPath';

export interface AdaptiveSlotGeometry {
  toolDiameter: number;
  toolRadius: number;
  radialOffset: number;
  /** Tool-center offset from part outline (tool radius + additional offset). */
  innerCenterOffset: number;
  /** Tool-center offset for slot midline (constant-distance Minkowski path). */
  slotCenterOffset: number;
  /** Full slot width in stock (mm). */
  slotWidth: number;
  /** Lateral tool-center excursion outward from inner guide. */
  slotClearance: number;
  /** Auto trochoid radius derived from slot clearance. */
  trochoidRadius: number;
  forwardIncrement: number;
  minCenterDist: number;
  maxCenterDist: number;
}

export function resolveAdaptiveSlotGeometry(settings: OperationDefaults): AdaptiveSlotGeometry {
  const toolDiameter = Math.max(settings.toolDiameter, 0.1);
  const toolRadius = toolDiameter / 2;
  const radialOffset = settings.radialOffset ?? 0;
  const slotWidthPercent = Math.min(Math.max(settings.slotWidthPercent ?? 150, 125), 200);
  const slotWidth = toolDiameter * (slotWidthPercent / 100);
  const slotClearance = Math.max(slotWidth - toolDiameter, toolDiameter * 0.05);
  const trochoidRadius = slotClearance / 2;
  const forwardIncrement = adaptiveForwardIncrement(toolDiameter, settings.stepover);
  const innerCenterOffset = toolRadius + radialOffset;
  const minCenterDist = innerCenterOffset;
  const maxCenterDist = radialOffset + slotWidth - toolRadius;
  const slotCenterOffset = (minCenterDist + maxCenterDist) / 2;

  return {
    toolDiameter,
    toolRadius,
    radialOffset,
    innerCenterOffset,
    slotCenterOffset,
    slotWidth,
    slotClearance,
    trochoidRadius,
    forwardIncrement,
    minCenterDist,
    maxCenterDist,
  };
}

/** Default helix entry in stock outside the adaptive slot (when user has not picked one). */
export function computeDefaultEntryPoint(
  partLoop: LoopPoint[],
  settings: OperationDefaults
): { x: number; y: number } {
  if (partLoop.length < 2) return { x: 0, y: 0 };

  const slot = resolveAdaptiveSlotGeometry(settings);
  const guide = offsetLoop2DMinkowski(partLoop, slot.slotCenterOffset);
  const minStandoff = minimumEntryStandoff(settings);

  let bestGuide = guide[0];
  let bestDist = -Infinity;
  for (const p of guide) {
    const d = distanceToLoop2D(p.x, p.y, partLoop);
    if (d > bestDist) {
      bestDist = d;
      bestGuide = p;
    }
  }

  const outward = closestPointOnLoop2D(bestGuide.x, bestGuide.y, partLoop);
  const extra = Math.max(settings.clearance, 2);
  return ensureEntryOutsidePart(
    partLoop,
    {
      x: bestGuide.x + outward.outX * extra,
      y: bestGuide.y + outward.outY * extra,
    },
    minStandoff
  );
}

export function resolveAdaptiveEntryPoint(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  entry?: { x: number; y: number } | null
): { x: number; y: number } {
  const minStandoff = minimumEntryStandoff(settings);
  if (entry) {
    return ensureEntryOutsidePart(partLoop, entry, minStandoff);
  }
  return computeDefaultEntryPoint(partLoop, settings);
}
