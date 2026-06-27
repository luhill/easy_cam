import type { LoopPoint } from '../types/operations';
import type { ToolpathPoint } from '../types/operations';

export interface TrochoidalParams {
  /** Trochoid circle radius (mm) — controls slot width swept per loop */
  trochoidRadius: number;
  /** Forward advance along guide path per full 2π rotation (mm) */
  forwardIncrement: number;
  /** Cutting Z */
  z: number;
  /** Max angular step per point (radians) */
  maxAngleStep?: number;
}

/**
 * Local trochoid point (LinuxCNC / Wikipedia trochoid, normalized frame).
 * Motion advances +X; tool traces circles of radius b while rolling forward.
 */
export function trochoidPointLocal(angleRad: number, a: number, b: number): [number, number] {
  const x = a * angleRad - b * Math.sin(angleRad) - a * Math.PI;
  const y = b - b * Math.cos(angleRad) - 2 * b;
  return [x, y];
}

/** Generate trochoidal path along a straight segment (start → end). */
export function trochoidSegment(
  start: { x: number; y: number },
  end: { x: number; y: number },
  params: TrochoidalParams
): ToolpathPoint[] {
  const { trochoidRadius: b, forwardIncrement: increment, z } = params;
  const maxAngleStep = params.maxAngleStep ?? (5 * Math.PI) / 180;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6 || increment <= 0 || b <= 0) {
    return [{ x: end.x, y: end.y, z }];
  }

  const rot = Math.atan2(dy, dx);
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const a = increment / (2 * Math.PI);

  const totalAngle = 2 * Math.PI * Math.ceil(length / increment);
  const points: ToolpathPoint[] = [];

  for (let ang = 0; ang <= totalAngle + 1e-9; ang += maxAngleStep) {
    const [lx, ly] = trochoidPointLocal(ang, a, b);
    points.push({
      x: start.x + lx * cosR - ly * sinR,
      y: start.y + lx * sinR + ly * cosR,
      z,
    });
  }

  return points;
}

/** Insert points along a closed loop so no segment exceeds maxLen. */
export function densifyLoop(loop: LoopPoint[], maxSegmentLen: number): LoopPoint[] {
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

/**
 * Trochoidal clearing around a closed guide loop.
 * Chains trochoid segments corner-to-corner while slowly advancing around the part.
 */
export function generateTrochoidalOutlinePath(
  guideLoop: LoopPoint[],
  params: TrochoidalParams
): ToolpathPoint[] {
  if (guideLoop.length < 3) return [];

  const segmentLen = Math.max(params.forwardIncrement * 0.5, params.trochoidRadius * 0.25);
  const dense = densifyLoop(guideLoop, segmentLen);
  const points: ToolpathPoint[] = [];

  for (let i = 0; i < dense.length; i++) {
    const start = dense[i];
    const end = dense[(i + 1) % dense.length];
    const seg = trochoidSegment(start, end, params);
    if (seg.length === 0) continue;

    if (points.length > 0) {
      const last = points[points.length - 1];
      const first = seg[0];
      if (Math.hypot(last.x - first.x, last.y - first.y) < 0.01) {
        points.push(...seg.slice(1));
        continue;
      }
    }
    points.push(...seg);
  }

  return points;
}

/** Compute trochoid radius from slot width and tool diameter. */
export function defaultTrochoidRadius(slotWidth: number, toolDiameter: number): number {
  const toolR = toolDiameter / 2;
  const excess = Math.max(slotWidth - toolDiameter, 0);
  return Math.max(toolR * 0.35, excess / 2 + toolR * 0.15);
}
