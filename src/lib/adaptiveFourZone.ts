/**
 * Constant circular-loop adaptive trochoid.
 *
 * Each orbit advances the circle center forward by `stepover` along the inner
 * guide. Angular position uses (1 − phase) so forward playback runs cut half
 * then return half. Outward motion is clamped to a local engagement strip and
 * reduced at high guide curvature to prevent convex-corner blow-out into stock.
 */

import type { LoopPoint, ToolpathPoint } from '../types/operations';
import type { ArcLengthGuide } from './trochoidalPath';
import { buildArcLengthGuide, sampleGuideAtS } from './trochoidalPath';
import {
  clampToolCenterMaxDistanceFromPart,
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
  /** Max tool-center distance from part outline (outer slot wall). */
  maxCenterDist?: number;
}

const ANGLE_STEP = (4 * Math.PI) / 180;

const CUT_PHASE_END = 0.5;
const RETURN_LIFT_START = 0.58;
const RETURN_LIFT_END = 0.88;

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

/** Peak turn rate over a window so corner limits apply before/at/after the apex. */
function peakGuideTurnRate(guide: ArcLengthGuide, s: number, window: number): number {
  const samples = 7;
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1) - 0.5;
    peak = Math.max(peak, guideTurnRate(guide, s + t * window));
  }
  return peak;
}

/**
 * Reduce allowable outward engagement at sharp guide bends so convex corners
 * do not fling the tool into excess uncut material.
 */
function engagementOutwardLimit(slotClearance: number, turnRate: number): number {
  const k = turnRate * slotClearance * 7;
  const scale = 1 / (1 + k * k);
  return slotClearance * Math.max(0.3, scale);
}

function orbitPoint(
  frame: PlanarFrame,
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

/** Keep tool in the local slot strip [0, maxOutward] normal to the inner guide. */
function clampToLocalEngagementStrip(
  frame: PlanarFrame,
  pt: ToolpathPoint,
  maxOutward: number
): ToolpathPoint {
  const dx = pt.x - frame.x;
  const dy = pt.y - frame.y;
  let outN = dx * frame.nx + dy * frame.ny;
  const outT = dx * frame.tx + dy * frame.ty;
  outN = Math.max(0, Math.min(maxOutward, outN));
  return {
    x: frame.x + outT * frame.tx + outN * frame.nx,
    y: frame.y + outT * frame.ty + outN * frame.ny,
    z: pt.z,
  };
}

function applyPartCorridor(
  pt: ToolpathPoint,
  partLoop: LoopPoint[] | undefined,
  minDist: number | undefined,
  maxDist: number | undefined
): ToolpathPoint {
  if (!partLoop) return pt;
  let { x, y } = pt;
  if (minDist !== undefined) {
    const c = clampToolCenterMinDistanceFromPart(partLoop, x, y, minDist);
    x = c.x;
    y = c.y;
  }
  if (maxDist !== undefined) {
    const c = clampToolCenterMaxDistanceFromPart(partLoop, x, y, maxDist);
    x = c.x;
    y = c.y;
  }
  return { ...pt, x, y };
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
  const sampleSpacing = Math.min(stepover / 6, trochoidR / 3, 0.35);
  const guide = buildArcLengthGuide(innerGuideLoop, sampleSpacing);
  if (guide.totalLength <= 0) return [];

  const ccwGuide = signedLoopArea2D(innerGuideLoop) >= 0;
  const rotSign = ccwGuide ? -1 : 1;
  const numCycles = Math.ceil(guide.totalLength / stepover);
  const steps = Math.max(2, Math.ceil((2 * Math.PI) / ANGLE_STEP));
  const points: ToolpathPoint[] = [];
  const { partLoop, minCenterDist, maxCenterDist } = params;

  for (let cycle = 0; cycle < numCycles; cycle++) {
    const sStart = cycle * stepover;

    for (let i = 0; i <= steps; i++) {
      const phase = i / steps;
      const sAlong = sStart + phase * stepover;
      if (sAlong > guide.totalLength + stepover * 0.01) break;

      const theta = -Math.PI / 2 + rotSign * (1 - phase) * 2 * Math.PI;
      const frame = normalizeFrame(sampleGuideAtS(guide, sAlong));
      const { z, rapid } = orbitZProfile(phase, zCut, liftAmount);

      const turnRate = peakGuideTurnRate(guide, sAlong, stepover);
      const maxOutward = engagementOutwardLimit(slotClearance, turnRate);
      const effectiveR = Math.min(trochoidR, maxOutward / 2);

      let pt = orbitPoint(frame, effectiveR, theta, z);
      pt = clampToLocalEngagementStrip(frame, pt, maxOutward);
      pt = applyPartCorridor(pt, partLoop, minCenterDist, maxCenterDist);

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
