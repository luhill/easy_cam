/**
 * Offset geometry checks — run with: npx tsx src/lib/polygonOffset.test.ts
 */
import { offsetClosedLoop2D } from './polygonOffset';
import {
  offsetLoop2DMinkowski,
  resolveOutlineWallSide,
  resolveWallOutwardOffsetSign,
  signedLoopArea2D,
} from './geometryProcessing';
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

function signedOffset(
  loop: LoopPoint[],
  magnitude: number,
  wallSide: 'exterior' | 'interior',
  segLen = 0.15
): LoopPoint[] {
  const sign = resolveWallOutwardOffsetSign(loop, 0, 0, wallSide);
  return offsetLoop2DMinkowski(loop, magnitude * sign, segLen, wallSide);
}

// CCW square 0..10 — exterior
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

const extOut = signedOffset(square, 2, 'exterior');
const extBounds = loopBounds(extOut);
assert(extBounds.minX < -0.5 && extBounds.maxX > 10.5, 'exterior convention should expand outward');

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
const tearIn = signedOffset(teardrop, 1, 'interior');
const tearBounds = loopBounds(tearIn);
assert(tearBounds.maxY < 19.5, 'interior teardrop should inset into void');
assert(!hasSelfIntersection(tearIn), 'interior teardrop offset must not self-intersect');

const squarePartBounds = { minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 };
const largePartBounds = { minX: 0, maxX: 50, minY: 0, maxY: 30, minZ: 0, maxZ: 10 };
assert(resolveOutlineWallSide(square, 0, 0, squarePartBounds) === 'exterior', 'large loop is exterior');
assert(resolveOutlineWallSide(teardrop, 0, 0, largePartBounds) === 'interior', 'small loop is interior');

console.log('polygonOffset tests passed');
