/**
 * Slot centerline spur checks — run with: npx tsx src/lib/cornerSpurs.test.ts
 */
import { buildSlotCenterGuideWithCornerSpurs } from './cornerSpurs';
import { closestPointOnLoop2D } from './geometryProcessing';
import type { LoopPoint } from '../types/operations';

const Z = 0;
const pt = (x: number, y: number): LoopPoint => ({ x, y, z: Z });

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
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

// Exterior L-shape with sharp re-entrant corner
const lShape: LoopPoint[] = [
  pt(0, 0),
  pt(30, 0),
  pt(30, 10),
  pt(10, 10),
  pt(10, 30),
  pt(0, 30),
];

const slotCenter = 3;
const innerOffset = 1.5;

const { guide, spurMarkers } = buildSlotCenterGuideWithCornerSpurs(
  lShape,
  slotCenter,
  innerOffset,
  0.2,
  { maxInternalAngleDeg: 160 },
  1,
  'exterior'
);

assert(guide.length >= lShape.length, 'slot center guide should be populated');
assert(spurMarkers.length >= 1, 'L-shape re-entrant corner should insert a spur');

for (const marker of spurMarkers) {
  const start = guide[marker.miterIdx];
  const end = guide[marker.returnIdx];
  assert(
    Math.hypot(start.x - end.x, start.y - end.y) < 0.02,
    'spur should return to the same anchor point'
  );

  const tip = guide[marker.peakIdx];
  const atPart = closestPointOnLoop2D(tip.x, tip.y, lShape);
  assert(
    atPart.dist >= innerOffset - 0.05,
    'spur tip should not penetrate inside finish inner offset'
  );
}

assert(!hasSelfIntersection(guide), 'slot center guide with spurs must not self-intersect');

// Interior pocket (CW) — spur tips stay outside part envelope
const pocket: LoopPoint[] = [
  pt(0, 0),
  pt(0, 20),
  pt(20, 20),
  pt(20, 0),
];
const pocketInterior = [...pocket].reverse();

const interiorGuide = buildSlotCenterGuideWithCornerSpurs(
  pocketInterior,
  slotCenter,
  innerOffset,
  0.2,
  { maxInternalAngleDeg: 180 },
  -1,
  'interior'
);

for (const marker of interiorGuide.spurMarkers) {
  const tip = interiorGuide.guide[marker.peakIdx];
  const atPart = closestPointOnLoop2D(tip.x, tip.y, pocketInterior);
  assert(
    atPart.dist >= innerOffset - 0.05,
    'interior spur tip should respect finish inner standoff'
  );
}

console.log('cornerSpurs tests passed');
