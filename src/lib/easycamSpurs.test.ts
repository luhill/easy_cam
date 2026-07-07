/**
 * Regression: bundled easycam.stl edge loop — run with: npm run test:easycam-spurs
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

function hasSelfIntersection(loop: { x: number; y: number }[]): boolean {
  const cross = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    (rx - px) * (qy - py) - (ry - py) * (qx - px);
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = loop[j];
      const d = loop[(j + 1) % n];
      const o1 = cross(a.x, a.y, b.x, b.y, c.x, c.y);
      const o2 = cross(a.x, a.y, b.x, b.y, d.x, d.y);
      const o3 = cross(c.x, c.y, d.x, d.y, a.x, a.y);
      const o4 = cross(c.x, c.y, d.x, d.y, b.x, b.y);
      if (Math.abs(o1) <= 1e-6 || Math.abs(o2) <= 1e-6 || Math.abs(o3) <= 1e-6 || Math.abs(o4) <= 1e-6) {
        continue;
      }
      if (o1 * o2 < 0 && o3 * o4 < 0) return true;
    }
  }
  return false;
}

const buf = fs.readFileSync(new URL('../../public/samples/easycam.stl', import.meta.url));
const geo = new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const mesh = new MeshIndex(geo);

const settings = defaultSettingsForOperation('adaptive-outline');
const rough = resolveAdaptiveSlotGeometry(settings, { roughing: true });
const opts = cornerSpurOptionsForRoughing(settings);

/** Main exterior wall loop on the bundled easycam part (298-point top rim). */
const mainExterior = mesh.edgeLoops.find((el) => el.wallSide === 'exterior' && el.topLoop.length >= 200);
assert(mainExterior !== undefined, 'expected main exterior edge loop on easycam.stl');

const result = buildSlotCenterGuideWithCornerSpurs(
  mainExterior!.topLoop,
  rough.slotCenterOffset,
  rough.innerCenterOffset,
  0.15,
  opts,
  mainExterior!.offsetSign,
  mainExterior!.wallSide
);

assert(result.spurMarkers.length >= 1, 'easycam main loop should insert corner spurs at inside corners');

for (const marker of result.spurMarkers) {
  assert(
    marker.peakIdx === marker.miterIdx + 1 && marker.returnIdx === marker.miterIdx + 2,
    'each spur branch must be exactly A, B, A'
  );
  const a = result.guide[marker.miterIdx];
  const b = result.guide[marker.peakIdx];
  assert(
    Math.hypot(b.x - a.x, b.y - a.y) >= 0.3,
    'easycam spurs must have visible A→B length'
  );
}

assert(
  !hasSelfIntersection(result.guide),
  'easycam slot center guide with spurs must not self-intersect'
);

console.log('easycamSpurs tests passed');
