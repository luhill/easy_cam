/**
 * Entry bore placement and finish-pass connection — run with: npm run test:outline-entry
 */
import {
  computeDefaultEntryPoint,
  finishingStockAllowance,
  minimumEntryCenterDist,
  resolveAdaptiveSlotGeometry,
} from './adaptiveOutline';
import {
  minimumStandardHelixEntryCenterDist,
  resolveStandardHelixEntryLayout,
} from './outlineEntry';
import { closestPointOnLoop2D, distanceToLoop2D } from './geometryProcessing';
import { defaultSettingsForOperation, type LoopPoint } from '../types/operations';
import { helixRadiusAtZ, resolveHelixRadius, ensureEntryOutsidePart } from './entryPath';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const pt = (x: number, y: number): LoopPoint => ({ x, y, z: 0 });

const exteriorSquare: LoopPoint[] = [
  pt(0, 0),
  pt(40, 0),
  pt(40, 40),
  pt(0, 40),
];

const interiorPocket: LoopPoint[] = [
  pt(10, 10),
  pt(10, 30),
  pt(30, 30),
  pt(30, 10),
];

const baseAdaptive = defaultSettingsForOperation('adaptive-outline');
const withFinish = {
  ...baseAdaptive,
  finishingPass: true,
  finishingStockPercent: 7,
};
const noFinish = {
  ...baseAdaptive,
  finishingPass: false,
};

const finishEntry = computeDefaultEntryPoint(exteriorSquare, withFinish, null, 1, 'exterior');
const roughEntry = computeDefaultEntryPoint(exteriorSquare, noFinish, null, 1, 'exterior');
const finishDist = distanceToLoop2D(finishEntry.x, finishEntry.y, exteriorSquare);
const roughDist = distanceToLoop2D(roughEntry.x, roughEntry.y, exteriorSquare);
assert(
  finishDist > roughDist + finishingStockAllowance(withFinish) * 0.8,
  'adaptive entry bore should move outward by finish allowance when finishing pass is enabled'
);

const stock = finishingStockAllowance(withFinish);
const finishSlot = resolveAdaptiveSlotGeometry(withFinish, { roughing: false });
const roughSlot = resolveAdaptiveSlotGeometry(withFinish, { roughing: true });
assert(
  roughSlot.innerCenterOffset > finishSlot.innerCenterOffset + stock * 0.9,
  'rough slot inner offset should include finish stock allowance'
);
assert(
  minimumEntryCenterDist(withFinish) > minimumEntryCenterDist(noFinish) + stock * 0.8,
  'minimum entry center distance should grow with finish allowance'
);

const interiorJoin = { x: 20, y: 20 };
const helixLayout = resolveStandardHelixEntryLayout(
  interiorPocket,
  { ...defaultSettingsForOperation('outline'), outlineEntryType: 'helix', finishingPass: true },
  stock,
  { edgeLoops: [{ loop: interiorPocket, faceIndices: [], topZ: 0, bottomZ: -5, offsetSign: -1, wallSide: 'interior' }] },
  null
);
assert(helixLayout !== null, 'interior helix layout should resolve');
const helixStart = helixLayout!.toolStart;
const joinWall = closestPointOnLoop2D(helixLayout!.joinPoint.x, helixLayout!.joinPoint.y, interiorPocket);
const startWall = closestPointOnLoop2D(helixStart.x, helixStart.y, interiorPocket);
const joinAlong =
  (helixLayout!.joinPoint.x - joinWall.x) * joinWall.outX +
  (helixLayout!.joinPoint.y - joinWall.y) * joinWall.outY;
const startAlong =
  (helixStart.x - startWall.x) * startWall.outX + (helixStart.y - startWall.y) * startWall.outY;
assert(
  startAlong > joinAlong + 0.05,
  'interior helix bore should sit further into the pocket void than the join point'
);

const outlineSettings = {
  ...defaultSettingsForOperation('outline'),
  outlineEntryType: 'helix' as const,
  boreTaperAngleDeg: 5,
  stepover: 10,
};
const bottomR = helixRadiusAtZ(outlineSettings, -5, 0);
const topR = resolveHelixRadius(outlineSettings);
assert(bottomR + 1e-3 < topR, 'tapered helix settings should narrow below stock top');

const finishMag =
  outlineSettings.toolDiameter / 2 + (outlineSettings.radialOffset ?? 0);
const roughToolPos = { x: 35, y: 20 };
const roughOnWall = closestPointOnLoop2D(roughToolPos.x, roughToolPos.y, interiorPocket);
const roughCenter = {
  x: roughOnWall.x + roughOnWall.outX * (finishMag + stock),
  y: roughOnWall.y + roughOnWall.outY * (finishMag + stock),
};
const finishOnWall = closestPointOnLoop2D(roughCenter.x, roughCenter.y, interiorPocket);
const finishCenter = {
  x: finishOnWall.x + finishOnWall.outX * finishMag,
  y: finishOnWall.y + finishOnWall.outY * finishMag,
};
const roughAlong =
  (roughCenter.x - roughOnWall.x) * roughOnWall.outX +
  (roughCenter.y - roughOnWall.y) * roughOnWall.outY;
const finishAlong =
  (finishCenter.x - finishOnWall.x) * finishOnWall.outX +
  (finishCenter.y - finishOnWall.y) * finishOnWall.outY;
assert(
  finishAlong < roughAlong - stock * 0.5,
  'finish contour entry should move toward the wall from the roughing standoff'
);

assert(
  minimumStandardHelixEntryCenterDist(
    { ...defaultSettingsForOperation('outline'), finishingPass: true },
    stock
  ) >
    minimumStandardHelixEntryCenterDist(
      { ...defaultSettingsForOperation('outline'), finishingPass: false },
      0
    ),
  'standard helix minimum bore distance should include finish stock allowance'
);

const interiorDeep = ensureEntryOutsidePart(
  interiorPocket,
  { x: 20, y: 20 },
  2.5,
  'interior'
);
assert(
  Math.hypot(interiorDeep.x - 20, interiorDeep.y - 20) < 0.01,
  'interior void placement should accept a point deep inside the pocket'
);

const interiorRejected = ensureEntryOutsidePart(
  interiorPocket,
  { x: 5, y: 20 },
  2.5,
  'interior'
);
assert(
  Math.hypot(interiorRejected.x - 10, interiorRejected.y - 20) >= 2.4,
  'interior placement outside void should push back to minimum standoff'
);

console.log('outlineEntry tests passed');
