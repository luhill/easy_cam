import type { LoopPoint } from '../types/operations';
import type { ToolpathPoint } from '../types/operations';
import { signedLoopArea2D } from './geometryProcessing';

export interface TrochoidalParams {
  /** Trochoid circle radius (mm) — chip thinning / slot half-width component */
  trochoidRadius: number;
  /** Forward advance along guide path per full 2π rotation (mm) — constant engagement step */
  forwardIncrement: number;
  z: number;
  maxAngleStep?: number;
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

/**
 * Local trochoid (LinuxCNC). +X = forward along tangent, +Y = outward normal.
 */
export function trochoidPointLocal(angleRad: number, a: number, b: number): [number, number] {
  const x = a * angleRad - b * Math.sin(angleRad) - a * Math.PI;
  const y = b - b * Math.cos(angleRad) - 2 * b;
  return [x, y];
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
 * Constant-engagement trochoidal path along a closed guide (Fusion-style adaptive slot).
 * Forward motion is uniform in arc length so spacing is equal on convex and concave regions.
 */
export function generateConstantEngagementTrochoid(
  guideLoop: LoopPoint[],
  params: TrochoidalParams
): ToolpathPoint[] {
  const { trochoidRadius: b, forwardIncrement: increment, z } = params;
  if (guideLoop.length < 3 || increment <= 0 || b <= 0) return [];

  const maxAngleStep = params.maxAngleStep ?? (3 * Math.PI) / 180;
  const sampleSpacing = Math.min(increment / 3, b / 2, 0.5);
  const arcGuide = buildArcLengthGuide(guideLoop, sampleSpacing);
  const { totalLength } = arcGuide;
  if (totalLength <= 0) return [];

  const a = increment / (2 * Math.PI);
  const numCycles = Math.ceil(totalLength / increment);
  const totalAngle = 2 * Math.PI * numCycles;
  const points: ToolpathPoint[] = [];

  for (let ang = 0; ang <= totalAngle + 1e-9; ang += maxAngleStep) {
    const cycleIndex = Math.floor(ang / (2 * Math.PI));
    const phase = ang - cycleIndex * 2 * Math.PI;
    const sAlong = cycleIndex * increment + (phase / (2 * Math.PI)) * increment;

    if (sAlong > totalLength + increment * 0.01) break;

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

    const [lx, ly] = trochoidPointLocal(phase, a, b);
    points.push({
      x: frame.x + lx * tx + ly * nx,
      y: frame.y + lx * ty + ly * ny,
      z,
    });
  }

  return points;
}

export function generateTrochoidalOutlinePath(
  guideLoop: LoopPoint[],
  params: TrochoidalParams
): ToolpathPoint[] {
  return generateConstantEngagementTrochoid(guideLoop, params);
}

export function defaultTrochoidRadius(slotWidth: number, toolDiameter: number): number {
  const toolR = toolDiameter / 2;
  const excess = Math.max(slotWidth - toolDiameter, 0);
  return Math.max(toolR * 0.35, excess / 2 + toolR * 0.15);
}

/** Optimal forward increment for constant tool load (~10–15% of tool diameter). */
export function adaptiveForwardIncrement(toolDiameter: number, stepoverPercent: number): number {
  const toolD = Math.max(toolDiameter, 0.1);
  const ae = toolD * (stepoverPercent / 100);
  return Math.max(ae, toolD * 0.08);
}
