/**
 * Constant circular-loop adaptive trochoid.
 *
 * Each pass is one full orbit while the circle center advances forward along
 * the inner guide by `forwardIncrement` (stepover). The first half of the
 * orbit engages material; the second half is the return stroke through cleared
 * space with optional gradual Z lift (peaks at the midpoint of the return half).
 *
 *   phase 0.0 → cutEnd       cutting — fully at cut depth
 *   phase cutEnd → liftStart return lead-out — still at cut depth (rapid)
 *   phase liftStart → liftEnd  gradual lift, peaks at midpoint
 *   phase liftEnd → 1.0      descend back to cut depth before next pass
 */

import type { LoopPoint, ToolpathPoint } from '../types/operations';
import { buildArcLengthGuide, sampleGuideAtS } from './trochoidalPath';
import { clampToolCenterMinDistanceFromPart, signedLoopArea2D } from './geometryProcessing';

export interface FourZoneParams {
  /** Forward advance per full orbit (mm) — stepover. */
  forwardIncrement: number;
  /** Lateral orbit diameter component = slotWidth − toolDiameter (mm). */
  slotClearance: number;
  z: number;
  /** Peak Z lift at the middle of the return half (mm). 0 = flat throughout. */
  liftAmount?: number;
  partLoop?: LoopPoint[];
  minCenterDist?: number;
}

const ANGLE_STEP = (4 * Math.PI) / 180;

/** Phase thresholds within one orbit (0–1). */
const CUT_PHASE_END = 0.5;
const RETURN_LEAD_OUT_END = 0.58; // flat at depth while leaving the outer arc
const LIFT_END = 0.88; // begin descent — fully flat before phase 1.0 / next pass

function normalizeFrame(frame: ReturnType<typeof sampleGuideAtS>) {
  let tx = frame.tx;
  let ty = frame.ty;
  let nx = frame.nx;
  let ny = frame.ny;
  const nlen = Math.hypot(nx, ny) || 1;
  nx /= nlen;
  ny /= nlen;
  const tlen = Math.hypot(tx, ty) || 1;
  tx /= tlen;
  ty /= tlen;
  return { x: frame.x, y: frame.y, tx, ty, nx, ny };
}

function orbitPoint(
  frame: ReturnType<typeof normalizeFrame>,
  trochoidR: number,
  theta: number,
  z: number
): ToolpathPoint {
  const cx = frame.x + frame.nx * trochoidR;
  const cy = frame.y + frame.ny * trochoidR;
  return {
    x: cx + trochoidR * (Math.cos(theta) * frame.tx + Math.sin(theta) * frame.nx),
    y: cy + trochoidR * (Math.cos(theta) * frame.ty + Math.sin(theta) * frame.ny),
    z,
  };
}

/** Z and rapid flag for a point on the orbit (phase ∈ [0, 1] within one loop). */
function orbitZProfile(
  phase: number,
  zCut: number,
  liftAmount: number
): { z: number; rapid: boolean } {
  // Entire cutting half — always flat at cut depth
  if (phase <= CUT_PHASE_END) {
    return { z: zCut, rapid: false };
  }

  // Return half — rapid traverse (non-cutting)
  // Lead-out: stay at cut depth while pulling off the outer arc
  if (phase < RETURN_LEAD_OUT_END) {
    return { z: zCut, rapid: true };
  }

  // Tail: back on inner guide, flat at cut depth before next engagement
  if (phase >= LIFT_END) {
    return { z: zCut, rapid: true };
  }

  // Middle of return — gradual lift (0 when liftAmount is 0)
  if (liftAmount <= 0) {
    return { z: zCut, rapid: true };
  }

  const u = (phase - RETURN_LEAD_OUT_END) / (LIFT_END - RETURN_LEAD_OUT_END);
  const z = zCut + liftAmount * Math.sin(Math.PI * u);
  return { z, rapid: true };
}

export function generateFourZoneAdaptivePath(
  innerGuideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  const stepover = params.forwardIncrement;
  const { slotClearance, z: zCut, liftAmount = 0 } = params;

  if (innerGuideLoop.length < 3 || stepover <= 0 || slotClearance <= 0) return [];

  const trochoidR = slotClearance / 2;
  const sampleSpacing = Math.min(stepover / 4, trochoidR / 2, 0.5);
  const guide = buildArcLengthGuide(innerGuideLoop, sampleSpacing);
  if (guide.totalLength <= 0) return [];

  const ccwGuide = signedLoopArea2D(innerGuideLoop) >= 0;
  const rotSign = ccwGuide ? -1 : 1;
  const numCycles = Math.ceil(guide.totalLength / stepover);
  const steps = Math.max(2, Math.ceil((2 * Math.PI) / ANGLE_STEP));
  const points: ToolpathPoint[] = [];
  const { partLoop, minCenterDist } = params;

  for (let cycle = 0; cycle < numCycles; cycle++) {
    const sStart = cycle * stepover;

    for (let i = 0; i <= steps; i++) {
      const phase = i / steps;
      const sAlong = sStart + phase * stepover;
      if (sAlong > guide.totalLength + stepover * 0.01) break;

      const theta = -Math.PI / 2 + rotSign * phase * 2 * Math.PI;
      const frame = normalizeFrame(sampleGuideAtS(guide, sAlong));
      const { z, rapid } = orbitZProfile(phase, zCut, liftAmount);

      let pt = orbitPoint(frame, trochoidR, theta, z);
      if (partLoop && minCenterDist !== undefined) {
        const c = clampToolCenterMinDistanceFromPart(
          partLoop,
          pt.x,
          pt.y,
          minCenterDist
        );
        pt = { ...pt, x: c.x, y: c.y };
      }
      if (rapid) pt = { ...pt, rapid: true };

      if (cycle > 0 && i === 0) continue;
      points.push(pt);
    }
  }

  return points;
}

export function generateConstantEngagementTrochoid(
  innerGuideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  return generateFourZoneAdaptivePath(innerGuideLoop, params);
}
