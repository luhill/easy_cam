import ClipperLib from 'clipper-lib';
import type { LoopPoint } from '../types/operations';

export type OutlineWallSide = 'exterior' | 'interior';

/** Integer scale for Clipper (0.001 mm resolution). */
export const CLIPPER_SCALE = 1000;

export interface PolygonOffsetOptions {
  /** Round joins at convex corners (CAM tool corner radius behavior). */
  joinType?: ClipperLib.JoinType;
  /** Miter limit when joinType is jtMiter. */
  miterLimit?: number;
  /** Arc tolerance for round joins, in scaled units. */
  arcTolerance?: number;
  /** Resample longest edges to at most this length (mm). 0 = keep Clipper output. */
  maxSegmentLen?: number;
  wallSide?: OutlineWallSide;
}

const DEFAULT_OPTIONS: Required<PolygonOffsetOptions> = {
  joinType: ClipperLib.JoinType.jtRound,
  miterLimit: 2,
  arcTolerance: 0.25 * CLIPPER_SCALE,
  maxSegmentLen: 0,
  wallSide: 'exterior',
};

function toClipperPath(loop: LoopPoint[]): ClipperLib.Path {
  return loop.map((p) => ({
    X: Math.round(p.x * CLIPPER_SCALE),
    Y: Math.round(p.y * CLIPPER_SCALE),
  }));
}

function fromClipperPath(path: ClipperLib.Path, z: number): LoopPoint[] {
  return path.map((p) => ({
    x: p.X / CLIPPER_SCALE,
    y: p.Y / CLIPPER_SCALE,
    z,
  }));
}

function pathArea2D(path: ClipperLib.Path): number {
  let area = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    area += a.X * b.Y - b.X * a.Y;
  }
  return area / 2;
}

function densifyLoop(loop: LoopPoint[], maxSegmentLen: number): LoopPoint[] {
  if (loop.length < 2 || maxSegmentLen <= 0) return loop;

  const result: LoopPoint[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if (i === 0) result.push({ ...a });

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len <= maxSegmentLen) {
      if (i < loop.length - 1) result.push({ ...b });
      continue;
    }

    const steps = Math.ceil(len / maxSegmentLen);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      result.push({
        x: a.x + dx * t,
        y: a.y + dy * t,
        z: a.z + (b.z - a.z) * t,
      });
    }
  }

  return result;
}

function removeDuplicateClosingPoint(loop: LoopPoint[]): LoopPoint[] {
  if (loop.length < 2) return loop;
  const first = loop[0];
  const last = loop[loop.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) {
    return loop.slice(0, -1);
  }
  return loop;
}

/** Remove near-duplicate/collinear vertices without collapsing the loop shape. */
export function cleanClosedOffsetLoop(loop: LoopPoint[]): LoopPoint[] {
  if (loop.length < 3) return loop.map((p) => ({ ...p }));

  const z = loop[0]?.z ?? 0;
  const path = toClipperPath(loop);
  const cleaned = ClipperLib.Clipper.CleanPolygon(path, 0.02 * CLIPPER_SCALE);
  if (cleaned.length < 3) return loop.map((p) => ({ ...p }));

  return removeDuplicateClosingPoint(fromClipperPath(cleaned, z));
}

/**
 * Constant-distance offset of a closed XY loop using Angus Johnson's Clipper.
 *
 * Winding contract (enforced upstream in mesh selection):
 * - exterior walls: CCW → positive delta expands away from the part
 * - interior void walls: CW → negative delta insets into the void
 *
 * Pass `magnitude * offsetSign` as deltaMm (offsetSign: exterior +1, interior −1).
 */
export function offsetClosedLoop2D(
  loop: LoopPoint[],
  deltaMm: number,
  options: PolygonOffsetOptions = {}
): LoopPoint[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (loop.length < 3 || Math.abs(deltaMm) < 1e-9) {
    return loop.map((p) => ({ ...p }));
  }

  const z = loop[0]?.z ?? 0;
  const path = toClipperPath(loop);

  const clipperOffset = new ClipperLib.ClipperOffset(
    opts.miterLimit,
    opts.arcTolerance
  );
  clipperOffset.AddPath(path, opts.joinType, ClipperLib.EndType.etClosedPolygon);

  const solution: ClipperLib.Path[] = [];
  clipperOffset.Execute(solution, deltaMm * CLIPPER_SCALE);

  if (solution.length === 0) return loop.map((p) => ({ ...p }));

  const wantLargest = deltaMm >= 0;
  let best = solution[0];
  let bestArea = Math.abs(pathArea2D(best));
  for (let i = 1; i < solution.length; i++) {
    const area = Math.abs(pathArea2D(solution[i]));
    if (wantLargest ? area > bestArea : area < bestArea) {
      best = solution[i];
      bestArea = area;
    }
  }

  let result = removeDuplicateClosingPoint(fromClipperPath(best, z));
  if (opts.maxSegmentLen > 0) {
    result = densifyLoop(result, opts.maxSegmentLen);
  }

  return result;
}
