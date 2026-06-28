/**
 * Constant circular-loop adaptive trochoid.
 *
 * Each orbit advances the circle center forward along the inner guide.
 * Angular position uses (1 − phase) so forward playback runs cut half then
 * return half. Trochoid radius and slot width stay constant; pass spacing
 * tightens on sharp convex bends and points outside the outer slot wall are
 * pulled back to preserve consistent engagement.
 */

import type { LoopPoint, ToolpathPoint } from '../types/operations';
import type { ArcLengthGuide } from './trochoidalPath';
import { buildArcLengthGuide, sampleGuideAtS } from './trochoidalPath';
import {
  clampToolCenterInsideOffsetLoop,
  clampToolCenterMinDistanceFromPart,
  signedLoopArea2D,
} from './geometryProcessing';

export interface FourZoneParams {
  forwardIncrement: number;
  slotClearance: number;
  z: number;
  liftAmount?: number;
  partLoop?: LoopPoint[];
  minCenterDist?: number;
  /** Outward offset loop marking the outer slot wall. */
  outerGuideLoop?: LoopPoint[];
}

const ANGLE_STEP = (4 * Math.PI) / 180;

const CUT_PHASE_END = 0.5;
const RETURN_LIFT_START = 0.58;
const RETURN_LIFT_END = 0.88;

/** Apply outer-wall clamp only where guide curvature is significant. */
const CORNER_TURN_THRESHOLD = 0.08;

interface PlanarFrame {
  x: number;
  y: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
}

function normalizeFrame(frame: ReturnType<typeof sampleGuideAtS>): PlanarFrame {
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

/** Guide turning rate (rad/mm) — high at convex part corners. */
function guideTurnRate(guide: ArcLengthGuide, s: number): number {
  const ds = 0.45;
  const a = sampleGuideAtS(guide, s - ds);
  const b = sampleGuideAtS(guide, s + ds);
  const dot = Math.max(-1, Math.min(1, a.tx * b.tx + a.ty * b.ty));
  return Math.acos(dot) / (2 * ds);
}

function peakGuideTurnRate(guide: ArcLengthGuide, s: number, window: number): number {
  const samples = 5;
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1) - 0.5;
    peak = Math.max(peak, guideTurnRate(guide, s + t * window));
  }
  return peak;
}

/** Shorten pass advance on tight bends so outer-edge spacing stays even. */
function localForwardIncrement(baseStep: number, turnRate: number): number {
  const bend = turnRate * baseStep;
  const scale = 1 / (1 + bend * bend * 4);
  return baseStep * Math.max(0.4, scale);
}

/** Pull orbit center inward on sharp bends to stop outer-arc blow-out. */
function orbitCenterScale(turnRate: number, baseStep: number): number {
  const bend = turnRate * baseStep;
  return 1 / (1 + bend * bend * 6);
}

function orbitPoint(
  frame: PlanarFrame,
  trochoidR: number,
  centerScale: number,
  theta: number,
  z: number
): ToolpathPoint {
  const cx = frame.x + frame.nx * trochoidR * centerScale;
  const cy = frame.y + frame.ny * trochoidR * centerScale;
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
  const baseStepover = params.forwardIncrement;
  const { slotClearance, z: zCut, liftAmount = 0 } = params;

  if (innerGuideLoop.length < 3 || baseStepover <= 0 || slotClearance <= 0) return [];

  const trochoidR = slotClearance / 2;
  const sampleSpacing = Math.min(baseStepover / 4, trochoidR / 2, 0.5);
  const guide = buildArcLengthGuide(innerGuideLoop, sampleSpacing);
  if (guide.totalLength <= 0) return [];

  const ccwGuide = signedLoopArea2D(innerGuideLoop) >= 0;
  const rotSign = ccwGuide ? -1 : 1;
  const steps = Math.max(2, Math.ceil((2 * Math.PI) / ANGLE_STEP));
  const points: ToolpathPoint[] = [];
  const { partLoop, minCenterDist, outerGuideLoop } = params;

  let sStart = 0;
  let cycle = 0;
  while (sStart < guide.totalLength - baseStepover * 0.01) {
    const turnRate = peakGuideTurnRate(guide, sStart, baseStepover);
    const stepover = localForwardIncrement(baseStepover, turnRate);
    const centerScale = orbitCenterScale(turnRate, baseStepover);

    for (let i = 0; i <= steps; i++) {
      const phase = i / steps;
      const sAlong = sStart + phase * stepover;
      if (sAlong > guide.totalLength + baseStepover * 0.01) break;

      const theta = -Math.PI / 2 + rotSign * (1 - phase) * 2 * Math.PI;
      const frame = normalizeFrame(sampleGuideAtS(guide, sAlong));
      const { z, rapid } = orbitZProfile(phase, zCut, liftAmount);

      let pt = orbitPoint(frame, trochoidR, centerScale, theta, z);

      if (partLoop && minCenterDist !== undefined) {
        const c = clampToolCenterMinDistanceFromPart(partLoop, pt.x, pt.y, minCenterDist);
        pt = { ...pt, x: c.x, y: c.y };
      }

      if (outerGuideLoop && outerGuideLoop.length >= 3) {
        const localTurn = guideTurnRate(guide, sAlong);
        if (localTurn > CORNER_TURN_THRESHOLD) {
          const c = clampToolCenterInsideOffsetLoop(outerGuideLoop, pt.x, pt.y);
          pt = { ...pt, x: c.x, y: c.y };
        }
      }

      if (rapid) pt = { ...pt, rapid: true };

      if (cycle > 0 && i === 0) continue;
      points.push(pt);
    }

    sStart += stepover;
    cycle++;
  }

  return points;
}

export function generateConstantEngagementTrochoid(
  innerGuideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  return generateFourZoneAdaptivePath(innerGuideLoop, params);
}
