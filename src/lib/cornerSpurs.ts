/**
 * Bisector spurs on the slot centerline at sharp concave corners so trochoidal
 * roughing can reach the finish-outline miter before the final pass.
 */

import type { LoopPoint } from '../types/operations';
import {
  offsetMiterVertex,
  offsetLoop2DMinkowski,
  resolveOutlineOffsetDelta,
  signedLoopArea2D,
  closestPointOnLoop2D,
  type OutlineWallSide,
} from './geometryProcessing';
import {
  buildArcLengthGuide,
  findClosestSOnGuide,
  advanceGuideArcLength,
  sampleGuideAtS,
  type ArcLengthGuide,
} from './trochoidalPath';
import { SPUR_ARC_MAP_SPACING } from './toolpathConfig';

export interface CornerSpurRange {
  /** Arc length where spur leaves the main slot centerline (full trochoid radius). */
  sStart: number;
  /** Arc length at the finish-corner miter tip (trochoid radius → 0). */
  sPeak: number;
  /** Arc length where spur rejoins the main slot centerline (0 → full radius). */
  sEnd: number;
  /** Exact bisector tip XY — used to prevent U-turn frame overshoot. */
  peakX: number;
  peakY: number;
  /** Slot miter XY where spur leaves the main centerline. */
  miterX: number;
  miterY: number;
}

interface CornerSpurMarker {
  miterIdx: number;
  peakIdx: number;
  returnIdx: number;
}

export interface SlotCenterGuideResult {
  guide: LoopPoint[];
  spurMarkers: CornerSpurMarker[];
}

export interface CornerSpurOptions {
  /** Only spur when internal corner angle is below this (degrees). Default 160. */
  maxInternalAngleDeg?: number;
  /** Minimum bisector spur length to insert (mm). Default 0.08. */
  minSpurLength?: number;
  /**
   * When set (finishing pass + roughing), spur tips use this offset instead of
   * finishInnerOffset so the bisector stops at the rough stock envelope.
   */
  roughTipInnerOffset?: number;
}

function pointsNear(
  a: { x: number; y: number },
  b: { x: number; y: number },
  eps = 1e-4
): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= eps;
}

function lastGuidePoint(guide: LoopPoint[]): LoopPoint | null {
  return guide.length > 0 ? guide[guide.length - 1] : null;
}

function appendDensifiedSegment(
  result: LoopPoint[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  segLen: number,
  skipFirst: boolean
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return;

  const steps = Math.max(1, Math.ceil(len / segLen));
  const start = skipFirst ? 1 : 0;
  for (let s = start; s <= steps; s++) {
    const t = s / steps;
    result.push({
      x: ax + dx * t,
      y: ay + dy * t,
      z: az + (bz - az) * t,
    });
  }
}

function vertexInternalAngleDeg(prev: LoopPoint, curr: LoopPoint, next: LoopPoint): number {
  const v1x = prev.x - curr.x;
  const v1y = prev.y - curr.y;
  const v2x = next.x - curr.x;
  const v2y = next.y - curr.y;
  const len1 = Math.hypot(v1x, v1y) || 1;
  const len2 = Math.hypot(v2x, v2y) || 1;
  const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

function findArcSAfter(
  arcGuide: ArcLengthGuide,
  point: { x: number; y: number },
  afterS: number,
  sampleStep: number
): number {
  const total = arcGuide.totalLength;
  if (total <= 0) return afterS;

  const tol = Math.max(sampleStep * 2, 0.2);
  let bestS = afterS;
  let bestDist = Infinity;

  const scan = (from: number, to: number) => {
    for (let s = from; s <= to + 1e-6; s += sampleStep) {
      const f = sampleGuideAtS(arcGuide, s);
      const d = Math.hypot(f.x - point.x, f.y - point.y);
      if (d <= tol && s > afterS + 1e-4 && d < bestDist) {
        bestDist = d;
        bestS = s;
      }
    }
  };

  scan(afterS + sampleStep, total);
  if (bestDist === Infinity) {
    scan(0, afterS);
  }
  if (bestDist === Infinity) {
    return findClosestSOnGuide(arcGuide, point, sampleStep).s;
  }
  return bestS;
}

/** Map one spur marker to arc-length range; collapse recovery when tip sampling merges with miter. */
function mapSpurMarkerToArcRange(
  arcGuide: ArcLengthGuide,
  polyline: LoopPoint[],
  marker: CornerSpurMarker,
  sampleSpacing: number
): CornerSpurRange | null {
  const step = Math.max(Math.min(sampleSpacing, 0.25), 0.08);
  const miter = polyline[marker.miterIdx];
  const tip = polyline[marker.peakIdx];
  const miterReturn = polyline[marker.returnIdx];

  const outboundLen = Math.hypot(tip.x - miter.x, tip.y - miter.y);
  const inboundLen = Math.hypot(miterReturn.x - tip.x, miterReturn.y - tip.y);
  if (outboundLen < 1e-6) return null;

  const tipStep =
    outboundLen < step * 1.25 ? Math.min(step, Math.max(outboundLen / 8, 0.008)) : step;

  const sStart = findClosestSOnGuide(arcGuide, miter, step).s;
  let sPeak = findClosestSOnGuide(arcGuide, tip, tipStep).s;

  if (sPeak <= sStart + 1e-4) {
    sPeak = advanceGuideArcLength(arcGuide, sStart, outboundLen, true);
  }

  let sEnd = findArcSAfter(arcGuide, miterReturn, sPeak, step);
  if (sEnd <= sPeak + 1e-4) {
    sEnd = findArcSAfter(arcGuide, miterReturn, sPeak, step / 2);
  }
  if (sEnd <= sPeak + 1e-4) {
    sEnd = advanceGuideArcLength(arcGuide, sPeak, Math.max(inboundLen, step * 2), true);
  }

  if (sPeak <= sStart + 1e-4 || sEnd <= sPeak + 1e-4) {
    return null;
  }

  return { sStart, sPeak, sEnd, peakX: tip.x, peakY: tip.y, miterX: miter.x, miterY: miter.y };
}

/**
 * Build slot center guide with bisector spurs at sharp concave corners.
 * Each spur runs from the slot miter to the inner miter tip (rough or finish) and back.
 */
function resolveOffsetWorkingSide(partLoop: LoopPoint[], wallSide: OutlineWallSide): number {
  const ccw = signedLoopArea2D(partLoop) >= 0;
  const side = ccw ? 1 : -1;
  return wallSide === 'interior' ? (ccw ? -side : side) : side;
}

interface SpurCandidate {
  miter: LoopPoint;
  spurTip: LoopPoint;
  guideIdx: number;
  used: boolean;
}

function collectSpurCandidates(
  partLoop: LoopPoint[],
  baseGuide: LoopPoint[],
  signedSlotCenter: number,
  signedFinishInner: number,
  workingSide: number,
  maxInternalAngleDeg: number,
  roughTipInnerOffset: number | undefined
): SpurCandidate[] {
  const n = partLoop.length;
  const candidates: SpurCandidate[] = [];

  for (let i = 0; i < n; i++) {
    const prev = partLoop[(i - 1 + n) % n];
    const curr = partLoop[i];
    const next = partLoop[(i + 1) % n];

    const u1x = curr.x - prev.x;
    const u1y = curr.y - prev.y;
    const u2x = next.x - curr.x;
    const u2y = next.y - curr.y;
    const cross = u1x * u2y - u1y * u2x;
    const convex = workingSide * cross > 0;
    if (convex) continue;

    const internalAngle = vertexInternalAngleDeg(prev, curr, next);
    if (internalAngle >= maxInternalAngleDeg) continue;

    const slotMiter = offsetMiterVertex(prev, curr, next, signedSlotCenter, workingSide);
    const tipOffset = roughTipInnerOffset ?? signedFinishInner;
    const spurTip = offsetMiterVertex(prev, curr, next, tipOffset, workingSide);

    let guideIdx = 0;
    let bestDist = Infinity;
    for (let j = 0; j < baseGuide.length; j++) {
      const d = Math.hypot(baseGuide[j].x - slotMiter.x, baseGuide[j].y - slotMiter.y);
      if (d < bestDist) {
        bestDist = d;
        guideIdx = j;
      }
    }

    candidates.push({ miter: slotMiter, spurTip, guideIdx, used: false });
  }

  return candidates;
}

function insertSpurAtGuideIndex(
  result: LoopPoint[],
  spur: SpurCandidate,
  segLen: number
): CornerSpurMarker {
  const miterPt = { ...spur.miter };
  const tail = lastGuidePoint(result);
  let miterIdx: number;
  if (!tail || !pointsNear(tail, miterPt)) {
    miterIdx = result.length;
    result.push(miterPt);
  } else {
    result[result.length - 1] = miterPt;
    miterIdx = result.length - 1;
  }

  const outboundLen = Math.hypot(spur.spurTip.x - miterPt.x, spur.spurTip.y - miterPt.y);
  const spurSegLen = Math.min(segLen, Math.max(outboundLen / 4, 0.05));
  appendDensifiedSegment(
    result,
    miterPt.x,
    miterPt.y,
    miterPt.z,
    spur.spurTip.x,
    spur.spurTip.y,
    spur.spurTip.z,
    spurSegLen,
    true
  );
  const peakIdx = result.length - 1;
  appendDensifiedSegment(
    result,
    spur.spurTip.x,
    spur.spurTip.y,
    spur.spurTip.z,
    miterPt.x,
    miterPt.y,
    miterPt.z,
    spurSegLen,
    true
  );
  const returnIdx = result.length - 1;
  return { miterIdx, peakIdx, returnIdx };
}

/**
 * Build slot center guide with bisector spurs at sharp concave corners.
 * Base offset uses Clipper; spurs are inserted at analytic concave miters.
 */
export function buildSlotCenterGuideWithCornerSpurs(
  partLoop: LoopPoint[],
  slotCenterOffset: number,
  finishInnerOffset: number,
  maxSegmentLen: number,
  options: CornerSpurOptions = {},
  offsetSign = 1,
  wallSide: OutlineWallSide = 'exterior',
  voidNormalX?: number,
  voidNormalY?: number
): SlotCenterGuideResult {
  const signedSlotCenter =
    voidNormalX !== undefined && voidNormalY !== undefined
      ? resolveOutlineOffsetDelta(partLoop, voidNormalX, voidNormalY, slotCenterOffset)
      : slotCenterOffset * offsetSign;
  const signedFinishInner =
    voidNormalX !== undefined && voidNormalY !== undefined
      ? resolveOutlineOffsetDelta(partLoop, voidNormalX, voidNormalY, finishInnerOffset)
      : finishInnerOffset * offsetSign;

  const maxInternalAngleDeg = options.maxInternalAngleDeg ?? 160;
  const roughTipInnerOffset = options.roughTipInnerOffset;

  const n = partLoop.length;
  if (n < 3 || Math.abs(signedSlotCenter) < 1e-9) {
    return { guide: partLoop.map((p) => ({ ...p })), spurMarkers: [] };
  }

  const segLen = Math.max(maxSegmentLen, Math.abs(signedSlotCenter) / 6);
  const workingSide = resolveOffsetWorkingSide(partLoop, wallSide);

  const baseGuide = offsetLoop2DMinkowski(
    partLoop,
    signedSlotCenter,
    segLen,
    wallSide
  );

  const spurCandidates = collectSpurCandidates(
    partLoop,
    baseGuide,
    signedSlotCenter,
    signedFinishInner,
    workingSide,
    maxInternalAngleDeg,
    roughTipInnerOffset
  );

  const result: LoopPoint[] = [];
  const spurMarkers: CornerSpurMarker[] = [];
  const miterMatchEps = Math.max(segLen * 0.75, Math.abs(signedSlotCenter) * 0.15, 0.12);

  for (let i = 0; i < baseGuide.length; i++) {
    result.push({ ...baseGuide[i] });

    const spur = spurCandidates.find(
      (c) =>
        !c.used &&
        (c.guideIdx === i || pointsNear(baseGuide[i], c.miter, miterMatchEps))
    );
    if (!spur) continue;

    spur.used = true;
    spurMarkers.push(insertSpurAtGuideIndex(result, spur, segLen));
  }

  for (const spur of spurCandidates) {
    if (spur.used) continue;
    spur.used = true;
    spurMarkers.push(insertSpurAtGuideIndex(result, spur, segLen));
  }

  return { guide: result, spurMarkers };
}

/** Map spur markers from polyline indices to arc-length ranges on the trochoid guide. */
export function mapSpurRangesToArcGuide(
  polyline: LoopPoint[],
  spurMarkers: CornerSpurMarker[],
  _sampleSpacing: number,
  _mapOptions?: { trochoidR?: number; resolution?: number }
): { arcGuide: ArcLengthGuide; spurRanges: CornerSpurRange[] } {
  const mapStep = SPUR_ARC_MAP_SPACING;

  const arcGuide = buildArcLengthGuide(polyline, mapStep);
  if (arcGuide.totalLength <= 0 || spurMarkers.length === 0) {
    return { arcGuide, spurRanges: [] };
  }

  const spurRanges: CornerSpurRange[] = [];
  for (const marker of spurMarkers) {
    const mapped = mapSpurMarkerToArcRange(arcGuide, polyline, marker, mapStep);
    if (mapped) spurRanges.push(mapped);
  }

  return { arcGuide, spurRanges };
}

export function wrapGuideS(guideS: number, totalLength: number): number {
  return ((guideS % totalLength) + totalLength) % totalLength;
}

export interface OpenSpurSnap {
  splineLen: number;
  trochoidStartS: number;
  forward: boolean;
  loopLength: number;
}

/** Loop-local arc length for spur logic (null on spline lead-in before slot join). */
export function loopSpurGuideS(
  sSample: number,
  loopLength: number,
  openSpurSnap?: OpenSpurSnap
): number | null {
  if (openSpurSnap) {
    if (sSample < openSpurSnap.splineLen - 1e-5) return null;
    const loopDelta = sSample - openSpurSnap.splineLen;
    const raw = openSpurSnap.forward
      ? openSpurSnap.trochoidStartS + loopDelta
      : openSpurSnap.trochoidStartS - loopDelta;
    return wrapGuideS(raw, openSpurSnap.loopLength);
  }
  return wrapGuideS(sSample, loopLength);
}

function lerp2(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  t: number
): { x: number; y: number } {
  const u = Math.max(0, Math.min(1, t));
  return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u };
}

function projectOntoSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { x: number; y: number; t: number; perpDist: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) {
    const d = Math.hypot(px - ax, py - ay);
    return { x: ax, y: ay, t: 0, perpDist: d };
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { x, y, t, perpDist: Math.hypot(px - x, py - y) };
}

/** Guard band before/after spur — keep small to avoid flattening approach cycles. */
export function resolveSpurGuardBuffer(
  _baseTrochoidR: number,
  _forwardIncrement: number,
  _spurSpan: number
): number {
  return 0;
}

function isGuideSInExpandedSpurInterval(
  w: number,
  spur: CornerSpurRange,
  buffer: number,
  totalLength: number
): boolean {
  const lo = spur.sStart - buffer;
  const hi = spur.sEnd + buffer;
  if (lo >= 0 && hi < totalLength) {
    return w >= lo - 1e-4 && w <= hi + 1e-4;
  }
  const loW = wrapGuideS(lo, totalLength);
  const hiW = wrapGuideS(hi, totalLength);
  if (loW <= hiW) return w >= loW - 1e-4 && w <= hiW + 1e-4;
  return w >= loW - 1e-4 || w <= hiW + 1e-4;
}

/** Linear progress along a spur: outbound miter→peak or inbound peak→miter. */
export function spurLinearParams(
  guideS: number,
  totalLength: number,
  spurRanges: CornerSpurRange[]
): { spur: CornerSpurRange; u: number; leg: 'out' | 'in' } | null {
  if (spurRanges.length === 0 || totalLength <= 0) return null;

  const w = wrapGuideS(guideS, totalLength);

  for (const spur of spurRanges) {
    if (w < spur.sStart - 1e-4 || w > spur.sEnd + 1e-4) continue;

    if (w <= spur.sPeak + 1e-4) {
      const span = spur.sPeak - spur.sStart;
      const u = span > 1e-6 ? Math.min(1, Math.max(0, (w - spur.sStart) / span)) : 1;
      return { spur, u, leg: 'out' };
    }

    const span = spur.sEnd - spur.sPeak;
    const u = span > 1e-6 ? Math.min(1, Math.max(0, (w - spur.sPeak) / span)) : 1;
    return { spur, u, leg: 'in' };
  }

  return null;
}

/** Trochoid orbit radius on spurs: linear ramp capped so the orbit cannot extend past the peak. */
export function spurOrbitRadius(
  linear: { spur: CornerSpurRange; u: number; leg: 'out' | 'in' },
  baseRadius: number
): number {
  const legLen = Math.hypot(
    linear.spur.peakX - linear.spur.miterX,
    linear.spur.peakY - linear.spur.miterY
  );
  if (legLen <= 1e-9) return 0;

  const linearR =
    linear.leg === 'out' ? baseRadius * (1 - linear.u) : baseRadius * linear.u;
  const forwardCap = linear.leg === 'out' ? (1 - linear.u) * legLen : linear.u * legLen;
  return Math.max(0, Math.min(linearR, forwardCap));
}

export function trochoidRadiusAtGuideS(
  s: number,
  totalLength: number,
  baseRadius: number,
  spurRanges: CornerSpurRange[]
): number {
  const linear = spurLinearParams(s, totalLength, spurRanges);
  if (!linear) return baseRadius;
  return spurOrbitRadius(linear, baseRadius);
}

export function buildGuideRadiusSampler(
  baseRadius: number,
  totalLength: number,
  spurRanges: CornerSpurRange[]
): (guideS: number) => number {
  if (spurRanges.length === 0) return () => baseRadius;
  return (guideS) => trochoidRadiusAtGuideS(guideS, totalLength, baseRadius, spurRanges);
}

/** Tool center locked to bisector segment (never past peak). */
export function spurCenterAtGuideS(
  guideS: number,
  totalLength: number,
  spurRanges: CornerSpurRange[]
): { x: number; y: number } | null {
  const linear = spurLinearParams(guideS, totalLength, spurRanges);
  if (!linear) return null;

  const { spur, u, leg } = linear;
  if (leg === 'out') {
    return lerp2(spur.miterX, spur.miterY, spur.peakX, spur.peakY, u);
  }
  return lerp2(spur.peakX, spur.peakY, spur.miterX, spur.miterY, u);
}

/** Local frame on spur bisector from linear spur state. */
export function spurFrameFromLinear(
  linear: { spur: CornerSpurRange; u: number; leg: 'out' | 'in' },
  z: number
): { x: number; y: number; z: number; tx: number; ty: number; nx: number; ny: number } {
  const { spur, u, leg } = linear;
  const atPeak =
    (leg === 'out' && u >= 1 - 1e-4) || (leg === 'in' && u <= 1e-4);

  let tx: number;
  let ty: number;
  let center: { x: number; y: number };

  if (atPeak) {
    center = { x: spur.peakX, y: spur.peakY };
    tx = spur.peakX - spur.miterX;
    ty = spur.peakY - spur.miterY;
  } else if (leg === 'out') {
    center = lerp2(spur.miterX, spur.miterY, spur.peakX, spur.peakY, u);
    tx = spur.peakX - spur.miterX;
    ty = spur.peakY - spur.miterY;
  } else {
    center = lerp2(spur.peakX, spur.peakY, spur.miterX, spur.miterY, u);
    tx = spur.miterX - spur.peakX;
    ty = spur.miterY - spur.peakY;
  }

  const tlen = Math.hypot(tx, ty) || 1;
  tx /= tlen;
  ty /= tlen;

  return {
    x: center.x,
    y: center.y,
    z,
    tx,
    ty,
    nx: ty,
    ny: -tx,
  };
}

/** On-spur when guide XY projects onto a bisector leg segment (not its extension). */
export function spurLinearParamsFromGeometry(
  x: number,
  y: number,
  spurRanges: CornerSpurRange[],
  maxPerpDist: number
): { spur: CornerSpurRange; u: number; leg: 'out' | 'in' } | null {
  let best: { spur: CornerSpurRange; u: number; leg: 'out' | 'in'; perp: number } | null = null;

  for (const spur of spurRanges) {
    const out = projectOntoSegment(x, y, spur.miterX, spur.miterY, spur.peakX, spur.peakY);
    if (out.perpDist <= maxPerpDist && out.t >= -1e-4 && out.t <= 1 + 1e-4) {
      if (!best || out.perpDist < best.perp) {
        best = {
          spur,
          u: Math.min(1, Math.max(0, out.t)),
          leg: 'out',
          perp: out.perpDist,
        };
      }
    }

    const inbound = projectOntoSegment(x, y, spur.peakX, spur.peakY, spur.miterX, spur.miterY);
    if (inbound.perpDist <= maxPerpDist && inbound.t >= -1e-4 && inbound.t <= 1 + 1e-4) {
      if (!best || inbound.perpDist < best.perp) {
        best = {
          spur,
          u: Math.min(1, Math.max(0, inbound.t)),
          leg: 'in',
          perp: inbound.perpDist,
        };
      }
    }
  }

  if (!best) return null;
  return { spur: best.spur, u: best.u, leg: best.leg };
}

/** Arc-length gates spur mode; bisector projection sets precise u along the spur line. */
export function resolveSpurLinearState(
  guideS: number,
  x: number,
  y: number,
  totalLength: number,
  spurRanges: CornerSpurRange[],
  maxPerpDist: number
): { spur: CornerSpurRange; u: number; leg: 'out' | 'in' } | null {
  const arcState = spurLinearParams(guideS, totalLength, spurRanges);
  if (!arcState) return null;

  const { spur, leg } = arcState;
  const proj =
    leg === 'out'
      ? projectOntoSegment(x, y, spur.miterX, spur.miterY, spur.peakX, spur.peakY)
      : projectOntoSegment(x, y, spur.peakX, spur.peakY, spur.miterX, spur.miterY);

  if (proj.perpDist <= maxPerpDist) {
    return { spur, leg, u: Math.min(1, Math.max(0, proj.t)) };
  }

  return arcState;
}

/**
 * Spur mode from bisector geometry. Arc-length ranges are used only for stepover
 * boundary clamping, not for deciding whether the tool is on a spur.
 */
export function resolveSpurStateAtGuideSample(
  _guideS: number | null,
  x: number,
  y: number,
  _totalLength: number,
  spurRanges: CornerSpurRange[],
  corridorDist: number
): { spur: CornerSpurRange; u: number; leg: 'out' | 'in' } | null {
  if (spurRanges.length === 0) return null;
  return spurLinearParamsFromGeometry(x, y, spurRanges, Math.max(corridorDist, 0.05));
}

/** Clamp a cut point so it cannot extend past the spur tip along the bisector. */
export function clampCutPointToSpur(
  x: number,
  y: number,
  linear: { spur: CornerSpurRange; u: number; leg: 'out' | 'in' }
): { x: number; y: number } {
  const { spur, leg } = linear;
  const proj =
    leg === 'out'
      ? projectOntoSegment(x, y, spur.miterX, spur.miterY, spur.peakX, spur.peakY)
      : projectOntoSegment(x, y, spur.peakX, spur.peakY, spur.miterX, spur.miterY);

  if (proj.t > 1 + 1e-4) {
    return { x: spur.peakX, y: spur.peakY };
  }
  if (proj.t < -1e-4) {
    return { x: spur.miterX, y: spur.miterY };
  }
  return { x, y };
}

/** Prevent tool center from cutting inside the rough spur tip standoff from the part. */
export function clampCutInwardOfSpurPeak(
  x: number,
  y: number,
  spur: CornerSpurRange,
  partLoop: LoopPoint[]
): { x: number; y: number } {
  const peakAtPart = closestPointOnLoop2D(spur.peakX, spur.peakY, partLoop);
  const peakStandoff = peakAtPart.dist;
  const ptAtPart = closestPointOnLoop2D(x, y, partLoop);
  if (ptAtPart.dist + 1e-3 < peakStandoff) {
    return {
      x: ptAtPart.x + ptAtPart.outX * peakStandoff,
      y: ptAtPart.y + ptAtPart.outY * peakStandoff,
    };
  }
  return { x, y };
}

/** Local frame on spur bisector — center from linear interpolation, tangent along bisector. */
export function spurFrameAtGuideS(
  guideS: number,
  totalLength: number,
  spurRanges: CornerSpurRange[],
  z: number
): { x: number; y: number; z: number; tx: number; ty: number; nx: number; ny: number } | null {
  const linear = spurLinearParams(guideS, totalLength, spurRanges);
  if (!linear) return null;
  return spurFrameFromLinear(linear, z);
}

/**
 * Pull cut points back that extend past the spur tip — catches full-orbit bulge
 * on the miter approach/departure regardless of stepover alignment.
 */
export function clampCutPointPastSpurTips(
  x: number,
  y: number,
  spurRanges: CornerSpurRange[],
  corridorDist: number
): { x: number; y: number } {
  let px = x;
  let py = y;
  const maxDist = Math.max(corridorDist, 0.05);

  for (const spur of spurRanges) {
    const outbound = projectOntoSegment(
      px,
      py,
      spur.miterX,
      spur.miterY,
      spur.peakX,
      spur.peakY
    );
    if (outbound.t > 1 + 1e-3 && outbound.perpDist <= maxDist * 1.75) {
      px = spur.peakX;
      py = spur.peakY;
      continue;
    }

    const inbound = projectOntoSegment(
      px,
      py,
      spur.peakX,
      spur.peakY,
      spur.miterX,
      spur.miterY
    );
    if (inbound.t > 1 + 1e-3 && inbound.perpDist <= maxDist * 1.75) {
      px = spur.peakX;
      py = spur.peakY;
    }
  }

  return { x: px, y: py };
}

function spurGuardBoundaries(spur: CornerSpurRange, buffer: number, totalLength: number): number[] {
  const raw = [spur.sStart - buffer, spur.sStart, spur.sPeak, spur.sEnd, spur.sEnd + buffer];
  return raw.map((s) => wrapGuideS(s, totalLength));
}

/** When at spur tip, return exact peak XY. */
export function spurPeakHoldAtGuideS(
  guideS: number,
  totalLength: number,
  spurRanges: CornerSpurRange[]
): { x: number; y: number } | null {
  const linear = spurLinearParams(guideS, totalLength, spurRanges);
  if (!linear) return null;
  if (linear.leg === 'out' && linear.u >= 1 - 1e-4) {
    return { x: linear.spur.peakX, y: linear.spur.peakY };
  }
  if (linear.leg === 'in' && linear.u <= 1e-4) {
    return { x: linear.spur.peakX, y: linear.spur.peakY };
  }
  return null;
}

/** True when guide arc length is inside the spur (optionally with approach/departure guard band). */
export function isGuideSOnSpur(
  guideS: number,
  totalLength: number,
  spurRanges: CornerSpurRange[],
  guardBuffer = 0
): boolean {
  if (spurRanges.length === 0 || totalLength <= 0) return false;

  const w = wrapGuideS(guideS, totalLength);

  for (const spur of spurRanges) {
    if (guardBuffer > 1e-6) {
      if (isGuideSInExpandedSpurInterval(w, spur, guardBuffer, totalLength)) return true;
    } else if (w >= spur.sStart - 1e-4 && w <= spur.sEnd + 1e-4) {
      return true;
    }
  }

  return false;
}

function guideSBetweenOnPath(
  gs0: number,
  gs1: number,
  boundary: number,
  _totalLength: number,
  forward: boolean
): boolean {
  const eps = 1e-4;
  if (forward) {
    if (gs1 >= gs0 - eps) return boundary > gs0 + eps && boundary <= gs1 + eps;
    return boundary > gs0 + eps || boundary <= gs1 + eps;
  }
  if (gs1 <= gs0 + eps) return boundary >= gs1 - eps && boundary < gs0 - eps;
  return boundary >= gs1 - eps || boundary < gs0 - eps;
}

function guideSDeltaAlongPath(
  gs0: number,
  boundary: number,
  totalLength: number,
  forward: boolean
): number {
  if (forward) {
    let delta = boundary - gs0;
    if (delta <= 1e-6) delta += totalLength;
    return delta;
  }
  let delta = gs0 - boundary;
  if (delta <= 1e-6) delta += totalLength;
  return delta;
}

/**
 * Shorten a trochoid cycle so it stops at the next spur boundary (sStart / sPeak / sEnd).
 * Prevents one stepover from straddling the spur U-turn, which causes stepover-sensitive overshoot.
 */
export function clampArcEndToSpurBoundaries(
  arcProgress: number,
  candidateEnd: number,
  startS: number,
  guideSign: number,
  loopLength: number,
  spurRanges: CornerSpurRange[],
  guardBuffer = 0
): number {
  if (spurRanges.length === 0 || loopLength <= 0 || candidateEnd <= arcProgress + 1e-8) {
    return candidateEnd;
  }

  const guideSAt = (sAlong: number) => {
    const raw = guideSign >= 0 ? startS + sAlong : startS - sAlong;
    return wrapGuideS(raw, loopLength);
  };

  const gs0 = guideSAt(arcProgress);
  const gsEnd = guideSAt(candidateEnd);
  const forward = guideSign >= 0;

  let nearestEnd = candidateEnd;

  for (const spur of spurRanges) {
    const boundaries =
      guardBuffer > 1e-6
        ? spurGuardBoundaries(spur, guardBuffer, loopLength)
        : [spur.sStart, spur.sPeak, spur.sEnd];

    for (const boundary of boundaries) {
      if (!guideSBetweenOnPath(gs0, gsEnd, boundary, loopLength, forward)) continue;

      const hitAlong = arcProgress + guideSDeltaAlongPath(gs0, boundary, loopLength, forward);
      if (hitAlong > arcProgress + 1e-6 && hitAlong < nearestEnd - 1e-6) {
        nearestEnd = hitAlong;
      }
    }
  }

  return nearestEnd;
}

/** Next spur boundary along a closed loop traverse (for zero-length clamp recovery). */
export function nextSpurBoundaryAlongClosedLoop(
  arcProgress: number,
  startS: number,
  guideSign: number,
  loopLength: number,
  spurRanges: CornerSpurRange[]
): number | null {
  if (spurRanges.length === 0 || loopLength <= 0) return null;

  const guideSAt = (sAlong: number) => {
    const raw = guideSign >= 0 ? startS + sAlong : startS - sAlong;
    return wrapGuideS(raw, loopLength);
  };

  const gs0 = guideSAt(arcProgress);
  const forward = guideSign >= 0;
  let bestAlong: number | null = null;
  let bestDelta = Infinity;

  for (const spur of spurRanges) {
    for (const boundary of [spur.sStart, spur.sPeak, spur.sEnd]) {
      const delta = guideSDeltaAlongPath(gs0, boundary, loopLength, forward);
      if (delta > 1e-6 && delta < bestDelta) {
        bestDelta = delta;
        bestAlong = arcProgress + delta;
      }
    }
  }

  return bestAlong;
}

/** Next spur boundary along open entry path loop section. */
export function nextSpurBoundaryAlongOpenPath(
  arcProgress: number,
  splineLen: number,
  trochoidStartS: number,
  forward: boolean,
  loopLength: number,
  spurRanges: CornerSpurRange[]
): number | null {
  if (spurRanges.length === 0 || loopLength <= 0 || arcProgress < splineLen - 1e-5) {
    return null;
  }

  const loopSAt = (globalAlong: number) => {
    const loopDelta = globalAlong - splineLen;
    return wrapGuideS(
      forward ? trochoidStartS + loopDelta : trochoidStartS - loopDelta,
      loopLength
    );
  };

  const gs0 = loopSAt(arcProgress);
  let bestAlong: number | null = null;
  let bestDelta = Infinity;

  for (const spur of spurRanges) {
    for (const boundary of [spur.sStart, spur.sPeak, spur.sEnd]) {
      const delta = guideSDeltaAlongPath(gs0, boundary, loopLength, forward);
      if (delta > 1e-6 && delta < bestDelta) {
        bestDelta = delta;
        bestAlong = arcProgress + delta;
      }
    }
  }

  return bestAlong;
}

/** Spur boundary snapping for open entry paths (spline + loop composite arc length). */
export function clampOpenArcEndToSpurBoundaries(
  arcProgress: number,
  candidateEnd: number,
  splineLen: number,
  trochoidStartS: number,
  forward: boolean,
  loopLength: number,
  spurRanges: CornerSpurRange[],
  guardBuffer = 0
): number {
  if (spurRanges.length === 0 || loopLength <= 0 || candidateEnd <= arcProgress + 1e-8) {
    return candidateEnd;
  }
  if (candidateEnd <= splineLen + 1e-6) return candidateEnd;

  const loopAlongStart = Math.max(arcProgress, splineLen);
  const loopSAt = (globalAlong: number) => {
    const loopDelta = globalAlong - splineLen;
    return forward ? trochoidStartS + loopDelta : trochoidStartS - loopDelta;
  };

  const gs0 = wrapGuideS(loopSAt(loopAlongStart), loopLength);
  const gsEnd = wrapGuideS(loopSAt(candidateEnd), loopLength);

  let nearestEnd = candidateEnd;

  for (const spur of spurRanges) {
    const boundaries =
      guardBuffer > 1e-6
        ? spurGuardBoundaries(spur, guardBuffer, loopLength)
        : [spur.sStart, spur.sPeak, spur.sEnd];

    for (const boundary of boundaries) {
      if (!guideSBetweenOnPath(gs0, gsEnd, boundary, loopLength, forward)) continue;

      const loopDelta = guideSDeltaAlongPath(gs0, boundary, loopLength, forward);
      const hitAlong = loopAlongStart + loopDelta;
      if (hitAlong > arcProgress + 1e-6 && hitAlong < nearestEnd - 1e-6) {
        nearestEnd = hitAlong;
      }
    }
  }

  return nearestEnd;
}
