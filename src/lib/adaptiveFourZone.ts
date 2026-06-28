/**
 * Constant circular-loop adaptive trochoid.
 *
 * Each orbit advances the circle center forward by a fixed `stepover` along the
 * inner guide. Angular position uses (1 − phase) so forward playback runs cut
 * half then return half. Trochoid radius and pass spacing are uniform for the
 * full outline.
 *
 *   phase 0.0 → 0.5   cutting half  — inner → outer, flat at cut depth
 *   phase 0.5 → 0.58  return lead-out — still flat, leaving the outer arc
 *   phase 0.58 → 0.88 gradual lift (peaks mid-return) when liftAmount > 0
 *   phase 0.88 → 1.0  descend to cut depth before the next pass
 */

import type { LoopPoint, ToolpathPoint } from '../types/operations';
import { buildArcLengthGuide, sampleGuideAtS } from './trochoidalPath';
import { clampToolCenterMinDistanceFromPart, signedLoopArea2D } from './geometryProcessing';

export interface FourZoneParams {
  forwardIncrement: number;
  slotClearance: number;
  z: number;
  liftAmount?: number;
  partLoop?: LoopPoint[];
  minCenterDist?: number;
}

const ANGLE_STEP = (4 * Math.PI) / 180;

const CUT_PHASE_END = 0.5;
const RETURN_LIFT_START = 0.58;
const RETURN_LIFT_END = 0.88;

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

function orbitZProfile(
  phase: number,
  zCut: number,
  liftAmount: number
): { z: number; rapid: boolean } {
  if (phase <= CUT_PHASE_END) {
    return { z: zCut, rapid: false };
  }
  if (phase < RETURN_LIFT_START) {
    return { z: zCut, rapid: true };
  }
  if (phase >= RETURN_LIFT_END) {
    return { z: zCut, rapid: true };
  }
  if (liftAmount <= 0) {
    return { z: zCut, rapid: true };
  }
  const u = (phase - RETURN_LIFT_START) / (RETURN_LIFT_END - RETURN_LIFT_START);
  return { z: zCut + liftAmount * Math.sin(Math.PI * u), rapid: true };
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

      const theta = -Math.PI / 2 + rotSign * (1 - phase) * 2 * Math.PI;
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
