import type { LoopPoint } from '../types/operations';
import { signedLoopArea2D } from './geometryProcessing';

export interface TrochoidalParams {
  /** Forward advance along guide path per full tool orbit (mm). */
  forwardIncrement: number;
  /** Max outward tool-center excursion from inner guide (mm) = slotWidth − toolDiameter. */
  slotClearance: number;
  z: number;
  maxAngleStep?: number;
  /** Micro-retract / Z lift between passes (mm). 0 bypasses exit/lift zone. */
  liftAmount?: number;
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

/** Arc-length guide for an open polyline (no closing segment). */
export function buildOpenArcLengthGuide(
  polyline: LoopPoint[],
  sampleSpacing: number,
  outwardCCW: boolean
): ArcLengthGuide {
  if (polyline.length < 2) {
    return { frames: [], totalLength: 0 };
  }

  const dense: LoopPoint[] = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const p0 = polyline[i];
    const p1 = polyline[i + 1];
    dense.push(p0);
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (len <= sampleSpacing) continue;
    const steps = Math.ceil(len / sampleSpacing);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      dense.push({
        x: p0.x + (p1.x - p0.x) * t,
        y: p0.y + (p1.y - p0.y) * t,
        z: p0.z + (p1.z - p0.z) * t,
      });
    }
  }
  dense.push(polyline[polyline.length - 1]);

  const side = outwardCCW ? 1 : -1;
  const frames: GuideFrame[] = [];
  let s = 0;
  const n = dense.length;

  for (let i = 0; i < n; i++) {
    const prev = dense[Math.max(i - 1, 0)];
    const curr = dense[i];
    const next = dense[Math.min(i + 1, n - 1)];

    if (i > 0) {
      s += Math.hypot(curr.x - prev.x, curr.y - prev.y);
    }

    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tlen = Math.hypot(tx, ty) || 1;
    tx /= tlen;
    ty /= tlen;

    frames.push({
      x: curr.x,
      y: curr.y,
      z: curr.z,
      tx,
      ty,
      nx: side * ty,
      ny: side * (-tx),
      s,
    });
  }

  return { frames, totalLength: s };
}

export function sampleOpenGuideAtS(guide: ArcLengthGuide, s: number): GuideFrame {
  const { frames, totalLength } = guide;
  if (frames.length === 0) {
    return { x: 0, y: 0, z: 0, tx: 1, ty: 0, nx: 0, ny: 1, s: 0 };
  }
  const clamped = Math.max(0, Math.min(s, totalLength));

  for (let i = 1; i < frames.length; i++) {
    if (frames[i].s >= clamped) {
      const a = frames[i - 1];
      const b = frames[i];
      const segLen = b.s - a.s || 1;
      const t = (clamped - a.s) / segLen;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        tx: a.tx + (b.tx - a.tx) * t,
        ty: a.ty + (b.ty - a.ty) * t,
        nx: a.nx + (b.nx - a.nx) * t,
        ny: a.ny + (b.ny - a.ny) * t,
        s: clamped,
      };
    }
  }

  return frames[frames.length - 1];
}

export function findClosestSOnGuide(
  guide: ArcLengthGuide,
  point: { x: number; y: number },
  sampleStep = 0.5
): { s: number; x: number; y: number; dist: number } {
  if (guide.totalLength <= 0 || guide.frames.length === 0) {
    return { s: 0, x: point.x, y: point.y, dist: Infinity };
  }

  let bestS = 0;
  let bestDist = Infinity;
  let bestX = guide.frames[0].x;
  let bestY = guide.frames[0].y;

  for (let s = 0; s <= guide.totalLength; s += sampleStep) {
    const f = sampleOpenGuideAtS(guide, s);
    const d = Math.hypot(f.x - point.x, f.y - point.y);
    if (d < bestDist) {
      bestDist = d;
      bestS = s;
      bestX = f.x;
      bestY = f.y;
    }
  }

  return { s: bestS, x: bestX, y: bestY, dist: bestDist };
}

/** Arc length between two stations on a closed guide, in one traverse direction. */
export function guideArcLengthBetween(
  totalLength: number,
  fromS: number,
  toS: number,
  forward: boolean
): number {
  if (totalLength <= 0) return 0;
  if (forward) {
    if (toS >= fromS - 1e-6) return toS - fromS;
    return totalLength - fromS + toS;
  }
  if (fromS >= toS - 1e-6) return fromS - toS;
  return fromS + totalLength - toS;
}

/** Sample a closed guide between two arc-length stations. */
export function extractGuideArcSegment(
  guide: ArcLengthGuide,
  fromS: number,
  toS: number,
  traverseSign: number,
  sampleSpacing: number,
  z: number
): LoopPoint[] {
  const total = guide.totalLength;
  if (total <= 0) return [];

  const forward = traverseSign >= 0;
  const arcLen = guideArcLengthBetween(total, fromS, toS, forward);
  const joinPt = sampleGuideAtS(guide, toS);

  if (arcLen <= sampleSpacing * 0.5) {
    return [{ x: joinPt.x, y: joinPt.y, z }];
  }

  const points: LoopPoint[] = [];
  const steps = Math.max(1, Math.ceil(arcLen / sampleSpacing));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const delta = t * arcLen;
    let s = forward ? fromS + delta : fromS - delta;
    s = ((s % total) + total) % total;
    const pt = sampleGuideAtS(guide, s);
    points.push({ x: pt.x, y: pt.y, z });
  }

  return points;
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

/** Forward pass advance from stepover % of tool diameter. */
export function adaptiveForwardIncrement(toolDiameter: number, stepoverPercent: number): number {
  const toolD = Math.max(toolDiameter, 0.1);
  const ae = toolD * (stepoverPercent / 100);
  return Math.max(ae, toolD * 0.05);
}
