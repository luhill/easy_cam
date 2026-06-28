import type { LoopPoint } from '../types/operations';
import type { OperationDefaults } from '../types/operations';
import { offsetLoop2D, signedLoopArea2D } from './geometryProcessing';
import { adaptiveForwardIncrement } from './trochoidalPath';

export interface AdaptiveSlotGeometry {
  toolDiameter: number;
  toolRadius: number;
  radialOffset: number;
  /** Tool-center offset from part outline (tool radius + additional offset). */
  innerCenterOffset: number;
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
  const slotWidthPercent = Math.max(settings.slotWidthPercent ?? 150, 125);
  const slotWidth = toolDiameter * (slotWidthPercent / 100);
  const slotClearance = Math.max(slotWidth - toolDiameter, toolDiameter * 0.05);
  const trochoidRadius = slotClearance / 2;
  const forwardIncrement = adaptiveForwardIncrement(toolDiameter, settings.stepover);
  const innerCenterOffset = toolRadius + radialOffset;
  const minCenterDist = innerCenterOffset;
  const maxCenterDist = radialOffset + slotWidth - toolRadius;

  return {
    toolDiameter,
    toolRadius,
    radialOffset,
    innerCenterOffset,
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
  const guide = offsetLoop2D(partLoop, slot.innerCenterOffset);
  const p0 = guide[0];
  const p1 = guide[1];
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx / len;
  const ty = dy / len;
  const ccw = signedLoopArea2D(partLoop) >= 0;
  const nx = ccw ? ty : -ty;
  const ny = ccw ? -tx : tx;
  const dist = slot.slotWidth * 0.75 + Math.max(settings.clearance, 2);

  return { x: p0.x + nx * dist, y: p0.y + ny * dist };
}

export function resolveAdaptiveEntryPoint(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  entry?: { x: number; y: number } | null
): { x: number; y: number } {
  if (entry) return entry;
  return computeDefaultEntryPoint(partLoop, settings);
}
