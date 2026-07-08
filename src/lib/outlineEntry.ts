import type { LoopPoint, OperationDefaults, SelectedGeometry, ToolpathPoint } from '../types/operations';
import type { ToolOrigin } from './geometryProcessing';
import {
  closestPointOnLoop2D,
  offsetLoop2DMinkowski,
  signedLoopArea2D,
} from './geometryProcessing';
import {
  advanceGuideArcLength,
  buildArcLengthGuide,
  buildOpenArcLengthGuide,
  findClosestSOnGuide,
  guideArcLengthBetween,
  sampleGuideAtS,
  sampleOpenGuideAtS,
  type ArcLengthGuide,
} from './trochoidalPath';
import {
  ensureEntryOutsidePart,
  resolveHelixRadius,
} from './entryPath';
import { resolveGuideTraverseSign } from './adaptiveFourZone';

export type OutlineEntryType = 'linear' | 'helix' | 'straight';

export function outlineRampLengthMm(settings: OperationDefaults): number {
  const toolD = Math.max(settings.toolDiameter, 0.1);
  const mult = Math.max(settings.rampLengthToolDiameters ?? 5, 0.1);
  return toolD * mult;
}

/** Entry / ramp start height above stock top — min(global safe height, Z start offset). */
export function outlineApproachWorldZ(
  stockTopZ: number,
  safeHeight: number,
  zStartOffset: number
): number {
  return stockTopZ + Math.min(Math.max(safeHeight, 0), Math.max(zStartOffset, 0));
}

function toolRadius(settings: OperationDefaults): number {
  return Math.max(settings.toolDiameter, 0.1) / 2;
}

function innerToolCenterOffset(settings: OperationDefaults, stockAllowance = 0): number {
  return toolRadius(settings) + (settings.radialOffset ?? 0) + stockAllowance;
}

export function buildOutlineToolCenterline(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance = 0,
  maxSegmentLen = 0.3
): LoopPoint[] {
  const offset = innerToolCenterOffset(settings, stockAllowance);
  const segLen = Math.max(maxSegmentLen, Math.abs(offset) * 0.22, 0.4);
  const toolLoop = offsetLoop2DMinkowski(partLoop, offset, segLen);
  const ccw = signedLoopArea2D(partLoop) >= 0;
  const reverse = settings.climbMilling ? ccw : !ccw;
  return reverse ? [...toolLoop].reverse() : toolLoop;
}

export function buildOutlineEntryArcGuide(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance: number,
  sampleSpacing: number
): ArcLengthGuide {
  return buildArcLengthGuide(
    buildOutlineToolCenterline(partLoop, settings, stockAllowance),
    Math.max(sampleSpacing, 0.25)
  );
}

export type ToolOriginXY = Pick<ToolOrigin, 'x' | 'y'>;

/** Closest point on a closed loop to the tool origin XY. */
export function closestPointOnLoopToOrigin(
  loop: LoopPoint[],
  origin: ToolOriginXY,
  sampleSpacing = 0.25
): { x: number; y: number } {
  if (loop.length === 0) return { x: origin.x, y: origin.y };
  const guide = buildArcLengthGuide(loop, Math.max(sampleSpacing, 0.25));
  if (guide.totalLength <= 0) return { x: loop[0].x, y: loop[0].y };
  const hit = findClosestSOnGuide(guide, origin);
  const frame = sampleGuideAtS(guide, hit.s);
  return { x: frame.x, y: frame.y };
}

/** Contour point where linear ramp, straight plunge, or helix tangent begins. */
export function resolveStandardOutlineEntryStart(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance: number,
  geometry: SelectedGeometry | null | undefined,
  toolOrigin?: ToolOriginXY | null
): { x: number; y: number } {
  const layout = resolveStandardEntryLayout(
    partLoop,
    settings,
    stockAllowance,
    geometry,
    0.25,
    0.3,
    toolOrigin
  );
  if (layout) return layout.contourJoin;

  const traverse = buildOutlineToolCenterline(partLoop, settings, stockAllowance);
  if (traverse.length === 0) return { x: toolOrigin?.x ?? 0, y: toolOrigin?.y ?? 0 };
  return { x: traverse[0].x, y: traverse[0].y };
}

export function snapStandardOutlineEntryPoint(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance: number,
  point: { x: number; y: number },
  sampleSpacing: number
): { x: number; y: number } {
  const guide = buildOutlineEntryArcGuide(partLoop, settings, stockAllowance, sampleSpacing);
  const hit = findClosestSOnGuide(guide, point);
  const frame = sampleGuideAtS(guide, hit.s);
  return { x: frame.x, y: frame.y };
}

/** Snap an XY pick to the nearest point on the outline tool centerline guide. */
export function snapPointToOutlineCenterline(
  arcGuide: ArcLengthGuide,
  point: { x: number; y: number }
): { x: number; y: number; s: number } {
  const hit = findClosestSOnGuide(arcGuide, point);
  const frame = sampleGuideAtS(arcGuide, hit.s);
  return { x: frame.x, y: frame.y, s: hit.s };
}

export interface StandardEntryOverrides {
  toolStartPoint?: { x: number; y: number } | null;
  slotJoinPoint?: { x: number; y: number } | null;
  /** @deprecated maps to toolStartPoint */
  entryPoint?: { x: number; y: number } | null;
}

export interface StandardEntryLayout {
  toolStart: { x: number; y: number };
  contourJoin: { x: number; y: number };
  contourJoinS: number;
  traverseTangent: { x: number; y: number };
  guideTraverseSign: number;
  arcGuide: ArcLengthGuide;
  traverse: LoopPoint[];
}

/** Resolve bore/entry start, contour join, and tangent for standard outline entry. */
export function resolveStandardEntryLayout(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance: number,
  geometry: SelectedGeometry | null | undefined,
  sampleSpacing: number,
  maxSegmentLen = 0.3,
  toolOrigin?: ToolOriginXY | null
): StandardEntryLayout | null {
  if (partLoop.length < 2) return null;

  const traverse = buildOutlineToolCenterline(partLoop, settings, stockAllowance, maxSegmentLen);
  if (traverse.length < 3) return null;

  const arcGuide = buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  if (arcGuide.totalLength <= 0) return null;

  const guideTraverseSign = resolveGuideTraverseSign(traverse, settings.climbMilling, 'exterior');
  const tangentSign = guideTraverseSign >= 0 ? 1 : -1;

  const joinSnap = geometry?.slotJoinPoint
    ? findClosestSOnGuide(arcGuide, geometry.slotJoinPoint)
    : toolOrigin
      ? findClosestSOnGuide(arcGuide, toolOrigin)
      : { s: 0 };
  const contourJoinS = joinSnap.s;
  const joinFrame = sampleGuideAtS(arcGuide, contourJoinS);
  const contourJoin = { x: joinFrame.x, y: joinFrame.y };
  const tLen = Math.hypot(joinFrame.tx, joinFrame.ty) || 1;
  const traverseTangent = {
    x: (joinFrame.tx * tangentSign) / tLen,
    y: (joinFrame.ty * tangentSign) / tLen,
  };

  const toolStartOverride = geometry?.toolStartPoint ?? geometry?.entryPoint ?? null;
  const toolStart = toolStartOverride
    ? { x: toolStartOverride.x, y: toolStartOverride.y }
    : contourJoin;

  return {
    toolStart,
    contourJoin,
    contourJoinS,
    traverseTangent,
    guideTraverseSign,
    arcGuide,
    traverse,
  };
}

export function standardEntryNeedsLeadIn(layout: StandardEntryLayout): boolean {
  return (
    Math.hypot(
      layout.toolStart.x - layout.contourJoin.x,
      layout.toolStart.y - layout.contourJoin.y
    ) > 0.5
  );
}

/** Tangent to a bore circle at the tool position (helix exit direction). */
export function helixBoreExitTangent(
  boreCenter: { x: number; y: number },
  boreBottom: { x: number; y: number },
  rotDir: number
): { x: number; y: number } {
  const rx = boreBottom.x - boreCenter.x;
  const ry = boreBottom.y - boreCenter.y;
  const rLen = Math.hypot(rx, ry) || 1;
  return { x: (-ry / rLen) * rotDir, y: (rx / rLen) * rotDir };
}

/** Tighter Hermite lead-in for standard outline (less bow than adaptive slot entry). */
export function buildOutlineSplineEntryGuide(
  toolStart: { x: number; y: number },
  contourJoin: { x: number; y: number },
  exitTangent: { x: number; y: number },
  sampleSpacing: number,
  z: number,
  startTangent?: { x: number; y: number }
): LoopPoint[] {
  const dx = contourJoin.x - toolStart.x;
  const dy = contourJoin.y - toolStart.y;
  const chord = Math.hypot(dx, dy);
  if (chord <= 1e-6) {
    return [{ x: contourJoin.x, y: contourJoin.y, z }];
  }
  if (chord <= sampleSpacing * 0.25) {
    return [
      { x: toolStart.x, y: toolStart.y, z },
      { x: contourJoin.x, y: contourJoin.y, z },
    ];
  }

  const startHandle = Math.min(Math.max(chord * 0.22, sampleSpacing), chord * 0.38);
  const endHandle = Math.max(chord * 0.72, sampleSpacing * 2.5);
  const startDir = startTangent ?? { x: dx / chord, y: dy / chord };
  const sLen = Math.hypot(startDir.x, startDir.y) || 1;
  const t0 = {
    x: (startDir.x / sLen) * startHandle,
    y: (startDir.y / sLen) * startHandle,
  };
  const tLen = Math.hypot(exitTangent.x, exitTangent.y) || 1;
  const t1 = {
    x: (exitTangent.x / tLen) * endHandle,
    y: (exitTangent.y / tLen) * endHandle,
  };

  const steps = Math.max(6, Math.ceil(chord / sampleSpacing));
  const points: LoopPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    points.push({
      x: h00 * toolStart.x + h10 * t0.x + h01 * contourJoin.x + h11 * t1.x,
      y: h00 * toolStart.y + h10 * t0.y + h01 * contourJoin.y + h11 * t1.y,
      z,
    });
  }
  return points;
}

export function buildStandardSplineLeadIn(
  layout: StandardEntryLayout,
  z: number,
  sampleSpacing: number,
  toolStartOverride?: { x: number; y: number },
  startTangent?: { x: number; y: number }
): ToolpathPoint[] {
  const start = toolStartOverride ?? layout.toolStart;
  const spline = buildOutlineSplineEntryGuide(
    start,
    layout.contourJoin,
    layout.traverseTangent,
    sampleSpacing,
    z,
    startTangent
  );
  return spline.map((p) => ({ x: p.x, y: p.y, z }));
}

/** Spline from helix bore-bottom to contour join — tight departure, tangent arrival. */
export function buildHelixOutlineSplineLeadIn(
  boreCenter: { x: number; y: number },
  boreBottom: { x: number; y: number },
  layout: StandardEntryLayout,
  z: number,
  sampleSpacing: number,
  rotDir: number
): ToolpathPoint[] {
  const dx = layout.contourJoin.x - boreBottom.x;
  const dy = layout.contourJoin.y - boreBottom.y;
  const chord = Math.hypot(dx, dy);
  if (chord <= 1e-6) {
    return [{ x: layout.contourJoin.x, y: layout.contourJoin.y, z }];
  }

  const startTan = helixBoreExitTangent(boreCenter, boreBottom, rotDir);
  const startHandle = Math.min(Math.max(chord * 0.12, sampleSpacing * 0.4), chord * 0.22);
  const endHandle = Math.max(chord * 0.72, sampleSpacing * 2.5);
  const sLen = Math.hypot(startTan.x, startTan.y) || 1;
  const t0 = {
    x: (startTan.x / sLen) * startHandle,
    y: (startTan.y / sLen) * startHandle,
  };
  const tLen = Math.hypot(layout.traverseTangent.x, layout.traverseTangent.y) || 1;
  const t1 = {
    x: (layout.traverseTangent.x / tLen) * endHandle,
    y: (layout.traverseTangent.y / tLen) * endHandle,
  };

  const steps = Math.max(6, Math.ceil(chord / sampleSpacing));
  const points: ToolpathPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    points.push({
      x:
        h00 * boreBottom.x +
        h10 * t0.x +
        h01 * layout.contourJoin.x +
        h11 * t1.x,
      y:
        h00 * boreBottom.y +
        h10 * t0.y +
        h01 * layout.contourJoin.y +
        h11 * t1.y,
      z,
    });
  }
  return points;
}

export function standardSplineLeadInFeed(
  layout: StandardEntryLayout,
  z: number,
  feedRate: number,
  sampleSpacing: number,
  skipNear?: { x: number; y: number; z: number },
  toolStartOverride?: { x: number; y: number },
  startTangent?: { x: number; y: number }
): ToolpathPoint[] {
  const pts = buildStandardSplineLeadIn(
    layout,
    z,
    sampleSpacing,
    toolStartOverride,
    startTangent
  ).map((p) => ({
    ...p,
    feedRate,
  }));
  if (!pts.length || !skipNear) return pts;
  const first = pts[0];
  if (
    Math.hypot(first.x - skipNear.x, first.y - skipNear.y) < sampleSpacing * 0.75 &&
    Math.abs(first.z - skipNear.z) < 1e-4
  ) {
    return pts.slice(1);
  }
  return pts;
}

/** Continue a spline lead-in from an intermediate XY (e.g. after ramp ends mid-entry). */
export function standardSplineTailFromPoint(
  layout: StandardEntryLayout,
  z: number,
  feedRate: number,
  fromPoint: { x: number; y: number },
  sampleSpacing: number,
  toolStartOverride?: { x: number; y: number }
): ToolpathPoint[] {
  if (
    Math.hypot(fromPoint.x - layout.contourJoin.x, fromPoint.y - layout.contourJoin.y) <
    sampleSpacing * 0.75
  ) {
    return [];
  }

  const start = toolStartOverride ?? layout.toolStart;
  const spline = buildOutlineSplineEntryGuide(
    start,
    layout.contourJoin,
    layout.traverseTangent,
    sampleSpacing,
    z
  );
  if (spline.length < 2) return [];

  const guide = buildOpenArcLengthGuide(spline, Math.max(sampleSpacing, 0.25), true);
  if (guide.totalLength <= 0) return [];

  const fromS = findClosestSOnGuide(guide, fromPoint).s;
  const remain = guide.totalLength - fromS;
  if (remain < sampleSpacing * 0.25) return [];

  const steps = Math.max(2, Math.ceil(remain / sampleSpacing));
  const points: ToolpathPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = fromS + (i / steps) * remain;
    const frame = sampleOpenGuideAtS(guide, s);
    points.push({ x: frame.x, y: frame.y, z, feedRate });
  }
  return points;
}

/** Minimum bore-center distance from part outline for standard helix entry. */
export function minimumStandardHelixEntryCenterDist(
  settings: OperationDefaults,
  stockAllowance = 0
): number {
  return innerToolCenterOffset(settings, stockAllowance) + resolveHelixRadius(settings);
}

export interface StandardHelixEntryLayout {
  entryStart: { x: number; y: number };
  toolStart: { x: number; y: number };
  joinPoint: { x: number; y: number };
  layout: StandardEntryLayout;
}

export function resolveStandardHelixEntryLayout(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  stockAllowance: number,
  geometry: SelectedGeometry | null | undefined,
  toolOrigin?: ToolOriginXY | null
): StandardHelixEntryLayout | null {
  if (partLoop.length < 2) return null;

  const layout = resolveStandardEntryLayout(
    partLoop,
    settings,
    stockAllowance,
    geometry,
    0.25,
    0.3,
    toolOrigin
  );
  if (!layout) return null;

  const joinPoint = layout.contourJoin;
  const toolStartOverride = geometry?.toolStartPoint ?? geometry?.entryPoint ?? null;
  let toolStart: { x: number; y: number };
  if (toolStartOverride) {
    toolStart = { x: toolStartOverride.x, y: toolStartOverride.y };
  } else {
    const minDist = minimumStandardHelixEntryCenterDist(settings, stockAllowance);
    const helixR = resolveHelixRadius(settings);
    const outward = closestPointOnLoop2D(joinPoint.x, joinPoint.y, partLoop);
    const candidate = {
      x: joinPoint.x + outward.outX * helixR,
      y: joinPoint.y + outward.outY * helixR,
    };
    toolStart = ensureEntryOutsidePart(partLoop, candidate, minDist * 0.98);
  }

  return {
    entryStart: toolStart,
    toolStart,
    joinPoint,
    layout,
  };
}

/** Outward-offset helix bore center so inter-layer bores sit outside the part. */
export function resolveStandardHelixLayerBoreCenter(
  partLoop: LoopPoint[],
  joinPoint: { x: number; y: number },
  settings: OperationDefaults,
  stockAllowance = 0
): { x: number; y: number } {
  const helixR = resolveHelixRadius(settings);
  const outward = closestPointOnLoop2D(joinPoint.x, joinPoint.y, partLoop);
  const candidate = {
    x: joinPoint.x + outward.outX * helixR,
    y: joinPoint.y + outward.outY * helixR,
  };
  const minDist = minimumStandardHelixEntryCenterDist(settings, stockAllowance);
  return ensureEntryOutsidePart(partLoop, candidate, minDist * 0.98);
}

export interface ContourRampResult {
  points: ToolpathPoint[];
  endPoint: { x: number; y: number };
  endS: number;
}

export type StandardLeadInRampMode = 'contour-only' | 'spline-only' | 'spline-hybrid';

export interface StandardLeadInRampResult extends ContourRampResult {
  mode: StandardLeadInRampMode;
  needsSplineTail: boolean;
  loopAnchor: { x: number; y: number };
  loopStartS: number;
  endedOnSpline: boolean;
}

export function standardLeadInChordMm(layout: StandardEntryLayout): number {
  return Math.hypot(
    layout.toolStart.x - layout.contourJoin.x,
    layout.toolStart.y - layout.contourJoin.y
  );
}

export function classifyStandardLeadInRamp(
  layout: StandardEntryLayout,
  rampLengthMm: number
): StandardLeadInRampMode {
  const chord = standardLeadInChordMm(layout);
  if (chord <= 0.5) return 'contour-only';
  if (chord > rampLengthMm * 0.98) return 'spline-only';
  return 'spline-hybrid';
}

function rampLegDz(legLen: number, rampAngleDeg: number, maxDz: number): number {
  const angleRad = (Math.max(rampAngleDeg, 0.5) * Math.PI) / 180;
  return Math.min(legLen * Math.tan(angleRad), maxDz);
}

type HybridRampPhase = 'spline' | 'contour';

interface HybridRampState {
  phase: HybridRampPhase;
  splineS: number;
  splineForward: boolean;
  contourS: number;
  contourForward: boolean;
}

function hybridRampSample(
  state: HybridRampState,
  splineGuide: ArcLengthGuide,
  contourGuide: ArcLengthGuide
): { x: number; y: number } {
  if (state.phase === 'spline') {
    const frame = sampleOpenGuideAtS(splineGuide, state.splineS);
    return { x: frame.x, y: frame.y };
  }
  const frame = sampleGuideAtS(contourGuide, state.contourS);
  return { x: frame.x, y: frame.y };
}

function hybridRampAdvance(
  state: HybridRampState,
  distance: number,
  _splineGuide: ArcLengthGuide,
  contourGuide: ArcLengthGuide,
  splineTotal: number,
  contourTotal: number,
  contourJoinS: number,
  climbForward: boolean
): number {
  let remaining = distance;
  let consumed = 0;

  while (remaining > 1e-6) {
    if (state.phase === 'spline') {
      const avail = state.splineForward ? splineTotal - state.splineS : state.splineS;
      if (avail < 1e-6) {
        if (state.splineForward) {
          state.phase = 'contour';
          state.contourS = contourJoinS;
          state.contourForward = climbForward;
        } else {
          state.splineForward = true;
        }
        continue;
      }
      const step = Math.min(remaining, avail);
      state.splineS += state.splineForward ? step : -step;
      remaining -= step;
      consumed += step;

      if (state.splineForward && state.splineS >= splineTotal - 1e-5) {
        state.splineS = splineTotal;
        state.phase = 'contour';
        state.contourS = contourJoinS;
        state.contourForward = climbForward;
      } else if (!state.splineForward && state.splineS <= 1e-5) {
        state.splineS = 0;
      }
      continue;
    }

    if (!state.contourForward) {
      const avail = guideArcLengthBetween(
        contourTotal,
        state.contourS,
        contourJoinS,
        false
      );
      if (avail < 1e-6) {
        state.phase = 'spline';
        state.splineS = splineTotal;
        state.splineForward = false;
        continue;
      }
      const step = Math.min(remaining, avail);
      state.contourS = advanceGuideArcLength(contourGuide, state.contourS, step, false);
      remaining -= step;
      consumed += step;

      if (
        guideArcLengthBetween(contourTotal, state.contourS, contourJoinS, false) < 1e-4
      ) {
        state.contourS = contourJoinS;
        state.phase = 'spline';
        state.splineS = splineTotal;
        state.splineForward = false;
      }
      continue;
    }

    const step = remaining;
    state.contourS = advanceGuideArcLength(contourGuide, state.contourS, step, true);
    remaining = 0;
    consumed += step;
  }

  return consumed;
}

function hybridRampFlipDirection(state: HybridRampState): void {
  if (state.phase === 'spline') {
    state.splineForward = !state.splineForward;
    return;
  }
  state.contourForward = !state.contourForward;
}

/** Case B: ramp along spline, continue on perimeter, reverse back through join onto spline. */
function generateHybridSplineContourRamp(
  splinePolyline: LoopPoint[],
  traverse: LoopPoint[],
  contourJoinS: number,
  fromZ: number,
  toZ: number,
  rampLengthMm: number,
  rampAngleDeg: number,
  feedRate: number | undefined,
  sampleSpacing: number,
  climbForward: boolean
): ContourRampResult & { endedOnSpline: boolean } {
  const splineGuide = buildOpenArcLengthGuide(
    splinePolyline,
    Math.max(sampleSpacing, 0.25),
    true
  );
  const contourGuide = buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  const splineTotal = splineGuide.totalLength;
  const contourTotal = contourGuide.totalLength;

  if (splineTotal <= 0 || contourTotal <= 0 || Math.abs(fromZ - toZ) < 1e-5) {
    const end = splinePolyline[splinePolyline.length - 1] ?? splinePolyline[0];
    return {
      points: [{ x: end.x, y: end.y, z: toZ, feedRate }],
      endPoint: { x: end.x, y: end.y },
      endS: splineTotal,
      endedOnSpline: true,
    };
  }

  const state: HybridRampState = {
    phase: 'spline',
    splineS: 0,
    splineForward: true,
    contourS: contourJoinS,
    contourForward: climbForward,
  };

  const points: ToolpathPoint[] = [];
  const start = hybridRampSample(state, splineGuide, contourGuide);
  points.push({ x: start.x, y: start.y, z: fromZ, feedRate });

  let currentZ = fromZ;
  let iterations = 0;
  const maxIterations = 5000;

  while (currentZ > toZ + 1e-5 && iterations < maxIterations) {
    const legStartZ = currentZ;
    const legState: HybridRampState = { ...state };
    const traveled = hybridRampAdvance(
      state,
      rampLengthMm,
      splineGuide,
      contourGuide,
      splineTotal,
      contourTotal,
      contourJoinS,
      climbForward
    );

    if (traveled < 1e-6) {
      hybridRampFlipDirection(state);
      iterations++;
      continue;
    }

    const legDz = rampLegDz(traveled, rampAngleDeg, currentZ - toZ);
    const steps = Math.max(1, Math.ceil(traveled / sampleSpacing));

    for (let i = 1; i <= steps; i++) {
      const dist = (i / steps) * traveled;
      const walkState: HybridRampState = { ...legState };
      hybridRampAdvance(
        walkState,
        dist,
        splineGuide,
        contourGuide,
        splineTotal,
        contourTotal,
        contourJoinS,
        climbForward
      );
      const pos = hybridRampSample(walkState, splineGuide, contourGuide);
      points.push({
        x: pos.x,
        y: pos.y,
        z: legStartZ - legDz * (i / steps),
        feedRate,
      });
      iterations++;
    }

    currentZ = legStartZ - legDz;
    hybridRampFlipDirection(state);
    iterations++;
  }

  const endPos = hybridRampSample(state, splineGuide, contourGuide);
  const last = points[points.length - 1];
  if (
    !last ||
    Math.hypot(last.x - endPos.x, last.y - endPos.y) > 1e-4 ||
    Math.abs(last.z - toZ) > 1e-4
  ) {
    points.push({ x: endPos.x, y: endPos.y, z: toZ, feedRate });
  }

  return {
    points,
    endPoint: endPos,
    endS: state.phase === 'spline' ? state.splineS : state.contourS,
    endedOnSpline: state.phase === 'spline',
  };
}

/** First-layer lead-in ramp for Cases A / B / C. */
export function generateStandardLeadInLayerRamp(
  layout: StandardEntryLayout,
  traverse: LoopPoint[],
  fromZ: number,
  toZ: number,
  rampLengthMm: number,
  rampAngleDeg: number,
  feedRate: number | undefined,
  sampleSpacing: number,
  climbForward: boolean
): StandardLeadInRampResult {
  const mode = classifyStandardLeadInRamp(layout, rampLengthMm);
  const splinePolyline = buildOutlineSplineEntryGuide(
    layout.toolStart,
    layout.contourJoin,
    layout.traverseTangent,
    sampleSpacing,
    fromZ
  );

  if (mode === 'contour-only') {
    const ramp = generateContourLinearRamp(
      traverse,
      layout.contourJoin,
      fromZ,
      toZ,
      rampLengthMm,
      rampAngleDeg,
      feedRate,
      sampleSpacing,
      climbForward
    );
    return {
      ...ramp,
      mode,
      needsSplineTail: false,
      loopAnchor: layout.contourJoin,
      loopStartS: layout.contourJoinS,
      endedOnSpline: false,
    };
  }

  if (mode === 'spline-only') {
    const ramp = generateOpenPolylineLinearRamp(
      splinePolyline,
      fromZ,
      toZ,
      rampLengthMm,
      rampAngleDeg,
      feedRate,
      sampleSpacing
    );
    const atJoin =
      Math.hypot(
        ramp.endPoint.x - layout.contourJoin.x,
        ramp.endPoint.y - layout.contourJoin.y
      ) < sampleSpacing * 0.75;
    return {
      ...ramp,
      mode,
      needsSplineTail: !atJoin,
      loopAnchor: layout.contourJoin,
      loopStartS: layout.contourJoinS,
      endedOnSpline: !atJoin,
    };
  }

  const ramp = generateHybridSplineContourRamp(
    splinePolyline,
    traverse,
    layout.contourJoinS,
    fromZ,
    toZ,
    rampLengthMm,
    rampAngleDeg,
    feedRate,
    sampleSpacing,
    climbForward
  );
  const atJoin =
    Math.hypot(
      ramp.endPoint.x - layout.contourJoin.x,
      ramp.endPoint.y - layout.contourJoin.y
    ) < sampleSpacing * 0.75;
  return {
    ...ramp,
    mode,
    needsSplineTail: ramp.endedOnSpline && !atJoin,
    loopAnchor: atJoin ? layout.contourJoin : ramp.endPoint,
    loopStartS: atJoin
      ? layout.contourJoinS
      : findClosestSOnGuide(layout.arcGuide, ramp.endPoint).s,
    endedOnSpline: ramp.endedOnSpline,
  };
}

export function stationOnContour(
  traverse: LoopPoint[],
  point: { x: number; y: number },
  sampleSpacing: number
): number {
  const guide = buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  if (guide.totalLength <= 0) return 0;
  return findClosestSOnGuide(guide, point).s;
}

function appendEdgeSamples(
  points: ToolpathPoint[],
  from: { x: number; y: number },
  to: { x: number; y: number },
  layerZ: number,
  feedRate: number,
  sampleSpacing: number
): void {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len <= sampleSpacing * 0.5) {
    points.push({ x: to.x, y: to.y, z: layerZ, feedRate });
    return;
  }
  const steps = Math.max(1, Math.ceil(len / sampleSpacing));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: layerZ,
      feedRate,
    });
  }
}

function locatePointOnClosedPolyline(
  traverse: LoopPoint[],
  point: { x: number; y: number }
): { edgeIdx: number; startPoint: { x: number; y: number } } {
  const n = traverse.length;
  if (n < 2) return { edgeIdx: 0, startPoint: { x: point.x, y: point.y } };

  let bestEdge = 0;
  let bestDist = Infinity;
  let bestPoint = { x: point.x, y: point.y };

  for (let i = 0; i < n; i++) {
    const a = traverse[i];
    const b = traverse[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t =
      len2 > 1e-12
        ? Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / len2))
        : 0;
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const d = Math.hypot(px - point.x, py - point.y);
    if (d < bestDist) {
      bestDist = d;
      bestEdge = i;
      bestPoint = { x: px, y: py };
    }
  }

  return { edgeIdx: bestEdge, startPoint: bestPoint };
}

/** Walk the offset polyline edge-by-edge for an exact closed perimeter loop. */
export function sampleContourLoopAlongTraverse(
  traverse: LoopPoint[],
  layerZ: number,
  feedRate: number,
  loopAnchor: { x: number; y: number },
  forward = true,
  sampleSpacing: number,
  skipNear?: { x: number; y: number; z: number }
): ToolpathPoint[] {
  const n = traverse.length;
  if (n < 3) return [];

  const { edgeIdx, startPoint } = locatePointOnClosedPolyline(traverse, loopAnchor);
  const points: ToolpathPoint[] = [];

  const skipFirst =
    !!skipNear &&
    Math.hypot(skipNear.x - startPoint.x, skipNear.y - startPoint.y) < sampleSpacing * 0.75 &&
    Math.abs(skipNear.z - layerZ) < 1e-4;

  if (!skipFirst) {
    points.push({ x: startPoint.x, y: startPoint.y, z: layerZ, feedRate });
  }

  const dir = forward ? 1 : -1;
  for (let step = 0; step < n; step++) {
    let fromPt: { x: number; y: number };
    let toPt: { x: number; y: number };

    if (step === 0) {
      fromPt = startPoint;
      const nextVtx = forward ? (edgeIdx + 1) % n : edgeIdx;
      toPt = { x: traverse[nextVtx].x, y: traverse[nextVtx].y };
    } else if (step === n - 1) {
      const prevVtx = forward ? edgeIdx : (edgeIdx + 1) % n;
      fromPt = { x: traverse[prevVtx].x, y: traverse[prevVtx].y };
      toPt = startPoint;
    } else {
      const e = (edgeIdx + dir * step + n * 4) % n;
      if (forward) {
        fromPt = { x: traverse[e].x, y: traverse[e].y };
        toPt = { x: traverse[(e + 1) % n].x, y: traverse[(e + 1) % n].y };
      } else {
        fromPt = { x: traverse[(e + 1) % n].x, y: traverse[(e + 1) % n].y };
        toPt = { x: traverse[e].x, y: traverse[e].y };
      }
    }

    appendEdgeSamples(points, fromPt, toPt, layerZ, feedRate, sampleSpacing);
  }

  const last = points[points.length - 1];
  if (!last || Math.hypot(last.x - startPoint.x, last.y - startPoint.y) > 1e-4) {
    points.push({ x: startPoint.x, y: startPoint.y, z: layerZ, feedRate });
  }

  return points;
}

/** Sample a closed contour loop; full perimeters walk the offset polyline exactly. */
export function sampleContourLoopFromArcS(
  traverse: LoopPoint[],
  layerZ: number,
  feedRate: number,
  startS: number,
  sampleSpacing: number,
  forward = true,
  skipNear?: { x: number; y: number; z: number },
  arcLengthToCut?: number,
  cachedGuide?: ArcLengthGuide,
  loopAnchor?: { x: number; y: number }
): ToolpathPoint[] {
  const guide = cachedGuide ?? buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  const total = guide.totalLength;
  if (total <= 0) return [];

  const cutLength = Math.min(Math.max(arcLengthToCut ?? total, 0), total);
  if (cutLength <= 1e-6) return [];

  const isFullLoop = Math.abs(cutLength - total) < Math.max(sampleSpacing * 0.5, 1e-3);
  const anchor =
    loopAnchor ?? (() => {
      const frame = sampleGuideAtS(guide, startS);
      return { x: frame.x, y: frame.y };
    })();

  if (isFullLoop) {
    return sampleContourLoopAlongTraverse(
      traverse,
      layerZ,
      feedRate,
      anchor,
      forward,
      sampleSpacing,
      skipNear
    );
  }

  const uniformSteps = Math.max(8, Math.ceil(cutLength / sampleSpacing));
  const points: ToolpathPoint[] = [];
  const startFrame = sampleGuideAtS(guide, startS);

  const skipFirstSample =
    !!skipNear &&
    Math.hypot(skipNear.x - startFrame.x, skipNear.y - startFrame.y) <
      sampleSpacing * 0.75 &&
    Math.abs(skipNear.z - layerZ) < 1e-4;

  if (!skipFirstSample) {
    points.push({
      x: startFrame.x,
      y: startFrame.y,
      z: layerZ,
      feedRate,
    });
  }

  for (let i = 1; i <= uniformSteps; i++) {
    const delta = (i / uniformSteps) * cutLength;
    const s = forward
      ? advanceGuideArcLength(guide, startS, delta, true)
      : advanceGuideArcLength(guide, startS, delta, false);
    const frame = sampleGuideAtS(guide, s);
    points.push({ x: frame.x, y: frame.y, z: layerZ, feedRate });
  }

  return points;
}

/** Walk along the contour between two XY points at constant Z (no straight chord). */
export function sampleContourTravelBetween(
  traverse: LoopPoint[],
  from: { x: number; y: number },
  to: { x: number; y: number },
  z: number,
  feedRate: number,
  sampleSpacing: number,
  forward = true
): ToolpathPoint[] {
  const guide = buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  const total = guide.totalLength;
  if (total <= 0) return [];

  const fromS = findClosestSOnGuide(guide, from).s;
  const toS = findClosestSOnGuide(guide, to).s;
  const toFrame = sampleGuideAtS(guide, toS);

  if (Math.hypot(from.x - toFrame.x, from.y - toFrame.y) < sampleSpacing * 0.75) {
    return [];
  }

  let arcLen = forward
    ? toS >= fromS - 1e-6
      ? toS - fromS
      : total - fromS + toS
    : fromS >= toS - 1e-6
      ? fromS - toS
      : fromS + total - toS;

  if (arcLen < 1e-3) return [];

  const steps = Math.max(1, Math.ceil(arcLen / sampleSpacing));
  const points: ToolpathPoint[] = [];

  for (let i = 1; i <= steps; i++) {
    const dist = (i / steps) * arcLen;
    const s = advanceGuideArcLength(guide, fromS, dist, forward);
    const frame = sampleGuideAtS(guide, s);
    points.push({ x: frame.x, y: frame.y, z, feedRate });
  }

  return points;
}

/**
 * Forward/backward linear ramp along a closed contour until target Z is reached.
 * Ends on the contour where the ramp finishes — not snapped back to the start station.
 */
export function generateContourLinearRamp(
  traverse: LoopPoint[],
  startPoint: { x: number; y: number },
  fromZ: number,
  toZ: number,
  rampLengthMm: number,
  rampAngleDeg: number,
  feedRate: number | undefined,
  sampleSpacing: number,
  traverseForward = true
): ContourRampResult {
  if (Math.abs(fromZ - toZ) < 1e-5) {
    const s = findClosestSOnGuide(
      buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25)),
      startPoint
    ).s;
    return {
      points: [{ x: startPoint.x, y: startPoint.y, z: toZ, feedRate }],
      endPoint: { x: startPoint.x, y: startPoint.y },
      endS: s,
    };
  }

  const guide = buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  if (guide.totalLength <= 0) {
    return {
      points: [{ x: startPoint.x, y: startPoint.y, z: toZ, feedRate }],
      endPoint: { x: startPoint.x, y: startPoint.y },
      endS: 0,
    };
  }

  const startS = findClosestSOnGuide(guide, startPoint).s;
  const angleRad = (Math.max(rampAngleDeg, 0.5) * Math.PI) / 180;
  const dzPerLeg = rampLengthMm * Math.tan(angleRad);
  if (dzPerLeg < 1e-6) {
    return {
      points: [{ x: startPoint.x, y: startPoint.y, z: toZ, feedRate }],
      endPoint: { x: startPoint.x, y: startPoint.y },
      endS: startS,
    };
  }

  const points: ToolpathPoint[] = [];
  let currentZ = fromZ;
  let currentS = startS;
  let forward = traverseForward;
  let iterations = 0;
  const maxIterations = 5000;

  while (currentZ > toZ + 1e-5 && iterations < maxIterations) {
    const legDz = Math.min(dzPerLeg, currentZ - toZ);
    const legLen = legDz / Math.tan(angleRad);
    const legEndZ = currentZ - legDz;
    const steps = Math.max(1, Math.ceil(legLen / sampleSpacing));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const dist = t * legLen;
      const s = advanceGuideArcLength(guide, currentS, dist, forward);
      const frame = sampleGuideAtS(guide, s);
      points.push({
        x: frame.x,
        y: frame.y,
        z: currentZ - legDz * t,
        feedRate,
      });
      iterations++;
    }

    currentZ = legEndZ;
    currentS = advanceGuideArcLength(guide, currentS, legLen, forward);

    if (currentZ <= toZ + 1e-5) break;
    forward = !forward;
  }

  const endFrame = sampleGuideAtS(guide, currentS);
  const endPoint = { x: endFrame.x, y: endFrame.y };
  const last = points[points.length - 1];
  if (
    !last ||
    Math.hypot(last.x - endPoint.x, last.y - endPoint.y) > 1e-4 ||
    Math.abs(last.z - toZ) > 1e-4
  ) {
    points.push({ x: endPoint.x, y: endPoint.y, z: toZ, feedRate });
  }

  return { points, endPoint, endS: currentS };
}

/**
 * Zigzag linear ramp along an open polyline until target Z is reached.
 * Reverses at polyline ends — used for first-layer entry-path ramping.
 */
export function generateOpenPolylineLinearRamp(
  polyline: LoopPoint[],
  fromZ: number,
  toZ: number,
  rampLengthMm: number,
  rampAngleDeg: number,
  feedRate: number | undefined,
  sampleSpacing: number
): ContourRampResult {
  if (polyline.length < 2 || Math.abs(fromZ - toZ) < 1e-5) {
    const end = polyline[polyline.length - 1] ?? polyline[0] ?? { x: 0, y: 0 };
    return {
      points: [{ x: end.x, y: end.y, z: toZ, feedRate }],
      endPoint: { x: end.x, y: end.y },
      endS: 0,
    };
  }

  const guide = buildOpenArcLengthGuide(polyline, Math.max(sampleSpacing, 0.25), true);
  const total = guide.totalLength;
  if (total <= 0) {
    const end = polyline[polyline.length - 1];
    return {
      points: [{ x: end.x, y: end.y, z: toZ, feedRate }],
      endPoint: { x: end.x, y: end.y },
      endS: 0,
    };
  }

  const angleRad = (Math.max(rampAngleDeg, 0.5) * Math.PI) / 180;
  const dzPerLeg = rampLengthMm * Math.tan(angleRad);
  if (dzPerLeg < 1e-6) {
    const end = polyline[polyline.length - 1];
    return {
      points: [{ x: end.x, y: end.y, z: toZ, feedRate }],
      endPoint: { x: end.x, y: end.y },
      endS: total,
    };
  }

  const points: ToolpathPoint[] = [];
  const startFrame = sampleOpenGuideAtS(guide, 0);
  points.push({ x: startFrame.x, y: startFrame.y, z: fromZ, feedRate });

  let currentZ = fromZ;
  let currentS = 0;
  let forward = true;
  let iterations = 0;
  const maxIterations = 5000;

  while (currentZ > toZ + 1e-5 && iterations < maxIterations) {
    const remaining = forward ? total - currentS : currentS;
    if (remaining < 1e-6) {
      forward = !forward;
      iterations++;
      continue;
    }

    const legDz = Math.min(dzPerLeg, currentZ - toZ);
    let legLen = legDz / Math.tan(angleRad);
    legLen = Math.min(legLen, remaining);
    if (legLen < 1e-6) {
      forward = !forward;
      iterations++;
      continue;
    }

    const legEndZ = currentZ - legDz;
    const steps = Math.max(1, Math.ceil(legLen / sampleSpacing));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const dist = t * legLen;
      const s = forward ? currentS + dist : currentS - dist;
      const frame = sampleOpenGuideAtS(guide, s);
      points.push({
        x: frame.x,
        y: frame.y,
        z: currentZ - legDz * t,
        feedRate,
      });
      iterations++;
    }

    currentZ = legEndZ;
    currentS = forward ? currentS + legLen : currentS - legLen;

    if (currentZ <= toZ + 1e-5) break;
    forward = !forward;
    iterations++;
  }

  const endFrame = sampleOpenGuideAtS(guide, currentS);
  const endPoint = { x: endFrame.x, y: endFrame.y };
  const last = points[points.length - 1];
  if (
    !last ||
    Math.hypot(last.x - endPoint.x, last.y - endPoint.y) > 1e-4 ||
    Math.abs(last.z - toZ) > 1e-4
  ) {
    points.push({ x: endPoint.x, y: endPoint.y, z: toZ, feedRate });
  }

  return { points, endPoint, endS: currentS };
}
