/**
 * Constant circular-loop adaptive trochoid (closed and open guides).
 */

import type { LoopPoint, ToolpathPoint } from '../types/operations';
import {
  buildArcLengthGuide,
  buildOpenArcLengthGuide,
  sampleGuideAtS,
  sampleOpenGuideAtS,
  type ArcLengthGuide,
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
  /** Arc-length on closed guide where the first cut cycle begins. */
  startS?: number;
  /** Skip this much arc length before cutting (e.g. connector already cleared join). */
  skipArcLength?: number;
  /** First orbit sample already cut by entry spiral — omit duplicate at phase 0. */
  omitFirstOrbitSample?: boolean;
  feedRate?: number;
  sampleSpacing?: number;
  /** Points per trochoid orbit; scales with global toolpath resolution. */
  orbitStepsPerRev?: number;
}

const CUT_PHASE_START = 0.5;
const RETURN_LIFT_START = 0.08;
const RETURN_LIFT_END = 0.38;

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
  // Return / lift on the first half of each micro-loop, cut on the second half.
  if (phase >= CUT_PHASE_START) {
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

/** Trochoid orbit angle (radians) at a given phase within one micro-loop. */
export function trochoidOrbitAngleAtPhase(phase: number, rotSign: number): number {
  return -Math.PI / 2 + rotSign * (0.5 - phase) * 2 * Math.PI;
}

/** Climb milling on external CCW loops → clockwise tool motion around the part. */
export function resolveGuideTraverseSign(guideLoop: LoopPoint[], climbMilling: boolean): number {
  const ccw = signedLoopArea2D(guideLoop) >= 0;
  return climbMilling ? (ccw ? -1 : 1) : ccw ? 1 : -1;
}

export function resolveOrbitRotSign(guideLoop: LoopPoint[], climbMilling: boolean): number {
  return resolveGuideTraverseSign(guideLoop, climbMilling);
}

function sampleOrbitPoint(
  sampleAtS: (s: number) => ReturnType<typeof sampleGuideAtS>,
  s: number,
  phase: number,
  trochoidR: number,
  rotSign: number,
  z: number,
  partLoop?: LoopPoint[],
  minCenterDist?: number
): ToolpathPoint {
  const theta = trochoidOrbitAngleAtPhase(phase, rotSign);
  const frame = normalizeFrame(sampleAtS(s));
  let pt = orbitPoint(frame, trochoidR, theta, z);
  if (partLoop && minCenterDist !== undefined) {
    const c = clampToolCenterMinDistanceFromPart(partLoop, pt.x, pt.y, minCenterDist);
    pt = { ...pt, x: c.x, y: c.y };
  }
  return pt;
}

/**
 * Expanding spiral at a fixed guide station using the trochoid local frame so the
 * final point matches phase 0 of the first slot-clearing micro-loop.
 */
export function generateTrochoidEntrySpiral(
  sampleAtS: (s: number) => ReturnType<typeof sampleGuideAtS>,
  joinS: number,
  params: {
    trochoidR: number;
    rotSign: number;
    z: number;
    radialStepPerRev: number;
    segmentsPerRev: number;
    partLoop?: LoopPoint[];
    minCenterDist?: number;
    feedRate?: number;
  }
): ToolpathPoint[] {
  const {
    trochoidR,
    rotSign,
    z,
    radialStepPerRev,
    segmentsPerRev,
    partLoop,
    minCenterDist,
    feedRate,
  } = params;

  const startR = 0.05;
  if (trochoidR <= startR + 1e-4 || radialStepPerRev <= 0) return [];

  const segments = Math.max(8, segmentsPerRev);
  const dr = radialStepPerRev / segments;
  const revs = Math.max(1, Math.ceil((trochoidR - startR) / radialStepPerRev));
  const endTheta = trochoidOrbitAngleAtPhase(CUT_PHASE_START, rotSign);
  let angle = endTheta - rotSign * revs * 2 * Math.PI;
  let r = startR;
  const points: ToolpathPoint[] = [];

  while (r < trochoidR - 1e-4) {
    for (let i = 0; i < segments; i++) {
      angle += rotSign * ((Math.PI * 2) / segments);
      r = Math.min(r + dr, trochoidR);
      const frame = normalizeFrame(sampleAtS(joinS));
      let pt = orbitPoint(frame, r, angle, z);
      if (partLoop && minCenterDist !== undefined) {
        const c = clampToolCenterMinDistanceFromPart(partLoop, pt.x, pt.y, minCenterDist);
        pt = { ...pt, x: c.x, y: c.y };
      }
      if (feedRate !== undefined) pt = { ...pt, feedRate };
      points.push(pt);
      if (r >= trochoidR - 1e-4) break;
    }
  }

  const endPt = sampleOrbitPoint(
    sampleAtS,
    joinS,
    CUT_PHASE_START,
    trochoidR,
    rotSign,
    z,
    partLoop,
    minCenterDist
  );
  if (feedRate !== undefined) endPt.feedRate = feedRate;
  if (points.length > 0) {
    points[points.length - 1] = endPt;
  } else {
    points.push(endPt);
  }

  return points;
}

export function sampleTrochoidOrbitPoint(
  slotCenterGuide: LoopPoint[],
  params: FourZoneParams & { startS: number; phase?: number }
): ToolpathPoint | null {
  if (slotCenterGuide.length < 3) return null;

  const trochoidR = params.slotClearance / 2;
  const sampleSpacing =
    params.sampleSpacing ??
    Math.min(params.forwardIncrement / 4, trochoidR / 2, 0.5);
  const guide = buildArcLengthGuide(slotCenterGuide, sampleSpacing);
  if (guide.totalLength <= 0) return null;

  const phase = params.phase ?? 0;
  const rotSign = params.rotSign ?? -1;
  return sampleOrbitPoint(
    (s) => sampleGuideAtS(guide, s),
    params.startS,
    phase,
    trochoidR,
    rotSign,
    params.z,
    params.partLoop,
    params.minCenterDist
  );
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
  const steps = Math.max(8, params.orbitStepsPerRev ?? 90);
  const points: ToolpathPoint[] = [];
  const { partLoop, minCenterDist } = params;
  const defaultStartS = guideSign >= 0 ? 0 : totalLength;
  const startS = params.startS ?? defaultStartS;

  const emitOrbit = (sAlong: number, phase: number, skipDuplicate: boolean) => {
    const sSample = guideSign >= 0 ? startS + sAlong : startS - sAlong;
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

    if (skipDuplicate) return;
    points.push(pt);
  };

  if (closed) {
    const skip = Math.max(params.skipArcLength ?? 0, 0);
    let arcProgress = skip;
    const arcTarget = skip + totalLength;
    let cycle = 0;

    while (arcProgress < arcTarget - 1e-5) {
      const segEnd = Math.min(arcProgress + stepover, arcTarget);
      const segLen = segEnd - arcProgress;

      for (let i = 0; i <= steps; i++) {
        const phase = i / steps;
        const sAlong = arcProgress + phase * segLen;
        const skipDup =
          (cycle > 0 && i === 0) ||
          (cycle === 0 && i === 0 && params.omitFirstOrbitSample === true);
        emitOrbit(sAlong, phase, skipDup);
      }

      arcProgress = segEnd;
      cycle++;
    }
    return points;
  }

  let arcProgress = 0;
  let cycle = 0;

  while (arcProgress < totalLength - 1e-5) {
    const segEnd = Math.min(arcProgress + stepover, totalLength);
    const segLen = segEnd - arcProgress;

    for (let i = 0; i <= steps; i++) {
      const phase = i / steps;
      const sAlong = arcProgress + phase * segLen;
      emitOrbit(sAlong, phase, cycle > 0 && i === 0);
    }

    arcProgress = segEnd;
    cycle++;
  }

  return points;
}

export function generateFourZoneAdaptivePath(
  slotCenterGuide: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  if (slotCenterGuide.length < 3) return [];

  const trochoidR = params.slotClearance / 2;
  const sampleSpacing =
    params.sampleSpacing ??
    Math.min(params.forwardIncrement / 4, trochoidR / 2, 0.5);
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
  const sampleSpacing =
    params.sampleSpacing ??
    Math.min(params.forwardIncrement / 4, trochoidR / 2, 0.5);
  const guide = buildOpenArcLengthGuide(openGuide, sampleSpacing, outwardCCW);
  if (guide.totalLength <= 0) return [];

  return generateTrochoidAlongGuide(
    guide.totalLength,
    false,
    (s) => sampleOpenGuideAtS(guide, s),
    params
  );
}

/**
 * Continuous trochoid roughing from a spline lead-in into a full slot-center loop.
 * Loop section uses closed-guide frames (same as deeper layers) for consistent lift.
 */
export function generateContinuousEntryTrochoidPath(
  splineGuide: LoopPoint[],
  trochArcGuide: ArcLengthGuide,
  trochoidStartS: number,
  guideTraverseSign: number,
  params: FourZoneParams,
  outwardCCW: boolean
): ToolpathPoint[] {
  if (trochArcGuide.totalLength <= 0) return [];

  const sampleSpacing =
    params.sampleSpacing ??
    Math.min(params.forwardIncrement / 4, params.slotClearance / 4, 0.5);

  const splineArcGuide =
    splineGuide.length >= 2
      ? buildOpenArcLengthGuide(splineGuide, sampleSpacing, outwardCCW)
      : null;
  const splineLen = splineArcGuide?.totalLength ?? 0;
  const totalLength = splineLen + trochArcGuide.totalLength;
  if (totalLength <= 0) return [];

  const forward = guideTraverseSign >= 0;
  const sampleAtGlobalS = (s: number) => {
    if (splineArcGuide && s < splineLen - 1e-6) {
      const frame = sampleOpenGuideAtS(splineArcGuide, Math.max(0, s));
      if (!forward) {
        return { ...frame, tx: -frame.tx, ty: -frame.ty, nx: -frame.nx, ny: -frame.ny };
      }
      return frame;
    }
    const loopDelta = Math.max(0, s - splineLen);
    const loopS = trochoidStartS + loopDelta;
    return sampleGuideAtS(trochArcGuide, loopS);
  };

  return generateTrochoidAlongGuide(totalLength, false, sampleAtGlobalS, params);
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
