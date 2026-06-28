/**
 * Constant circular-loop adaptive trochoid (closed and open guides).
 */

import type { LoopPoint, ToolpathPoint } from '../types/operations';
import {
  buildArcLengthGuide,
  buildOpenArcLengthGuide,
  sampleGuideAtS,
  sampleOpenGuideAtS,
} from './trochoidalPath';
import { clampToolCenterMinDistanceFromPart, signedLoopArea2D } from './geometryProcessing';

export interface FourZoneParams {
  forwardIncrement: number;
  slotClearance: number;
  z: number;
  liftAmount?: number;
  partLoop?: LoopPoint[];
  minCenterDist?: number;
  /** Orbit micro-loop direction (+1 CCW / −1 CW within each station). */
  rotSign?: number;
  /** Progression along guide (+1 forward / −1 reverse for climb). */
  guideSign?: number;
  feedRate?: number;
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
  return {
    x: frame.x + trochoidR * (Math.cos(theta) * frame.tx + Math.sin(theta) * frame.nx),
    y: frame.y + trochoidR * (Math.cos(theta) * frame.ty + Math.sin(theta) * frame.ny),
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

/** Climb milling on external CCW loops → clockwise tool motion around the part. */
export function resolveGuideTraverseSign(guideLoop: LoopPoint[], climbMilling: boolean): number {
  const ccw = signedLoopArea2D(guideLoop) >= 0;
  return climbMilling ? (ccw ? -1 : 1) : ccw ? 1 : -1;
}

export function resolveOrbitRotSign(guideLoop: LoopPoint[], climbMilling: boolean): number {
  return resolveGuideTraverseSign(guideLoop, climbMilling);
}

function generateTrochoidAlongGuide(
  totalLength: number,
  closed: boolean,
  sampleAtS: (s: number) => ReturnType<typeof sampleGuideAtS>,
  params: FourZoneParams
): ToolpathPoint[] {
  const stepover = params.forwardIncrement;
  const { slotClearance, z: zCut, liftAmount = 0, rotSign = -1, guideSign = 1, feedRate } = params;

  if (totalLength <= 0 || stepover <= 0 || slotClearance <= 0) return [];

  const trochoidR = slotClearance / 2;
  const numCycles = Math.ceil(totalLength / stepover);
  const steps = Math.max(2, Math.ceil((2 * Math.PI) / ANGLE_STEP));
  const points: ToolpathPoint[] = [];
  const { partLoop, minCenterDist } = params;

  for (let cycle = 0; cycle < numCycles; cycle++) {
    const sStart = cycle * stepover;

    for (let i = 0; i <= steps; i++) {
      const phase = i / steps;
      const sAlong = sStart + phase * stepover;
      if (sAlong > totalLength + stepover * 0.01) break;

      const sSample =
        guideSign >= 0
          ? Math.min(sAlong, totalLength)
          : Math.max(totalLength - sAlong, 0);
      const theta = -Math.PI / 2 + rotSign * (1 - phase) * 2 * Math.PI;
      const frame = normalizeFrame(sampleAtS(sSample));
      const { z, rapid } = orbitZProfile(phase, zCut, liftAmount);

      let pt = orbitPoint(frame, trochoidR, theta, z);
      if (partLoop && minCenterDist !== undefined) {
        const c = clampToolCenterMinDistanceFromPart(partLoop, pt.x, pt.y, minCenterDist);
        pt = { ...pt, x: c.x, y: c.y };
      }
      if (rapid) pt = { ...pt, rapid: true };
      if (feedRate !== undefined && !rapid) pt = { ...pt, feedRate };

      if (cycle > 0 && i === 0) continue;
      points.push(pt);
    }

    if (!closed && sStart + stepover >= totalLength - 1e-6) break;
  }

  return points;
}

export function generateFourZoneAdaptivePath(
  slotCenterGuide: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  if (slotCenterGuide.length < 3) return [];

  const trochoidR = params.slotClearance / 2;
  const sampleSpacing = Math.min(params.forwardIncrement / 4, trochoidR / 2, 0.5);
  const guide = buildArcLengthGuide(slotCenterGuide, sampleSpacing);
  if (guide.totalLength <= 0) return [];

  return generateTrochoidAlongGuide(
    guide.totalLength,
    true,
    (s) => sampleGuideAtS(guide, s),
    params
  );
}

/** Trochoid loops along an open guide (entry connector). */
export function generateOpenTrochoidPath(
  openGuide: LoopPoint[],
  params: FourZoneParams,
  outwardCCW: boolean
): ToolpathPoint[] {
  if (openGuide.length < 2) return [];

  const trochoidR = params.slotClearance / 2;
  const sampleSpacing = Math.min(params.forwardIncrement / 4, trochoidR / 2, 0.5);
  const guide = buildOpenArcLengthGuide(openGuide, sampleSpacing, outwardCCW);
  if (guide.totalLength <= 0) return [];

  return generateTrochoidAlongGuide(
    guide.totalLength,
    false,
    (s) => sampleOpenGuideAtS(guide, s),
    params
  );
}

export function generateConstantEngagementTrochoid(
  slotCenterGuide: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  return generateFourZoneAdaptivePath(slotCenterGuide, params);
}

export function wrapPathFromIndex<T>(path: T[], startIdx: number): T[] {
  if (path.length === 0) return [];
  const idx = ((startIdx % path.length) + path.length) % path.length;
  return [...path.slice(idx), ...path.slice(0, idx)];
}
