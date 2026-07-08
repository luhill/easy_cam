/**
 * Regression: spurTest.stl — single acute inside corner (straight meets curve).
 * Run with: npm run test:spurtest-spurs
 */
import fs from 'node:fs';
import { STLLoader } from 'three-stdlib';
import { MeshIndex } from './meshSelection';
import { buildSlotCenterGuideWithCornerSpurs } from './cornerSpurs';
import { resolveAdaptiveSlotGeometry, cornerSpurOptionsForRoughing } from './adaptiveOutline';
import { defaultSettingsForOperation } from '../types/operations';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const buf = fs.readFileSync(new URL('../../public/samples/spurTest.stl', import.meta.url));
const geo = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const mesh = new MeshIndex(geo);

const settings = defaultSettingsForOperation('adaptive-outline');
const rough = resolveAdaptiveSlotGeometry(settings, { roughing: true });
const opts = cornerSpurOptionsForRoughing(settings);

const loop = mesh.edgeLoops[0];
assert(loop !== undefined, 'spurTest.stl should expose one exterior edge loop');

const result = buildSlotCenterGuideWithCornerSpurs(
  loop.topLoop,
  rough.slotCenterOffset,
  rough.innerCenterOffset,
  0.15,
  opts,
  loop.offsetSign,
  loop.wallSide
);

assert(result.spurMarkers.length === 1, 'spurTest should insert exactly one spur');

const marker = result.spurMarkers[0];
assert(
  marker.peakIdx === marker.miterIdx + 1 && marker.returnIdx === marker.miterIdx + 2,
  'spur branch must be exactly A, B, A'
);

const a = result.guide[marker.miterIdx];
const b = result.guide[marker.peakIdx];
const aReturn = result.guide[marker.returnIdx];
assert(
  Math.hypot(b.x - a.x, b.y - a.y) >= 0.5,
  'spurTest spur must have visible A→B length'
);
assert(
  Math.hypot(aReturn.x - a.x, aReturn.y - a.y) < 1e-4,
  'spur branch must return to the same A anchor'
);

/** Part corner — acute inside corner where straight meets curve (index 161). */
const partCorner = loop.topLoop[161];
assert(
  Math.hypot(a.x - partCorner.x, a.y - partCorner.y) < 12,
  'spur anchor A must lie on the walked centerline near the inside part corner'
);

/** Spur must not jump off the walked path (miter-only anchor far from centerline). */
const beforeA = result.guide[marker.miterIdx - 1];
assert(beforeA !== undefined, 'spur anchor must follow centerline walk');
const jumpToA = Math.hypot(a.x - beforeA.x, a.y - beforeA.y);
assert(
  jumpToA < 1.5,
  'spur must branch from the walked centerline without a large off-path jump'
);

assert(
  result.guide.length > marker.returnIdx + 20,
  'centerline must continue around the full loop after the spur'
);

function minDistToPartBoundary(
  x: number,
  y: number,
  poly: { x: number; y: number }[]
): number {
  let minDist = Infinity;
  for (let j = 0; j < poly.length; j++) {
    const a = poly[j];
    const b = poly[(j + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) {
      t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    }
    const d = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
    if (d < minDist) minDist = d;
  }
  return minDist;
}

const slotOffset = rough.slotCenterOffset;
const spurOutboundIdx = marker.miterIdx;
const spurReturnIdx = marker.returnIdx;
for (let i = 1; i < result.guide.length; i++) {
  if (i === spurOutboundIdx + 1 || i === spurReturnIdx) continue;
  const mid = {
    x: (result.guide[i - 1].x + result.guide[i].x) / 2,
    y: (result.guide[i - 1].y + result.guide[i].y) / 2,
  };
  assert(
    minDistToPartBoundary(mid.x, mid.y, loop.topLoop) >= slotOffset * 0.9,
    'non-spur centerline segments must stay on the slot offset envelope'
  );
}

console.log('spurTestSpurs tests passed');
