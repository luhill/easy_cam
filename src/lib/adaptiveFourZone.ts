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
import {
  trochoidRadiusAtGuideS,
  spurPeakHoldAtGuideS,
  spurFrameFromLinear,
  spurLinearParams,
  resolveSpurLinearState,
  spurLinearParamsFromGeometry,
  spurOrbitRadius,
  clampCutPointToSpur,
  clampCutPointPastSpurTips,
  clampCutInwardOfSpurPeak,
  clampArcEndToSpurBoundaries,
  clampOpenArcEndToSpurBoundaries,
  resolveSpurGuardBuffer,
  loopSpurGuideS,
  nextSpurBoundaryAlongClosedLoop,
  nextSpurBoundaryAlongOpenPath,
  type CornerSpurRange,
} from './cornerSpurs';

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
  /** Orbit radius vs guide arc length (for corner spur ramps). */
  trochoidRAtGuide?: (guideS: number) => number;
  /** Pre-built arc guide (must match spur range mapping). */
  arcGuide?: ArcLengthGuide;
  /** Snap tool center to exact spur tip inside peak deadband (prevents U-turn overshoot). */
  spurPeakHold?: (guideS: number) => { x: number; y: number } | null;
  /** Bisector-local frame on spur (open-path loopS conversion). */
  spurFrameHold?: (
    guideS: number,
    z: number
  ) => { x: number; y: number; z: number; tx: number; ty: number; nx: number; ny: number } | null;
  /** Spur ranges for boundary-aligned stepover snapping (closed loop only). */
  spurRanges?: CornerSpurRange[];
  /** Closed loop length paired with spurRanges for boundary snapping. */
  guideLoopLength?: number;
  /** Open spline+loop path spur boundary snapping (entry trochoid). */
  openSpurSnap?: {
    splineLen: number;
    trochoidStartS: number;
    forward: boolean;
    loopLength: number;
  };
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

  const baseTrochoidR = slotClearance / 2;
  const steps = Math.max(8, params.orbitStepsPerRev ?? 90);
  const points: ToolpathPoint[] = [];
  const { partLoop, minCenterDist } = params;
  const defaultStartS = guideSign >= 0 ? 0 : totalLength;
  const startS = params.startS ?? defaultStartS;
  const openSpurSnap = params.openSpurSnap;
  const loopLength = params.guideLoopLength ?? openSpurSnap?.loopLength ?? totalLength;
  const spurRanges = params.spurRanges ?? [];
  const spurGuardBuffer =
    spurRanges.length > 0
      ? resolveSpurGuardBuffer(baseTrochoidR, stepover, loopLength)
      : 0;

  const advancePastZeroSegment = (
    arcProgress: number,
    arcTarget: number,
    closedLoop: boolean
  ): number => {
    const minStep = Math.max(stepover * 0.05, 0.02);
    let segEnd = Math.min(arcProgress + minStep, arcTarget);

    if (spurRanges.length > 0) {
      const nextBoundary = closedLoop
        ? nextSpurBoundaryAlongClosedLoop(
            arcProgress,
            startS,
            guideSign,
            loopLength,
            spurRanges
          )
        : openSpurSnap
          ? nextSpurBoundaryAlongOpenPath(
              arcProgress,
              openSpurSnap.splineLen,
              openSpurSnap.trochoidStartS,
              openSpurSnap.forward,
              openSpurSnap.loopLength,
              spurRanges
            )
          : null;

      if (nextBoundary !== null && nextBoundary > arcProgress + 1e-8) {
        segEnd = Math.min(nextBoundary, arcTarget);
      }

      if (closedLoop) {
        segEnd = clampArcEndToSpurBoundaries(
          arcProgress,
          segEnd,
          startS,
          guideSign,
          loopLength,
          spurRanges,
          spurGuardBuffer
        );
      } else if (openSpurSnap) {
        segEnd = clampOpenArcEndToSpurBoundaries(
          arcProgress,
          segEnd,
          openSpurSnap.splineLen,
          openSpurSnap.trochoidStartS,
          openSpurSnap.forward,
          openSpurSnap.loopLength,
          spurRanges,
          spurGuardBuffer
        );
      }
    }

    return segEnd;
  };

  const emitOrbit = (sAlong: number, phase: number, skipDuplicate: boolean) => {
    const sSample = guideSign >= 0 ? startS + sAlong : startS - sAlong;
    const theta = -Math.PI / 2 + rotSign * (1 - phase) * 2 * Math.PI;
    const sampled = sampleAtS(sSample);
    const { z, rapid } = orbitZProfile(phase, zCut, liftAmount);

    const spurLoopS = loopSpurGuideS(sSample, loopLength, openSpurSnap);
    const arcSpur =
      spurLoopS !== null && spurRanges.length > 0
        ? spurLinearParams(spurLoopS, loopLength, spurRanges)
        : null;
    let spurState = arcSpur;
    if (arcSpur !== null) {
      spurState =
        resolveSpurLinearState(
          spurLoopS!,
          sampled.x,
          sampled.y,
          loopLength,
          spurRanges,
          baseTrochoidR * 1.25
        ) ?? arcSpur;
    } else if (
      spurRanges.length > 0 &&
      spurLoopS !== null &&
      (!openSpurSnap || sSample >= openSpurSnap.splineLen - 1e-5)
    ) {
      spurState = spurLinearParamsFromGeometry(
        sampled.x,
        sampled.y,
        spurRanges,
        baseTrochoidR * 1.25
      );
    }

    const spurFrame = spurState
      ? spurFrameFromLinear(spurState, sampled.z)
      : params.spurFrameHold?.(sSample, sampled.z) ?? null;

    const frame = spurFrame
      ? normalizeFrame({ ...sampled, ...spurFrame, s: sampled.s })
      : normalizeFrame(sampled);

    const orbitR = spurState
      ? spurOrbitRadius(spurState, baseTrochoidR)
      : params.trochoidRAtGuide && spurLoopS !== null
        ? params.trochoidRAtGuide(spurLoopS)
        : baseTrochoidR;

    if (orbitR <= baseTrochoidR * 0.02) {
      if (phase >= CUT_PHASE_START && !skipDuplicate) {
        const cx = spurState
          ? spurState.leg === 'out' && spurState.u >= 1 - 1e-4
            ? spurState.spur.peakX
            : spurState.leg === 'in' && spurState.u <= 1e-4
              ? spurState.spur.peakX
              : frame.x
          : (params.spurPeakHold?.(sSample)?.x ?? frame.x);
        const cy = spurState
          ? spurState.leg === 'out' && spurState.u >= 1 - 1e-4
            ? spurState.spur.peakY
            : spurState.leg === 'in' && spurState.u <= 1e-4
              ? spurState.spur.peakY
              : frame.y
          : (params.spurPeakHold?.(sSample)?.y ?? frame.y);
        let tipPt: ToolpathPoint = { x: cx, y: cy, z };
        if (feedRate !== undefined) tipPt = { ...tipPt, feedRate };
        points.push(tipPt);
      }
      return;
    }

    let pt = orbitPoint(frame, orbitR, theta, z);
    if (spurState && phase >= CUT_PHASE_START && !rapid) {
      let clamped = clampCutPointToSpur(pt.x, pt.y, spurState);
      clamped = clampCutPointPastSpurTips(
        clamped.x,
        clamped.y,
        [spurState.spur],
        baseTrochoidR
      );
      if (partLoop) {
        clamped = clampCutInwardOfSpurPeak(
          clamped.x,
          clamped.y,
          spurState.spur,
          partLoop
        );
      }
      pt = { ...pt, x: clamped.x, y: clamped.y };
    }
    if (
      partLoop &&
      minCenterDist !== undefined &&
      !spurState &&
      phase >= CUT_PHASE_START &&
      !rapid
    ) {
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
      let segEnd = Math.min(arcProgress + stepover, arcTarget);
      if (spurRanges.length > 0) {
        segEnd = clampArcEndToSpurBoundaries(
          arcProgress,
          segEnd,
          startS,
          guideSign,
          loopLength,
          spurRanges,
          spurGuardBuffer
        );
      }
      const segLen = segEnd - arcProgress;
      if (segLen <= 1e-8) {
        segEnd = advancePastZeroSegment(arcProgress, arcTarget, true);
        if (segEnd <= arcProgress + 1e-8) break;
      }

      const effectiveSegLen = segEnd - arcProgress;

      for (let i = 0; i <= steps; i++) {
        const phase = i / steps;
        const sAlong = arcProgress + phase * effectiveSegLen;
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
    let segEnd = Math.min(arcProgress + stepover, totalLength);
    if (openSpurSnap && spurRanges.length > 0) {
      segEnd = clampOpenArcEndToSpurBoundaries(
        arcProgress,
        segEnd,
        openSpurSnap.splineLen,
        openSpurSnap.trochoidStartS,
        openSpurSnap.forward,
        openSpurSnap.loopLength,
        spurRanges,
        spurGuardBuffer
      );
    }
    let segLen = segEnd - arcProgress;
    if (segLen <= 1e-8) {
      segEnd = advancePastZeroSegment(arcProgress, totalLength, false);
      segLen = segEnd - arcProgress;
      if (segLen <= 1e-8) break;
    }

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
  params: FourZoneParams,
  spurRanges: CornerSpurRange[] = []
): ToolpathPoint[] {
  if (slotCenterGuide.length < 3) return [];

  const trochoidR = params.slotClearance / 2;
  const sampleSpacing =
    params.sampleSpacing ??
    Math.min(params.forwardIncrement / 4, trochoidR / 2, 0.5);
  const guide =
    params.arcGuide ?? buildArcLengthGuide(slotCenterGuide, sampleSpacing);
  if (guide.totalLength <= 0) return [];

  const loopTotal = guide.totalLength;
  const spurPeakHold =
    spurRanges.length > 0
      ? (guideS: number) => spurPeakHoldAtGuideS(guideS, loopTotal, spurRanges)
      : undefined;

  return generateTrochoidAlongGuide(
    guide.totalLength,
    true,
    (s) => sampleGuideAtS(guide, s),
    {
      ...params,
      spurPeakHold,
      spurRanges,
      guideLoopLength: loopTotal,
      arcGuide: guide,
    }
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
  outwardCCW: boolean,
  loopSpurRanges: CornerSpurRange[] = []
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
      return sampleOpenGuideAtS(splineArcGuide, Math.max(0, s));
    }
    const loopDelta = Math.max(0, s - splineLen);
    const loopS = forward
      ? trochoidStartS + loopDelta
      : trochoidStartS - loopDelta;
    return sampleGuideAtS(trochArcGuide, loopS);
  };

  // Always emit spline (tool start → slot join) then the loop so bore lead-in
  // connects to troch[0] near the entry; loop traverse follows guideTraverseSign.
  const baseTrochoidR = params.slotClearance / 2;
  const loopTotal = trochArcGuide.totalLength;
  let trochoidRAtGuide = params.trochoidRAtGuide;
  if (loopSpurRanges.length > 0 && !trochoidRAtGuide) {
    trochoidRAtGuide = (globalS: number) => {
      if (globalS < splineLen - 1e-5) return baseTrochoidR;
      const loopDelta = globalS - splineLen;
      const loopS = forward ? trochoidStartS + loopDelta : trochoidStartS - loopDelta;
      return trochoidRadiusAtGuideS(loopS, loopTotal, baseTrochoidR, loopSpurRanges);
    };
  }

  const toLoopS = (globalS: number) => {
    const loopDelta = globalS - splineLen;
    return forward ? trochoidStartS + loopDelta : trochoidStartS - loopDelta;
  };

  return generateTrochoidAlongGuide(totalLength, false, sampleAtGlobalS, {
    ...params,
    guideSign: 1,
    startS: 0,
    guideLoopLength: loopTotal,
    trochoidRAtGuide,
    spurRanges: loopSpurRanges,
    openSpurSnap:
      loopSpurRanges.length > 0
        ? { splineLen, trochoidStartS, forward, loopLength: loopTotal }
        : undefined,
    spurPeakHold:
      loopSpurRanges.length > 0
        ? (globalS: number) => {
            if (globalS < splineLen - 1e-5) return null;
            return spurPeakHoldAtGuideS(toLoopS(globalS), loopTotal, loopSpurRanges);
          }
        : undefined,
  });
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
