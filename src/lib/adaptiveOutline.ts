import type { LoopPoint } from '../types/operations';
import type { OperationDefaults } from '../types/operations';
import { offsetLoop2D, signedLoopArea2D } from './geometryProcessing';

/** Default helix entry in stock outside the adaptive slot (when user has not picked one). */
export function computeDefaultEntryPoint(
  partLoop: LoopPoint[],
  settings: OperationDefaults
): { x: number; y: number } {
  if (partLoop.length < 2) return { x: 0, y: 0 };

  const toolD = Math.max(settings.toolDiameter, 0.1);
  const toolR = toolD / 2;
  const radial = toolR + Math.max(settings.radialOffset ?? 0, 0);
  const slotW = Math.max(settings.channelWidthMultiple ?? 1.5, 1.25) * toolD;

  const guide = offsetLoop2D(partLoop, radial);
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
  const dist = slotW * 0.75 + Math.max(settings.clearance, 2);

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
