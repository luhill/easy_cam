/**
 * Offset geometry checks — run with: npx tsx src/lib/polygonOffset.test.ts
 */
import { offsetClosedLoop2D } from './polygonOffset';
import {
  offsetLoop2DMinkowski,
  resolveOutlineWallSideByNesting,
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

function circleLoop(cx: number, cy: number, r: number, segments = 16): LoopPoint[] {
  const loop: LoopPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    loop.push(pt(cx + r * Math.cos(t), cy + r * Math.sin(t)));
  }
  return loop;
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

// Nesting: lone perimeter loop is exterior
assert(
  resolveOutlineWallSideByNesting(square, [square], 0) === 'exterior',
  'unnested loop is exterior'
);

// Nesting: pocket centroid inside part perimeter loop
const partPerimeter: LoopPoint[] = [
  pt(0, 0),
  pt(40, 0),
  pt(40, 30),
  pt(0, 30),
];
const allWithPocket = [partPerimeter, teardrop];
assert(
  resolveOutlineWallSideByNesting(teardrop, allWithPocket, 1) === 'interior',
  'pocket nested inside perimeter is interior'
);

// Cylindrical boss outer wall alone
const bossLoop = circleLoop(20, 15, 8);
assert(
  resolveOutlineWallSideByNesting(bossLoop, [bossLoop], 0, 1, 0) === 'exterior',
  'isolated boss outer wall is exterior'
);
const bossOut = signedOffset(bossLoop, 1, 'exterior');
const bossBounds = loopBounds(bossOut);
assert(bossBounds.maxX > 28.5, 'boss outer wall should offset outward');

// Coaxial boss + hole: boss OD exterior, hole ID interior
const holeLoop = circleLoop(20, 15, 4);
const bossAndHole = [bossLoop, holeLoop];
assert(
  resolveOutlineWallSideByNesting(bossLoop, bossAndHole, 0, 1, 0) === 'exterior',
  'boss OD nested in hole centroid but faces outward'
);
assert(
  resolveOutlineWallSideByNesting(holeLoop, bossAndHole, 1, -1, 0) === 'interior',
  'hole ID inside boss is interior'
);

// Island inside pocket: even nesting depth → exterior
const island: LoopPoint[] = [
  pt(8, 8),
  pt(12, 8),
  pt(12, 12),
  pt(8, 12),
];
const pocket: LoopPoint[] = [
  pt(0, 0),
  pt(20, 0),
  pt(20, 20),
  pt(0, 20),
];
const partWithPocketAndIsland = [partPerimeter, pocket, island];
assert(
  resolveOutlineWallSideByNesting(island, partWithPocketAndIsland, 2) === 'exterior',
  'island nested inside pocket (depth 2) is exterior'
);
assert(
  resolveOutlineWallSideByNesting(pocket, partWithPocketAndIsland, 1) === 'interior',
  'pocket nested inside part (depth 1) is interior'
);

console.log('polygonOffset tests passed');
