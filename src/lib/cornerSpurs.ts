/**
 * Bisector spurs on the slot centerline at sharp concave corners so trochoidal
 * roughing can reach the finish-outline miter before the final pass.
 */

import type { LoopPoint } from '../types/operations';
import {
  offsetVertexMiter,
  signedLoopArea2D,
  outwardEdgeNormal2D,
} from './geometryProcessing';
import {
  buildArcLengthGuide,
  findClosestSOnGuide,
  sampleGuideAtS,
  type ArcLengthGuide,
} from './trochoidalPath';

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

/** Cumulative polyline length without a closing chord (build-order distance). */
function openPolylineLength(guide: LoopPoint[]): number {
  if (guide.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < guide.length; i++) {
    s += Math.hypot(guide[i].x - guide[i - 1].x, guide[i].y - guide[i - 1].y);
  }
  return s;
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

  const sStart = findClosestSOnGuide(arcGuide, miter, step).s;
  const sPeak = findClosestSOnGuide(arcGuide, tip, step).s;

  let sEnd = findArcSAfter(arcGuide, miterReturn, sPeak, step);
  if (sEnd <= sPeak + 1e-4) {
    sEnd = findArcSAfter(arcGuide, miterReturn, sPeak, step / 2);
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
export function buildSlotCenterGuideWithCornerSpurs(
  partLoop: LoopPoint[],
  slotCenterOffset: number,
  finishInnerOffset: number,
  maxSegmentLen: number,
  options: CornerSpurOptions = {}
): SlotCenterGuideResult {
  const maxInternalAngleDeg = options.maxInternalAngleDeg ?? 160;
  const minSpurLength = options.minSpurLength ?? 0.08;
  const roughTipInnerOffset = options.roughTipInnerOffset;

  const n = partLoop.length;
  if (n < 3 || Math.abs(slotCenterOffset) < 1e-9) {
    return { guide: partLoop.map((p) => ({ ...p })), spurMarkers: [] };
  }

  const ccw = signedLoopArea2D(partLoop) >= 0;
  const side = ccw ? 1 : -1;
  const segLen = Math.max(maxSegmentLen, Math.abs(slotCenterOffset) / 6);

  interface VertexJoin {
    convex: boolean;
    curr: LoopPoint;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    nInX: number;
    nInY: number;
    nOutX: number;
    nOutY: number;
    spurTip?: LoopPoint;
  }

  const joins: VertexJoin[] = [];

  for (let i = 0; i < n; i++) {
    const prev = partLoop[(i - 1 + n) % n];
    const curr = partLoop[i];
    const next = partLoop[(i + 1) % n];

    const nIn = outwardEdgeNormal2D(prev.x, prev.y, curr.x, curr.y, side);
    const nOut = outwardEdgeNormal2D(curr.x, curr.y, next.x, next.y, side);
    const u1x = curr.x - prev.x;
    const u1y = curr.y - prev.y;
    const u2x = next.x - curr.x;
    const u2y = next.y - curr.y;
    const cross = u1x * u2y - u1y * u2x;
    const convex = side * cross > 0;

    if (convex) {
      joins.push({
        convex: true,
        curr,
        startX: curr.x + nIn.nx * slotCenterOffset,
        startY: curr.y + nIn.ny * slotCenterOffset,
        endX: curr.x + nOut.nx * slotCenterOffset,
        endY: curr.y + nOut.ny * slotCenterOffset,
        nInX: nIn.nx,
        nInY: nIn.ny,
        nOutX: nOut.nx,
        nOutY: nOut.ny,
      });
    } else {
      const slotMiter = offsetVertexMiter(partLoop, i, slotCenterOffset);
      let spurTip: LoopPoint | undefined;

      const internalAngle = vertexInternalAngleDeg(prev, curr, next);
      if (internalAngle < maxInternalAngleDeg) {
        const tipOffset = roughTipInnerOffset ?? finishInnerOffset;
        const spurTipMiter = offsetVertexMiter(partLoop, i, tipOffset);
        const spurLen = Math.hypot(spurTipMiter.x - slotMiter.x, spurTipMiter.y - slotMiter.y);
        if (spurLen >= minSpurLength) {
          spurTip = spurTipMiter;
        }
      }

      joins.push({
        convex: false,
        curr,
        startX: slotMiter.x,
        startY: slotMiter.y,
        endX: slotMiter.x,
        endY: slotMiter.y,
        nInX: nIn.nx,
        nInY: nIn.ny,
        nOutX: nOut.nx,
        nOutY: nOut.ny,
        spurTip,
      });
    }
  }

  const result: LoopPoint[] = [];
  const spurMarkers: CornerSpurMarker[] = [];

  for (let i = 0; i < n; i++) {
    const join = joins[i];
    const nextJoin = joins[(i + 1) % n];

    if (join.convex) {
      const a1 = Math.atan2(join.nInY, join.nInX);
      const a2 = Math.atan2(join.nOutY, join.nOutX);
      let sweep = a2 - a1;
      while (sweep < -1e-9) sweep += 2 * Math.PI;

      const arcSteps = Math.max(1, Math.ceil((Math.abs(sweep) * Math.abs(slotCenterOffset)) / segLen));
      for (let s = 0; s <= arcSteps; s++) {
        const ang = a1 + (sweep * s) / arcSteps;
        result.push({
          x: join.curr.x + slotCenterOffset * Math.cos(ang),
          y: join.curr.y + slotCenterOffset * Math.sin(ang),
          z: join.curr.z,
        });
      }
    } else {
      const miterIdx = result.length;
      result.push({
        x: join.endX,
        y: join.endY,
        z: join.curr.z,
      });

      if (join.spurTip) {
        const outboundStartLen = openPolylineLength(result);
        appendDensifiedSegment(
          result,
          join.endX,
          join.endY,
          join.curr.z,
          join.spurTip.x,
          join.spurTip.y,
          join.spurTip.z,
          segLen,
          true
        );
        const peakIdx = result.length - 1;
        appendDensifiedSegment(
          result,
          join.spurTip.x,
          join.spurTip.y,
          join.spurTip.z,
          join.endX,
          join.endY,
          join.curr.z,
          segLen,
          true
        );
        const returnIdx = result.length - 1;
        const inboundLen = openPolylineLength(result) - outboundStartLen;
        if (inboundLen >= minSpurLength * 2) {
          spurMarkers.push({ miterIdx, peakIdx, returnIdx });
        }
      }
    }

    appendDensifiedSegment(
      result,
      join.endX,
      join.endY,
      join.curr.z,
      nextJoin.startX,
      nextJoin.startY,
      nextJoin.curr.z,
      segLen,
      true
    );
  }

  return { guide: result, spurMarkers };
}

/** Map spur markers from polyline indices to arc-length ranges on the trochoid guide. */
export function mapSpurRangesToArcGuide(
  polyline: LoopPoint[],
  spurMarkers: CornerSpurMarker[],
  sampleSpacing: number,
  mapOptions?: { trochoidR?: number; resolution?: number }
): { arcGuide: ArcLengthGuide; spurRanges: CornerSpurRange[] } {
  const mapStep =
    mapOptions?.trochoidR !== undefined
      ? Math.min(
          0.1,
          Math.max(0.06, (mapOptions.trochoidR / 8) * Math.max(mapOptions.resolution ?? 2, 0.5))
        )
      : Math.max(Math.min(sampleSpacing, 0.12), 0.06);

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

function wrapGuideS(guideS: number, totalLength: number): number {
  return ((guideS % totalLength) + totalLength) % totalLength;
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

/** Guard band before/after spur so full trochoid orbits do not bulge into the corner. */
export function resolveSpurGuardBuffer(
  baseTrochoidR: number,
  forwardIncrement: number,
  spurSpan: number
): number {
  const raw = Math.max(baseTrochoidR * 0.95, forwardIncrement * 0.85);
  return Math.min(raw, Math.max(spurSpan * 0.45, baseTrochoidR * 0.35));
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

/** Tool center on the bisector spur at this guide station (null if off spur). */
export function spurCenterAtGuideS(
  guideS: number,
  totalLength: number,
  spurRanges: CornerSpurRange[]
): { x: number; y: number } | null {
  if (spurRanges.length === 0 || totalLength <= 0) return null;

  const w = wrapGuideS(guideS, totalLength);

  for (const spur of spurRanges) {
    const span = spur.sEnd - spur.sStart;
    const halfBand = spurPeakHalfBand(span);

    if (w < spur.sStart - 1e-4 || w > spur.sEnd + 1e-4) continue;

    if (wrappedArcDistance(w, spur.sPeak, totalLength) <= halfBand) {
      return { x: spur.peakX, y: spur.peakY };
    }

    if (w <= spur.sPeak + 1e-4) {
      const leg = Math.max(spur.sPeak - spur.sStart - halfBand, 1e-6);
      const t = Math.min(1, Math.max(0, (w - spur.sStart) / leg));
      return lerp2(spur.miterX, spur.miterY, spur.peakX, spur.peakY, t);
    }

    const leg = Math.max(spur.sEnd - spur.sPeak - halfBand, 1e-6);
    const t = Math.min(1, Math.max(0, (w - spur.sPeak - halfBand) / leg));
    return lerp2(spur.peakX, spur.peakY, spur.miterX, spur.miterY, t);
  }

  return null;
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

function spurPeakHalfBand(span: number): number {
  return Math.max(0.05, span * 0.15);
}

function wrappedArcDistance(a: number, b: number, totalLength: number): number {
  let d = Math.abs(a - b);
  if (totalLength > 0 && d > totalLength * 0.5) d = totalLength - d;
  return d;
}

/** When guide arc length is inside a spur peak deadband, return the exact tip XY. */
export function spurPeakHoldAtGuideS(
  guideS: number,
  totalLength: number,
  spurRanges: CornerSpurRange[]
): { x: number; y: number } | null {
  if (spurRanges.length === 0 || totalLength <= 0) return null;

  const w = ((guideS % totalLength) + totalLength) % totalLength;

  for (const spur of spurRanges) {
    const span = spur.sEnd - spur.sStart;
    const halfBand = spurPeakHalfBand(span);
    if (wrappedArcDistance(w, spur.sPeak, totalLength) <= halfBand) {
      return { x: spur.peakX, y: spur.peakY };
    }
  }

  return null;
}

/** Trochoid orbit radius at a guide arc-length station (ramps on corner spurs only). */
export function trochoidRadiusAtGuideS(
  s: number,
  totalLength: number,
  baseRadius: number,
  spurRanges: CornerSpurRange[]
): number {
  if (baseRadius <= 0 || totalLength <= 0 || spurRanges.length === 0) return baseRadius;

  let w = s;
  if (totalLength > 0) {
    w = ((s % totalLength) + totalLength) % totalLength;
  }

  for (const spur of spurRanges) {
    const span = spur.sEnd - spur.sStart;
    const halfBand = spurPeakHalfBand(span);

    if (wrappedArcDistance(w, spur.sPeak, totalLength) <= halfBand) {
      return 0;
    }

    if (w > spur.sStart + 1e-4 && w < spur.sPeak - halfBand) {
      const rampSpan = spur.sPeak - spur.sStart - halfBand;
      const t = rampSpan > 1e-6 ? (w - spur.sStart) / rampSpan : 1;
      return baseRadius * (1 - Math.min(1, Math.max(0, t)));
    }
    if (w > spur.sPeak + halfBand && w < spur.sEnd - 1e-4) {
      const rampSpan = spur.sEnd - spur.sPeak - halfBand;
      const t = rampSpan > 1e-6 ? (w - spur.sPeak - halfBand) / rampSpan : 1;
      return baseRadius * Math.min(1, Math.max(0, t));
    }
  }

  return baseRadius;
}

export function buildGuideRadiusSampler(
  baseRadius: number,
  totalLength: number,
  spurRanges: CornerSpurRange[]
): (guideS: number) => number {
  if (spurRanges.length === 0) return () => baseRadius;
  return (guideS) => trochoidRadiusAtGuideS(guideS, totalLength, baseRadius, spurRanges);
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
