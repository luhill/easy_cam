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
import { buildArcLengthGuide, type ArcLengthGuide } from './trochoidalPath';

export interface CornerSpurRange {
  /** Arc length where spur leaves the main slot centerline (full trochoid radius). */
  sStart: number;
  /** Arc length at the finish-corner miter tip (trochoid radius → 0). */
  sPeak: number;
  /** Arc length where spur rejoins the main slot centerline (0 → full radius). */
  sEnd: number;
}

export interface SlotCenterGuideResult {
  guide: LoopPoint[];
  spurRanges: CornerSpurRange[];
}

export interface CornerSpurOptions {
  /** Only spur when internal corner angle is below this (degrees). Default 160. */
  maxInternalAngleDeg?: number;
  /** Minimum bisector spur length to insert (mm). Default 0.08. */
  minSpurLength?: number;
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

function arcLengthOfGuide(guide: LoopPoint[]): number {
  if (guide.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < guide.length; i++) {
    s += Math.hypot(guide[i].x - guide[i - 1].x, guide[i].y - guide[i - 1].y);
  }
  const a = guide[0];
  const b = guide[guide.length - 1];
  s += Math.hypot(a.x - b.x, a.y - b.y);
  return s;
}

/**
 * Build slot center guide with bisector spurs at sharp concave corners.
 * Each spur runs from the slot miter to the finish-inner miter and back.
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

  const n = partLoop.length;
  if (n < 3 || Math.abs(slotCenterOffset) < 1e-9) {
    return { guide: partLoop.map((p) => ({ ...p })), spurRanges: [] };
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
        const finishMiter = offsetVertexMiter(partLoop, i, finishInnerOffset);
        const spurLen = Math.hypot(finishMiter.x - slotMiter.x, finishMiter.y - slotMiter.y);
        if (spurLen >= minSpurLength) {
          spurTip = finishMiter;
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
  const spurRanges: CornerSpurRange[] = [];

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
      const sStart = arcLengthOfGuide(result);
      result.push({
        x: join.endX,
        y: join.endY,
        z: join.curr.z,
      });

      if (join.spurTip) {
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
        const sPeak = arcLengthOfGuide(result);
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
        const sEnd = arcLengthOfGuide(result);
        if (sPeak - sStart >= minSpurLength) {
          spurRanges.push({ sStart, sPeak, sEnd });
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

  return { guide: result, spurRanges };
}

/** Map spur arc-length ranges from a polyline guide to a densified ArcLengthGuide. */
export function mapSpurRangesToArcGuide(
  polyline: LoopPoint[],
  spurRanges: CornerSpurRange[],
  sampleSpacing: number
): { arcGuide: ArcLengthGuide; spurRanges: CornerSpurRange[] } {
  const arcGuide = buildArcLengthGuide(polyline, sampleSpacing);
  if (spurRanges.length === 0 || arcGuide.totalLength <= 0) {
    return { arcGuide, spurRanges: [] };
  }

  const polyLen = arcLengthOfGuide(polyline);
  const scale = polyLen > 1e-6 ? arcGuide.totalLength / polyLen : 1;

  return {
    arcGuide,
    spurRanges: spurRanges.map((spur) => ({
      sStart: spur.sStart * scale,
      sPeak: spur.sPeak * scale,
      sEnd: spur.sEnd * scale,
    })),
  };
}

/** Trochoid orbit radius at a guide arc-length station (ramps on corner spurs). */
export function trochoidRadiusAtGuideS(
  s: number,
  totalLength: number,
  baseRadius: number,
  spurRanges: CornerSpurRange[]
): number {
  if (baseRadius <= 0 || totalLength <= 0 || spurRanges.length === 0) return baseRadius;

  let w = s % totalLength;
  if (w < 0) w += totalLength;

  for (const spur of spurRanges) {
    if (w >= spur.sStart - 1e-5 && w <= spur.sPeak + 1e-5) {
      const span = spur.sPeak - spur.sStart;
      if (span <= 1e-6) return 0;
      const t = Math.max(0, Math.min(1, (w - spur.sStart) / span));
      return baseRadius * (1 - t);
    }
    if (w > spur.sPeak - 1e-5 && w <= spur.sEnd + 1e-5) {
      const span = spur.sEnd - spur.sPeak;
      if (span <= 1e-6) return baseRadius;
      const t = Math.max(0, Math.min(1, (w - spur.sPeak) / span));
      return baseRadius * t;
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
