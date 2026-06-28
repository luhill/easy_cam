import type { LoopPoint } from '../types/operations';
import type { ToolpathPoint } from '../types/operations';
import { clampToolCenterMinDistanceFromPart, signedLoopArea2D } from './geometryProcessing';

export interface TrochoidalParams {
  /** Forward advance along guide path per full tool orbit (mm). */
  forwardIncrement: number;
  /** Max outward tool-center excursion from inner guide (mm) = slotWidth − toolDiameter. */
  slotClearance: number;
  z: number;
  maxAngleStep?: number;
  /** Part outline — only minimum standoff is enforced (never max, to preserve slot width at corners). */
  partLoop?: LoopPoint[];
  minCenterDist?: number;
}

export interface ArcLengthGuide {
  frames: GuideFrame[];
  totalLength: number;
}

export interface GuideFrame {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  s: number;
}

function densifyLoop(loop: LoopPoint[], maxSegmentLen: number): LoopPoint[] {
  if (loop.length < 2) return loop;

  const result: LoopPoint[] = [];
  const n = loop.length;

  for (let i = 0; i < n; i++) {
    const p0 = loop[i];
    const p1 = loop[(i + 1) % n];
    result.push(p0);

    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (len <= maxSegmentLen) continue;

    const steps = Math.ceil(len / maxSegmentLen);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      result.push({
        x: p0.x + (p1.x - p0.x) * t,
        y: p0.y + (p1.y - p0.y) * t,
        z: p0.z + (p1.z - p0.z) * t,
      });
    }
  }

  return result;
}

/** Build arc-length parameterized guide with smooth tangents and outward normals. */
export function buildArcLengthGuide(
  guideLoop: LoopPoint[],
  sampleSpacing: number
): ArcLengthGuide {
  if (guideLoop.length < 3) {
    return { frames: [], totalLength: 0 };
  }

  const ccw = signedLoopArea2D(guideLoop) >= 0;
  const dense = densifyLoop(guideLoop, Math.max(sampleSpacing, 0.1));
  const n = dense.length;
  const frames: GuideFrame[] = [];
  let s = 0;

  for (let i = 0; i < n; i++) {
    const prev = dense[(i - 1 + n) % n];
    const curr = dense[i];
    const next = dense[(i + 1) % n];

    if (i > 0) {
      s += Math.hypot(curr.x - prev.x, curr.y - prev.y);
    }

    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen;
    ty /= tlen;

    const side = ccw ? 1 : -1;
    const nx = side * ty;
    const ny = side * (-tx);

    frames.push({ x: curr.x, y: curr.y, z: curr.z, tx, ty, nx, ny, s });
  }

  const closing =
    frames.length > 0
      ? Math.hypot(frames[0].x - frames[frames.length - 1].x, frames[0].y - frames[frames.length - 1].y)
      : 0;

  return { frames, totalLength: s + closing };
}

export function sampleGuideAtS(guide: ArcLengthGuide, s: number): GuideFrame {
  const { frames, totalLength } = guide;
  if (frames.length === 0) {
    return { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: 1, s: 0 };
  }
  if (totalLength <= 0) return frames[0];

  let wrapped = s % totalLength;
  if (wrapped < 0) wrapped += totalLength;

  for (let i = 1; i < frames.length; i++) {
    if (frames[i].s >= wrapped) {
      const a = frames[i - 1];
      const b = frames[i];
      const segLen = b.s - a.s || 1;
      const t = (wrapped - a.s) / segLen;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        tx: a.tx + (b.tx - a.tx) * t,
        ty: a.ty + (b.ty - a.ty) * t,
        nx: a.nx + (b.nx - a.nx) * t,
        ny: a.ny + (b.ny - a.ny) * t,
        s: wrapped,
      };
    }
  }

  const a = frames[frames.length - 1];
  const b = frames[0];
  const segLen = totalLength - a.s || 1;
  const t = (wrapped - a.s) / segLen;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    tx: a.tx + (b.tx - a.tx) * t,
    ty: a.ty + (b.ty - a.ty) * t,
    nx: a.nx + (b.nx - a.nx) * t,
    ny: a.ny + (b.ny - a.ny) * t,
    s: wrapped,
  };
}

/**
 * Fusion-style trochoidal slot: each pass is a full circular orbit while the
 * center advances smoothly forward along the inner guide. Slot width stays
 * constant in the local frame (full width at convex corners).
 */
export function generateConstantEngagementTrochoid(
  innerGuideLoop: LoopPoint[],
  params: TrochoidalParams
): ToolpathPoint[] {
  const { forwardIncrement: increment, slotClearance, z } = params;
  if (innerGuideLoop.length < 3 || increment <= 0 || slotClearance <= 0) return [];

  const trochoidR = slotClearance / 2;
  const maxAngleStep = params.maxAngleStep ?? (4 * Math.PI) / 180;
  const sampleSpacing = Math.min(increment / 4, trochoidR / 2, 0.5);
  const arcGuide = buildArcLengthGuide(innerGuideLoop, sampleSpacing);
  const { totalLength } = arcGuide;
  if (totalLength <= 0) return [];

  const ccwGuide = signedLoopArea2D(innerGuideLoop) >= 0;
  /** Consistent tool rotation: CW when guide is CCW (conventional exterior clearing). */
  const rotSign = ccwGuide ? -1 : 1;
  const numCycles = Math.ceil(totalLength / increment);
  const points: ToolpathPoint[] = [];
  const enforceMin =
    params.partLoop && params.minCenterDist !== undefined;

  for (let cycle = 0; cycle < numCycles; cycle++) {
    const sStart = cycle * increment;
    const steps = Math.max(2, Math.ceil((2 * Math.PI) / maxAngleStep));

    for (let i = 0; i <= steps; i++) {
      const phase = i / steps;
      const sAlong = sStart + phase * increment;
      if (sAlong > totalLength + increment * 0.01) break;

      const theta = -Math.PI / 2 + rotSign * phase * 2 * Math.PI;
      const frame = sampleGuideAtS(arcGuide, sAlong);

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

      const cx = frame.x + nx * trochoidR;
      const cy = frame.y + ny * trochoidR;
      let px = cx + trochoidR * (Math.cos(theta) * tx + Math.sin(theta) * nx);
      let py = cy + trochoidR * (Math.cos(theta) * ty + Math.sin(theta) * ny);

      if (enforceMin) {
        const clamped = clampToolCenterMinDistanceFromPart(
          params.partLoop!,
          px,
          py,
          params.minCenterDist!
        );
        px = clamped.x;
        py = clamped.y;
      }

      points.push({ x: px, y: py, z });
    }
  }

  return points;
}

export function generateTrochoidalOutlinePath(
  guideLoop: LoopPoint[],
  params: TrochoidalParams
): ToolpathPoint[] {
  return generateConstantEngagementTrochoid(guideLoop, params);
}

/** Forward pass advance from stepover % of tool diameter. */
export function adaptiveForwardIncrement(toolDiameter: number, stepoverPercent: number): number {
  const toolD = Math.max(toolDiameter, 0.1);
  const ae = toolD * (stepoverPercent / 100);
  return Math.max(ae, toolD * 0.05);
}
