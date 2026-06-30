import type { LoopPoint, OperationDefaults } from '../types/operations';
import type { CornerSpurOptions } from './cornerSpurs';
import { offsetLoop2DMinkowski, distanceToLoop2D, closestPointOnLoop2D } from './geometryProcessing';
import { adaptiveForwardIncrement } from './trochoidalPath';
import { ensureEntryOutsidePart, resolveBoreOuterRadius } from './entryPath';

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

/** Extra stock left on part walls during adaptive roughing when finishing pass is enabled. */
export const FINISHING_STOCK_ALLOWANCE = 0.1;

export interface AdaptiveSlotOptions {
  /** When false, omit roughing stock allowance (used for finishing outline). */
  roughing?: boolean;
}

/**
 * Corner spur options when roughing with finishing pass enabled.
 * Sharp corners reach finish depth; wide corners stop at rough stock to avoid overshoot.
 */
export function cornerSpurOptionsForRoughing(settings: OperationDefaults): CornerSpurOptions {
  if (!settings.finishingPass) return {};
  const roughSlot = resolveAdaptiveSlotGeometry(settings, { roughing: true });
  return {
    roughTipInnerOffset: roughSlot.innerCenterOffset,
    sharpAngleThresholdDeg: 100,
  };
}

export function resolveAdaptiveSlotGeometry(
  settings: OperationDefaults,
  options: AdaptiveSlotOptions = {}
): AdaptiveSlotGeometry {
  const toolDiameter = Math.max(settings.toolDiameter, 0.1);
  const toolRadius = toolDiameter / 2;
  const stockAllowance =
    settings.finishingPass && options.roughing !== false ? FINISHING_STOCK_ALLOWANCE : 0;
  const radialOffset = (settings.radialOffset ?? 0) + stockAllowance;
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

/**
 * Largest tool-center radius from bore center during entry — derived from the
 * greater of bore outer diameter and slot width so the widen spiral cannot
 * cross the inner slot path.
 */
export function resolveMaxEntryHelixRadius(settings: OperationDefaults): number {
  const slot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
  const boreOuterD = 2 * resolveBoreOuterRadius(settings);
  const effectiveDiameter = Math.max(boreOuterD, slot.slotWidth);
  return Math.max(effectiveDiameter / 2 - slot.toolRadius, 0.05);
}

/**
 * Minimum distance from part outline to bore center.
 * Clears the inner slot path for the largest tool orbit during entry (bore
 * helix or bottom widen spiral, whichever is greater).
 */
export function minimumEntryCenterDist(settings: OperationDefaults): number {
  const slot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
  return slot.minCenterDist + resolveMaxEntryHelixRadius(settings);
}

/** Outward offset from the inner slot guide to the bore center. */
export function boreCenterOffsetFromInnerGuide(settings: OperationDefaults): number {
  return resolveMaxEntryHelixRadius(settings);
}

/** Default helix entry: bore hugging inner slot path, as close to the part as allowed. */
export function computeDefaultEntryPoint(
  partLoop: LoopPoint[],
  settings: OperationDefaults
): { x: number; y: number } {
  if (partLoop.length < 2) return { x: 0, y: 0 };

  const slot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
  const guide = offsetLoop2DMinkowski(partLoop, slot.innerCenterOffset);
  const centerDist = minimumEntryCenterDist(settings);
  const innerDist = slot.minCenterDist;
  const outwardOffset = boreCenterOffsetFromInnerGuide(settings);

  let bestGuide = guide[0];
  let bestScore = Infinity;
  for (const p of guide) {
    const d = distanceToLoop2D(p.x, p.y, partLoop);
    const score = Math.abs(d - innerDist);
    if (score < bestScore) {
      bestScore = score;
      bestGuide = p;
    }
  }

  const outward = closestPointOnLoop2D(bestGuide.x, bestGuide.y, partLoop);
  return ensureEntryOutsidePart(
    partLoop,
    {
      x: bestGuide.x + outward.outX * outwardOffset,
      y: bestGuide.y + outward.outY * outwardOffset,
    },
    centerDist * 0.98
  );
}

export function resolveAdaptiveEntryPoint(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  entry?: { x: number; y: number } | null
): { x: number; y: number } {
  const minDist = minimumEntryCenterDist(settings);
  if (entry) {
    return ensureEntryOutsidePart(partLoop, entry, minDist);
  }
  return computeDefaultEntryPoint(partLoop, settings);
}
