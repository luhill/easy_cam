/**
 * Offset geometry checks — run with: npx tsx src/lib/polygonOffset.test.ts
 */
import { offsetClosedLoop2D } from './polygonOffset';
import { offsetLoop2DMinkowski, signedLoopArea2D } from './geometryProcessing';
import type { LoopPoint } from '../types/operations';

const Z = 0;
const pt = (x: number, y: number): LoopPoint => ({ x, y, z: Z });

function loopBounds(loop: LoopPoint[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of loop) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

function segmentsProperlyCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  eps = 1e-6
): boolean {
  const cross = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (rx - px) * (qy - py) - (ry - py) * (qx - px);

  const o1 = cross(ax, ay, bx, by, cx, cy);
  const o2 = cross(ax, ay, bx, by, dx, dy);
  const o3 = cross(cx, cy, dx, dy, ax, ay);
  const o4 = cross(cx, cy, dx, dy, bx, by);

  if (Math.abs(o1) <= eps || Math.abs(o2) <= eps || Math.abs(o3) <= eps || Math.abs(o4) <= eps) {
    return false;
  }
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function hasSelfIntersection(loop: LoopPoint[]): boolean {
  const n = loop.length;
  if (n < 4) return false;

  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = loop[j];
      const d = loop[(j + 1) % n];
      if (segmentsProperlyCross(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) {
        return true;
      }
    }
  }
  return false;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// CCW square 0..10
const square: LoopPoint[] = [
  pt(0, 0),
  pt(10, 0),
  pt(10, 10),
  pt(0, 10),
];

const squareOut = offsetClosedLoop2D(square, 2);
const sqBounds = loopBounds(squareOut);
assert(sqBounds.minX < -0.5 && sqBounds.maxX > 10.5, 'exterior square should expand outward');
assert(!hasSelfIntersection(squareOut), 'exterior square offset must not self-intersect');

// Sharp V-notch (concave at bottom)
const vNotch: LoopPoint[] = [
  pt(0, 10),
  pt(10, 10),
  pt(10, 0),
  pt(5, 4),
  pt(0, 0),
];
const vOut = offsetLoop2DMinkowski(vNotch, 1, 0.2, 'exterior');
assert(!hasSelfIntersection(vOut), 'V-notch exterior offset must not self-intersect');

// Interior teardrop (CW hole)
const teardrop: LoopPoint[] = [
  pt(10, 20),
  pt(14, 16),
  pt(14, 10),
  pt(10, 6),
  pt(6, 10),
  pt(6, 16),
];
assert(signedLoopArea2D(teardrop) < 0, 'teardrop should be CW for interior void');
const tearIn = offsetLoop2DMinkowski(teardrop, -1, 0.2, 'interior');
const tearBounds = loopBounds(tearIn);
assert(tearBounds.maxY < 19.5, 'interior teardrop should inset into void');
assert(!hasSelfIntersection(tearIn), 'interior teardrop offset must not self-intersect');

// Semicircle-ish arc (tessellated)
const arc: LoopPoint[] = [];
const cx = 0;
const cy = 0;
const r = 10;
for (let i = 0; i <= 16; i++) {
  const t = (Math.PI * i) / 16;
  arc.push(pt(cx + r * Math.cos(t), cy + r * Math.sin(t)));
}
arc.push(pt(-10, 0));
const arcOut = offsetLoop2DMinkowski(arc, 1.5, 0.15, 'exterior');
assert(!hasSelfIntersection(arcOut), 'arc exterior offset must not self-intersect');

console.log('polygonOffset tests passed');
