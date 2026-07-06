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
  buildSplineEntryGuide,
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
  const toolLoop = offsetLoop2DMinkowski(partLoop, offset, maxSegmentLen);
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

export function buildStandardSplineLeadIn(
  layout: StandardEntryLayout,
  z: number,
  sampleSpacing: number
): ToolpathPoint[] {
  const spline = buildSplineEntryGuide(
    layout.toolStart,
    layout.contourJoin,
    layout.traverseTangent,
    sampleSpacing,
    z
  );
  return spline.map((p) => ({ x: p.x, y: p.y, z }));
}

export function standardSplineLeadInFeed(
  layout: StandardEntryLayout,
  z: number,
  feedRate: number,
  sampleSpacing: number,
  skipNear?: { x: number; y: number; z: number },
  toolStartOverride?: { x: number; y: number }
): ToolpathPoint[] {
  const start = toolStartOverride ?? layout.toolStart;
  const spline = buildSplineEntryGuide(
    start,
    layout.contourJoin,
    layout.traverseTangent,
    sampleSpacing,
    z
  );
  const pts = spline.map((p) => ({ x: p.x, y: p.y, z, feedRate }));
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

export interface ContourRampResult {
  points: ToolpathPoint[];
  endPoint: { x: number; y: number };
  endS: number;
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

function vertexInteriorAngleDeg(traverse: LoopPoint[], index: number): number {
  const n = traverse.length;
  if (n < 3) return 180;
  const prev = traverse[(index - 1 + n) % n];
  const curr = traverse[index];
  const next = traverse[(index + 1) % n];
  const v1x = prev.x - curr.x;
  const v1y = prev.y - curr.y;
  const v2x = next.x - curr.x;
  const v2y = next.y - curr.y;
  const len1 = Math.hypot(v1x, v1y) || 1;
  const len2 = Math.hypot(v2x, v2y) || 1;
  const dot = (v1x / len1) * (v2x / len2) + (v1y / len1) * (v2y / len2);
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

/** Anchor only sharp polyline vertices (interior miters + arc joins), not dense arc samples. */
function collectSharpCornerStations(
  guide: ArcLengthGuide,
  traverse: LoopPoint[],
  startS: number,
  cutLength: number,
  forward: boolean
): number[] {
  const total = guide.totalLength;
  if (total <= 0 || traverse.length < 3) return [];

  const seen = new Set<number>();
  const anchors: number[] = [];

  for (let i = 0; i < traverse.length; i++) {
    if (vertexInteriorAngleDeg(traverse, i) > 165) continue;
    const s = findClosestSOnGuide(guide, traverse[i]).s;
    const key = Math.round(s * 1000);
    if (seen.has(key)) continue;
    const delta = guideArcLengthBetween(total, startS, s, forward);
    if (delta > 1e-4 && delta <= cutLength + 1e-4) {
      seen.add(key);
      anchors.push(s);
    }
  }

  return anchors;
}

function mergeLoopSampleStations(
  guide: ArcLengthGuide,
  startS: number,
  cutLength: number,
  forward: boolean,
  uniformSteps: number,
  anchorStations: number[]
): number[] {
  const total = guide.totalLength;
  const seen = new Set<number>();
  const ordered: { delta: number; s: number }[] = [];

  const pushStation = (s: number) => {
    const delta = guideArcLengthBetween(total, startS, s, forward);
    if (delta <= 1e-6 || delta > cutLength + 1e-4) return;
    const key = Math.round(delta * 1000);
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({ delta, s });
  };

  for (let i = 1; i <= uniformSteps; i++) {
    const delta = (i / uniformSteps) * cutLength;
    const s = forward
      ? advanceGuideArcLength(guide, startS, delta, true)
      : advanceGuideArcLength(guide, startS, delta, false);
    pushStation(s);
  }

  for (const s of anchorStations) {
    pushStation(s);
  }

  ordered.sort((a, b) => a.delta - b.delta);
  return ordered.map((entry) => entry.s);
}

/** One contour loop sampled by arc length, starting at startS for up to arcLengthToCut. */
export function sampleContourLoopFromArcS(
  traverse: LoopPoint[],
  layerZ: number,
  feedRate: number,
  startS: number,
  sampleSpacing: number,
  forward = true,
  skipNear?: { x: number; y: number; z: number },
  arcLengthToCut?: number,
  cachedGuide?: ArcLengthGuide
): ToolpathPoint[] {
  const guide = cachedGuide ?? buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25));
  const total = guide.totalLength;
  if (total <= 0) return [];

  const cutLength = Math.min(Math.max(arcLengthToCut ?? total, 0), total);
  if (cutLength <= 1e-6) return [];

  const uniformSteps = Math.max(8, Math.ceil(cutLength / sampleSpacing));
  const anchorStations = collectSharpCornerStations(
    guide,
    traverse,
    startS,
    cutLength,
    forward
  );
  const sampleStations = mergeLoopSampleStations(
    guide,
    startS,
    cutLength,
    forward,
    uniformSteps,
    anchorStations
  );

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

  for (const s of sampleStations) {
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
  let currentZ = fromZ;
  let currentS = 0;
  let forward = true;
  let iterations = 0;
  const maxIterations = 5000;

  while (currentZ > toZ + 1e-5 && iterations < maxIterations) {
    const legDz = Math.min(dzPerLeg, currentZ - toZ);
    let legLen = legDz / Math.tan(angleRad);
    const remaining = forward ? total - currentS : currentS;
    legLen = Math.min(legLen, Math.max(remaining, 0));
    if (legLen < 1e-6) {
      forward = !forward;
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
    if (forward && currentS >= total - 1e-5) forward = false;
    else if (!forward && currentS <= 1e-5) forward = true;
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
