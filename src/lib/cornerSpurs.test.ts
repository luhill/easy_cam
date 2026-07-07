/**
 * Slot centerline spur checks — run with: npx tsx src/lib/cornerSpurs.test.ts
 */
import { buildSlotCenterGuideWithCornerSpurs } from './cornerSpurs';
import { resolveAdaptiveSlotGeometry } from './adaptiveOutline';
import {
  closestPointOnLoop2D,
  offsetLoop2DMinkowski,
} from './geometryProcessing';
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

function nearestOffsetVertexForCorner(
  guide: LoopPoint[],
  partLoop: LoopPoint[],
  cornerIdx: number
): LoopPoint {
  const corner = partLoop[cornerIdx];
  const n = partLoop.length;
  const adjacentCorners = new Set([
    cornerIdx,
    (cornerIdx - 1 + n) % n,
    (cornerIdx + 1) % n,
  ]);

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let j = 0; j < guide.length; j++) {
    let nearestPartIdx = 0;
    let nearestPartDist = Infinity;
    for (let i = 0; i < partLoop.length; i++) {
      const d = Math.hypot(guide[j].x - partLoop[i].x, guide[j].y - partLoop[i].y);
      if (d < nearestPartDist) {
        nearestPartDist = d;
        nearestPartIdx = i;
      }
    }
    if (!adjacentCorners.has(nearestPartIdx)) continue;
    const d = Math.hypot(guide[j].x - corner.x, guide[j].y - corner.y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = j;
    }
  }
  return guide[bestIdx];
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

const slotCenter = 3;
const innerOffset = 1.5;

// Exterior L-shape with sharp re-entrant corner
const lShape: LoopPoint[] = [
  pt(0, 0),
  pt(30, 0),
  pt(30, 10),
  pt(10, 10),
  pt(10, 30),
  pt(0, 30),
];

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
    'spur should return to the slot-center miter'
  );

  const tip = guide[marker.peakIdx];
  const atPart = closestPointOnLoop2D(tip.x, tip.y, lShape);
  assert(
    atPart.dist >= innerOffset - 0.05,
    'spur tip should sit on finish inner offset, not inside it'
  );
}

assert(!hasSelfIntersection(guide), 'slot center guide with spurs must not self-intersect');

// 145° concave corner — sharpen miter but no spur (max 130°), no bow-tie loop
const shallowNotch: LoopPoint[] = [
  pt(0, 0),
  pt(10, 0),
  pt(25, 4.7),
  pt(40, 0),
  pt(50, 0),
  pt(50, 30),
  pt(0, 30),
];

const obtuseGuide = buildSlotCenterGuideWithCornerSpurs(
  shallowNotch,
  slotCenter,
  innerOffset,
  0.2,
  { maxInternalAngleDeg: 130 },
  1,
  'exterior'
);
assert(obtuseGuide.spurMarkers.length === 0, '145° corner should not insert a spur');
assert(
  !hasSelfIntersection(obtuseGuide.guide),
  '145° concave corner should not leave a bow-tie on the centerline'
);

// Acute re-entrant notch — spur tip must be the finish-inner miter, not past it toward the part vertex
const acuteV: LoopPoint[] = [
  pt(0, 0),
  pt(12, 0),
  pt(15, 12),
  pt(18, 0),
  pt(30, 0),
  pt(30, 25),
  pt(0, 25),
];
const acute = buildSlotCenterGuideWithCornerSpurs(
  acuteV,
  slotCenter,
  innerOffset,
  0.2,
  { maxInternalAngleDeg: 160 },
  1,
  'exterior'
);
assert(acute.spurMarkers.length >= 1, 'acute notch should insert a spur');

const vCornerIdx = 2;
const expectedCenterline = offsetLoop2DMinkowski(acuteV, slotCenter, 0.2, 'exterior');
const expectedFinishInner = offsetLoop2DMinkowski(acuteV, innerOffset, 0.2, 'exterior');
const expectedA = nearestOffsetVertexForCorner(expectedCenterline, acuteV, vCornerIdx);
const expectedB = nearestOffsetVertexForCorner(expectedFinishInner, acuteV, vCornerIdx);

for (const marker of acute.spurMarkers) {
  const tip = acute.guide[marker.peakIdx];
  assert(
    Math.hypot(tip.x - expectedB.x, tip.y - expectedB.y) < 0.15,
    'spur tip should match finish-inner offset vertex'
  );

  const slotAnchor = acute.guide[marker.miterIdx];
  assert(
    Math.hypot(slotAnchor.x - expectedA.x, slotAnchor.y - expectedA.y) < 0.15,
    'spur anchor should match slot-center offset vertex'
  );
}

assert(!hasSelfIntersection(acute.guide), 'acute notch guide must not self-intersect');

// Realistic tool offsets — slot/finish miters must stay separated (non-zero spur).
const realisticSettings = {
  toolDiameter: 6,
  radialOffset: 0,
  slotWidthPercent: 150,
  stepover: 40,
  finishingPass: true,
  finishingStockPercent: 7,
  climbMilling: true,
  feedRate: 1000,
  plungeRate: 300,
  stepDown: 2,
  depthOffset: 0,
} as import('../types/operations').OperationDefaults;
const realisticRough = resolveAdaptiveSlotGeometry(realisticSettings, { roughing: true });
const realisticFinish = resolveAdaptiveSlotGeometry(realisticSettings, { roughing: false });
const realisticAcute = buildSlotCenterGuideWithCornerSpurs(
  acuteV,
  realisticRough.slotCenterOffset,
  realisticFinish.innerCenterOffset,
  0.15,
  { maxInternalAngleDeg: 130 },
  1,
  'exterior'
);
assert(realisticAcute.spurMarkers.length >= 1, 'acute notch should spur with realistic offsets');
for (const marker of realisticAcute.spurMarkers) {
  const start = realisticAcute.guide[marker.miterIdx];
  const tip = realisticAcute.guide[marker.peakIdx];
  assert(
    Math.hypot(tip.x - start.x, tip.y - start.y) >= 0.5,
    'realistic acute spur must have visible bisector length'
  );
}

// Narrow symmetric taper to a point — convex needle tips must not get spurs or bow-ties
const taper: LoopPoint[] = [
  pt(0, 0),
  pt(6, 16),
  pt(10, 18),
  pt(14, 16),
  pt(20, 0),
  pt(30, 0),
  pt(30, 25),
  pt(0, 25),
];
const taperGuide = buildSlotCenterGuideWithCornerSpurs(
  taper,
  slotCenter,
  innerOffset,
  0.15,
  { maxInternalAngleDeg: 160 },
  1,
  'exterior'
);
assert(
  taperGuide.spurMarkers.length === 0,
  'taper shoulders must not insert spurs that cross at the apex'
);
assert(
  !hasSelfIntersection(taperGuide.guide),
  'narrow taper must not produce bow-tie chord at apex'
);

// V-notch at top edge — spurs at both re-entrant base corners
const vNotch: LoopPoint[] = [
  pt(0, 0),
  pt(5, 0),
  pt(10, 18),
  pt(20, 18),
  pt(25, 0),
  pt(30, 0),
  pt(30, 25),
  pt(0, 25),
];
const vGuide = buildSlotCenterGuideWithCornerSpurs(
  vNotch,
  slotCenter,
  innerOffset,
  0.15,
  { maxInternalAngleDeg: 130 },
  1,
  'exterior'
);
assert(vGuide.spurMarkers.length >= 2, 'V-notch base corners should insert spurs');

// Interior pocket (CW) — spur tips stay on finish inner envelope
const pocketInterior = [
  pt(0, 0),
  pt(0, 20),
  pt(20, 20),
  pt(20, 0),
].reverse();

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
