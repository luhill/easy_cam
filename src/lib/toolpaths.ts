import type { Operation, ToolpathPoint, ToolpathSegment } from '../types/operations';
import type { ToolOrigin } from './geometryProcessing';
import { prependToolOriginApproach } from './toolOriginProgram';
import type { LoopPoint } from '../types/operations';
import { DEFAULT_SETTINGS } from '../types/operations';
import type { PartBounds } from './geometryProcessing';
import {
  closestPointOnLoop2D,
  offsetLoop2DMinkowski,
  pointInPolygon2D,
  signedLoopArea2D,
} from './geometryProcessing';
import { OPERATION_COLORS, getSelectedEdgeLoops, getSelectedHoles, normalizeOperation } from '../types/operations';
import { clampOperationSettings } from './settingLimits';
import {
  buildSlotCenterGuideWithCornerSpurs,
  mapSpurRangesToArcGuide,
  buildGuideRadiusSampler,
} from './cornerSpurs';
import { resolveAdaptiveSlotGeometry, cornerSpurOptionsForRoughing, finishingStockAllowance } from './adaptiveOutline';
import {
  generateContourLinearRamp,
  generateStandardLeadInLayerRamp,
  outlineApproachWorldZ,
  outlineRampLengthMm,
  resolveStandardEntryLayout,
  resolveStandardHelixEntryLayout,
  resolveStandardHelixLayerBoreCenter,
  sampleContourLoopFromArcS,
  standardEntryNeedsLeadIn,
  standardSplineLeadInFeed,
  standardSplineTailFromPoint,
  stationOnContour,
  buildStandardHelixSplineLeadIn,
  DEFAULT_OUTLINE_OFFSET_CONTEXT,
  resolveSignedOutlineOffset,
  type OutlineOffsetContext,
} from './outlineEntry';
import {
  adaptiveEntryOverridesFromGeometry,
  resolveAdaptiveEntryLayout,
} from './adaptiveEntryLayout';
import {
  generateFourZoneAdaptivePath,
  generateContinuousEntryTrochoidPath,
  resolveGuideTraverseSign,
  resolveOrbitRotSign,
  trochoidOrbitAngleAtPhase,
} from './adaptiveFourZone';
import {
  buildSplineEntryGuide,
  adjustBoreRadiusToSlotWidth,
  generateBoreAlignOrbit,
  generateBoreBottomToLeadInTransition,
  generateFullRevolutionOrbit,
  generateHelixBorePoints,
  helixRadiusAtZ,
  helixRadiusTaperedFromStart,
  interiorHelixRadiusAtZ,
  resolveHelixRadius,
  resolveHelixRotationDir,
  resolveInteriorHelixRadius,
  resolveInteriorHelixRotationDir,
  resolveSlotHelixRadius,
} from './entryPath';
import {
  adaptiveForwardIncrement,
  buildArcLengthGuide,
  findClosestSOnGuide,
  sampleGuideAtS,
  type ArcLengthGuide,
} from './trochoidalPath';
import {
  createCutZContext,
  cutLayersWorldZ,
  cutLayersWorldZForExtent,
  defaultOutlineCutExtent,
  finalCutWorldZ,
  finalCutWorldZForExtent,
  outlineCutExtentFromLoopZ,
  stockTopWorldZ,
  type CutZContext,
  type OutlineCutExtent,
} from './cutDepth';
import {
  helixHoleInvalidLabel,
  validateHelixHole,
} from './helixValidation';
import {
  helixSegmentsPerRev,
  minkowskiSegmentLen,
  pathSampleSpacing,
  safeHeightWorldZ,
  trochoidSampleSpacing,
  type ToolpathGlobalOptions,
  DEFAULT_SAFE_HEIGHT,
  DEFAULT_TOOLPATH_RESOLUTION,
  DEFAULT_TRAVEL_FEED_RATE,
} from './toolpathConfig';
import {
  adjustedCuttingFeedMmMin,
  stepoverMmFromPercent,
} from './feedsSpeedsCalculator';
import { offsetClosedLoop2D } from './polygonOffset';
export const MAX_TOOLPATH_POINTS = 500_000;

export interface ToolpathGenerationResult {
  segments: ToolpathSegment[];
  warnings: string[];
}

let activePointBudget: { discarded: number } | null = null;

/** Spread-append chunk size — avoids call-stack overflow on large toolpaths. */
const APPEND_POINTS_CHUNK = 8192;

function appendPointsChunked(
  target: ToolpathPoint[],
  points: ToolpathPoint[],
  count: number
): void {
  for (let i = 0; i < count; i += APPEND_POINTS_CHUNK) {
    const end = Math.min(i + APPEND_POINTS_CHUNK, count);
    target.push(...points.slice(i, end));
  }
}

function toolRadius(settings: Operation['settings']): number {
  return Math.max(settings.toolDiameter, 0.1) / 2;
}

/** Full-engagement contour feed (standard outline loops). */
function baseCutFeed(settings: Operation['settings']): number {
  return Math.max(1, settings.feedRate);
}

/** Chip-thinned feed for adaptive trochoidal clearing. */
function adaptiveCutFeed(settings: Operation['settings']): number {
  const stepoverMm = stepoverMmFromPercent(settings.toolDiameter, settings.stepover);
  return Math.round(
    adjustedCuttingFeedMmMin(baseCutFeed(settings), settings.toolDiameter, stepoverMm)
  );
}

/** Chip-thinned feed for finish / light radial engagement. */
function finishCutFeed(settings: Operation['settings']): number {
  const pct = Math.max(settings.finishingStockPercent ?? 7, 0.5);
  const engagementMm = Math.max(settings.toolDiameter * (pct / 100), 0.05);
  return Math.round(
    adjustedCuttingFeedMmMin(baseCutFeed(settings), settings.toolDiameter, engagementMm)
  );
}

/** Reduced feed used while easing into the finish contour. */
function finishEaseFeed(settings: Operation['settings']): number {
  const finish = finishCutFeed(settings);
  return Math.max(1, Math.min(settings.plungeRate, Math.round(finish * 0.4)));
}

function getBounds(geometry: Operation['geometry']): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  if (geometry?.loops && geometry.loops.length > 0) {
    const loop = geometry.loops[0];
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

  const holes = getSelectedHoles(geometry);
  if (holes.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const hole of holes) {
      minX = Math.min(minX, hole.center.x - hole.radius);
      maxX = Math.max(maxX, hole.center.x + hole.radius);
      minY = Math.min(minY, hole.center.y - hole.radius);
      maxY = Math.max(maxY, hole.center.y + hole.radius);
    }
    return { minX, maxX, minY, maxY };
  }

  if (geometry?.faceIndices && geometry.faceIndices.length > 0) {
    return { minX: -25, maxX: 25, minY: -25, maxY: 25 };
  }

  return { minX: -25, maxX: 25, minY: -25, maxY: 25 };
}

interface OutlinePathJob {
  loop: LoopPoint[];
  extent: OutlineCutExtent;
  offsetContext: OutlineOffsetContext;
}

function resolveOutlinePathJobs(
  geometry: Operation['geometry'] | null | undefined,
  ctx: CutZContext
): OutlinePathJob[] {
  const edgeLoops = getSelectedEdgeLoops(geometry);
  if (edgeLoops.length > 0) {
    return edgeLoops
      .filter((el) => el.loop.length >= 2)
      .map((el) => ({
        loop: el.loop,
        extent: outlineCutExtentFromLoopZ(el.topZ, el.bottomZ),
        offsetContext: {
          offsetSign: el.offsetSign ?? 1,
          wallSide: el.wallSide ?? 'exterior',
        },
      }));
  }

  if (geometry?.loops?.[0] && geometry.loops[0].length >= 2) {
    return [
      {
        loop: geometry.loops[0],
        extent: defaultOutlineCutExtent(ctx),
        offsetContext: DEFAULT_OUTLINE_OFFSET_CONTEXT,
      },
    ];
  }

  return [];
}

function hasRegionGeometry(geometry: Operation['geometry'] | null | undefined): boolean {
  return (geometry?.faceIndices?.length ?? 0) > 0;
}

function appendPoints(target: ToolpathPoint[], points: ToolpathPoint[]): boolean {
  const room = MAX_TOOLPATH_POINTS - target.length;
  if (room <= 0) {
    if (activePointBudget) activePointBudget.discarded += points.length;
    return false;
  }
  if (points.length <= room) {
    appendPointsChunked(target, points, points.length);
    return true;
  }
  appendPointsChunked(target, points, room);
  if (activePointBudget) activePointBudget.discarded += points.length - room;
  return false;
}

function contourTraverse(
  loop: LoopPoint[],
  settings: Operation['settings'],
  extraRadialStock = 0,
  resolution = DEFAULT_TOOLPATH_RESOLUTION,
  offsetContext: OutlineOffsetContext = DEFAULT_OUTLINE_OFFSET_CONTEXT
): LoopPoint[] {
  const offset = resolveSignedOutlineOffset(
    loop,
    toolRadius(settings) + (settings.radialOffset ?? 0) + extraRadialStock,
    offsetContext
  );
  const toolLoop = offsetLoop2DMinkowski(loop, offset, minkowskiSegmentLen(resolution), offsetContext.wallSide);
  const ccw = signedLoopArea2D(loop) >= 0;
  const reverse = settings.climbMilling ? ccw : !ccw;
  return reverse ? [...toolLoop].reverse() : toolLoop;
}

function appendContourLoopFromArcS(
  points: ToolpathPoint[],
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
): boolean {
  const skip = skipNear ?? lastPathPoint(points) ?? undefined;
  const loopPts = sampleContourLoopFromArcS(
    traverse,
    layerZ,
    feedRate,
    startS,
    sampleSpacing,
    forward,
    skip,
    arcLengthToCut,
    cachedGuide,
    loopAnchor
  );
  return appendPoints(points, loopPts);
}

function appendOutlineApproachToStart(
  points: ToolpathPoint[],
  entryStart: { x: number; y: number },
  safeZ: number,
  approachZ: number,
  plungeRate: number
): void {
  points.push({ x: entryStart.x, y: entryStart.y, z: safeZ, rapid: true });
  if (approachZ < safeZ - 1e-4) {
    points.push({
      x: entryStart.x,
      y: entryStart.y,
      z: approachZ,
      feedRate: plungeRate,
    });
  }
}

function appendStraightOutlineEntry(
  points: ToolpathPoint[],
  entryStart: { x: number; y: number },
  fromZ: number,
  layerZ: number,
  plungeRate: number,
  atEntryStart: boolean
): boolean {
  if (!atEntryStart) {
    return true;
  }
  if (Math.abs(fromZ - layerZ) < 1e-5) {
    return appendPoints(points, [{ x: entryStart.x, y: entryStart.y, z: layerZ, feedRate: plungeRate }]);
  }
  const last = lastPathPoint(points);
  if (
    !last ||
    Math.hypot(last.x - entryStart.x, last.y - entryStart.y) > 0.05 ||
    Math.abs(last.z - fromZ) > 1e-4
  ) {
    if (
      !appendPoints(points, [{ x: entryStart.x, y: entryStart.y, z: fromZ, feedRate: plungeRate }])
    ) {
      return false;
    }
  }
  return appendPoints(points, [
    { x: entryStart.x, y: entryStart.y, z: layerZ, feedRate: plungeRate },
  ]);
}

function generateStandardHelixOutlinePath(
  loop: LoopPoint[],
  settings: Operation['settings'],
  ctx: CutZContext,
  globals: ToolpathGlobalOptions,
  geometry: Operation['geometry'] | null,
  extent: OutlineCutExtent,
  offsetContext: OutlineOffsetContext = DEFAULT_OUTLINE_OFFSET_CONTEXT
): ToolpathPoint[] {
  const topZ = extent.cutTopZ;
  const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
  const layers = cutLayersWorldZForExtent(extent, settings.depthOffset, settings.stepDown);
  const points: ToolpathPoint[] = [];

  if (loop.length === 0 || layers.length === 0) return points;

  const stockAllowance = finishingStockAllowance(settings);
  const entryLayout = resolveStandardHelixEntryLayout(
    loop,
    settings,
    stockAllowance,
    geometry,
    globals.toolOrigin
  );
  if (!entryLayout) {
    return generateStandardOutlinePath(loop, settings, ctx, globals, geometry, 'straight', extent);
  }

  const { toolStart, joinPoint, layout } = entryLayout;
  const { traverse, arcGuide } = layout;
  if (traverse.length === 0) return points;
  const approachZ = outlineApproachWorldZ(topZ, globals.safeHeight, settings.zStartOffset);
  const helixR = resolveHelixRadius(settings);
  const helixOpts = { stockTopZ: topZ, globals };
  const plungeFeed = settings.plungeRate;
  const cutFeed = settings.feedRate;
  const rotDir = resolveHelixRotationDir(settings.climbMilling);
  const segmentsPerRev = helixSegmentsPerRev(globals.resolution);
  const stepoverIncrement = adaptiveForwardIncrement(settings.toolDiameter, settings.stepover);
  const sampleSpacing = pathSampleSpacing(globals.resolution);

  appendOutlineApproachToStart(points, toolStart, safeZ, approachZ, plungeFeed);

  let boreHelixAngle = 0;
  const boreStartZ = approachZ;

  for (let li = 0; li < layers.length; li++) {
    const layerZ = layers[li];
    const layerPrevZ = li > 0 ? layers[li - 1] : boreStartZ;

    if (li === 0) {
      const initialBore = generateHelixBorePoints(toolStart, settings, boreStartZ, layerZ, {
        ...helixOpts,
        taper: true,
        startAngle: boreHelixAngle,
        rotDir,
        feedRate: plungeFeed,
      });
      if (!appendPoints(points, initialBore.points)) break;
      boreHelixAngle = initialBore.endAngle;

      const bottomHelixR = helixRadiusAtZ(settings, layerZ, topZ);
      const needsBottomWiden =
        settings.boreTaperAngleDeg > 0 && bottomHelixR + 1e-3 < helixR;

      const splineLeadIn = buildStandardHelixSplineLeadIn(
        layout,
        layerZ,
        sampleSpacing,
        toolStart
      ).map((p) => ({ ...p, feedRate: cutFeed }));

      if (needsBottomWiden) {
        const firstLeadIn = splineLeadIn[0] ?? {
          x: toolStart.x,
          y: toolStart.y,
          z: layerZ,
          feedRate: cutFeed,
        };
        if (
          !appendBoreBottomWidenAndLeadIn(
            points,
            toolStart,
            layerZ,
            helixR,
            bottomHelixR,
            stepoverIncrement,
            rotDir,
            segmentsPerRev,
            plungeFeed,
            firstLeadIn
          )
        ) {
          break;
        }
        const tail = skipDuplicateLeadInPoint(points, splineLeadIn, sampleSpacing);
        if (!appendPoints(points, tail)) break;
      } else if (
        Math.hypot(toolStart.x - joinPoint.x, toolStart.y - joinPoint.y) > 0.5
      ) {
        appendRadialToBoreCenter(points, toolStart, cutFeed);
        const leadIn = skipDuplicateLeadInPoint(points, splineLeadIn, sampleSpacing);
        if (!appendPoints(points, leadIn)) break;
      }
    } else {
      const layerBoreCenter = resolveStandardHelixLayerBoreCenter(
        loop,
        joinPoint,
        settings,
        stockAllowance,
        geometry
      );
      appendFreshSlotWidthBore(
        points,
        layerBoreCenter,
        layerPrevZ,
        layerZ,
        helixR,
        settings,
        helixOpts
      );

      const layerSplineLeadIn = buildStandardHelixSplineLeadIn(
        layout,
        layerZ,
        sampleSpacing,
        layerBoreCenter
      ).map((p) => ({ ...p, feedRate: cutFeed }));
      const layerFirstLeadIn = layerSplineLeadIn[0] ?? {
        x: layerBoreCenter.x,
        y: layerBoreCenter.y,
        z: layerZ,
        feedRate: cutFeed,
      };
      if (
        !appendBoreBottomWidenAndLeadIn(
          points,
          layerBoreCenter,
          layerZ,
          helixR,
          helixRadiusTaperedFromStart(settings, layerZ, layerPrevZ, helixR),
          stepoverIncrement,
          rotDir,
          segmentsPerRev,
          plungeFeed,
          layerFirstLeadIn
        )
      ) {
        break;
      }
      const layerTail = skipDuplicateLeadInPoint(points, layerSplineLeadIn, sampleSpacing);
      if (!appendPoints(points, layerTail)) break;
    }

    const loopStartS = layout.contourJoinS;
    if (
      !appendContourLoopFromArcS(
        points,
        traverse,
        layerZ,
        cutFeed,
        loopStartS,
        sampleSpacing,
        layout.guideTraverseSign >= 0,
        lastPathPoint(points) ?? undefined,
        arcGuide.totalLength,
        arcGuide,
        joinPoint
      )
    ) {
      break;
    }
  }

  if (settings.finishingPass) {
    const finishZ = layers[layers.length - 1];
    appendConnectedFinishingPass(
      points,
      loop,
      settings,
      finishZ,
      safeZ,
      globals,
      undefined,
      offsetContext
    );
  } else {
    appendStraightRetractToSafe(points, safeZ);
  }

  return points;
}

function generateStandardOutlinePath(
  loop: LoopPoint[],
  settings: Operation['settings'],
  ctx: CutZContext,
  globals: ToolpathGlobalOptions,
  geometry: Operation['geometry'] | null = null,
  entryTypeOverride?: Operation['settings']['outlineEntryType'],
  extent?: OutlineCutExtent,
  offsetContext: OutlineOffsetContext = DEFAULT_OUTLINE_OFFSET_CONTEXT
): ToolpathPoint[] {
  const cutExtent = extent ?? defaultOutlineCutExtent(ctx);
  const entryType = entryTypeOverride ?? settings.outlineEntryType ?? 'linear';

  if (entryType === 'helix') {
    return generateStandardHelixOutlinePath(
      loop,
      settings,
      ctx,
      globals,
      geometry,
      cutExtent,
      offsetContext
    );
  }

  const topZ = cutExtent.cutTopZ;
  const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
  const layers = cutLayersWorldZForExtent(cutExtent, settings.depthOffset, settings.stepDown);
  const points: ToolpathPoint[] = [];

  if (loop.length === 0 || layers.length === 0) return points;

  const stockAllowance = finishingStockAllowance(settings);
  const rampSampleSpacing = pathSampleSpacing(globals.resolution);
  const rampLength = outlineRampLengthMm(settings);
  const segLen = minkowskiSegmentLen(globals.resolution);

  const layout = resolveStandardEntryLayout(
    loop,
    settings,
    stockAllowance,
    geometry,
    rampSampleSpacing,
    segLen,
    globals.toolOrigin
  );
  if (!layout) return points;

  const { toolStart, contourJoin, traverse, arcGuide, guideTraverseSign } = layout;
  const traverseLength = arcGuide.totalLength;
  const needsLeadIn = standardEntryNeedsLeadIn(layout);
  const approachZ = outlineApproachWorldZ(topZ, globals.safeHeight, settings.zStartOffset);
  const climbForward = guideTraverseSign >= 0;

  appendOutlineApproachToStart(points, toolStart, safeZ, approachZ, settings.plungeRate);

  for (let li = 0; li < layers.length; li++) {
    const layerZ = layers[li];
    const fromZ = li === 0 ? approachZ : layers[li - 1];
    const lastBeforeLayer = lastPathPoint(points);
    let loopStartS = layout.contourJoinS;
    let loopAnchor: { x: number; y: number } = contourJoin;
    let loopSkipNear: { x: number; y: number; z: number } | undefined;

    if (entryType === 'straight') {
      const plungeAt = li === 0 ? toolStart : (lastBeforeLayer ?? toolStart);
      if (
        !appendStraightOutlineEntry(
          points,
          plungeAt,
          fromZ,
          layerZ,
          settings.plungeRate,
          true
        )
      ) {
        break;
      }
      if (needsLeadIn && li === 0) {
        const leadIn = standardSplineLeadInFeed(
          layout,
          layerZ,
          settings.feedRate,
          rampSampleSpacing,
          lastPathPoint(points) ?? undefined
        );
        if (!appendPoints(points, leadIn)) break;
        loopAnchor = contourJoin;
        loopStartS = layout.contourJoinS;
      } else {
        const at = lastPathPoint(points) ?? plungeAt;
        loopAnchor = { x: at.x, y: at.y };
        loopStartS = findClosestSOnGuide(arcGuide, loopAnchor).s;
      }
      loopSkipNear = lastPathPoint(points) ?? undefined;
    } else {
      const rampStart =
        li === 0
          ? needsLeadIn
            ? toolStart
            : contourJoin
          : lastBeforeLayer ?? contourJoin;

      let ramp: ReturnType<typeof generateContourLinearRamp>;
      if (li === 0 && needsLeadIn) {
        const leadInRamp = generateStandardLeadInLayerRamp(
          layout,
          traverse,
          fromZ,
          layerZ,
          rampLength,
          settings.rampAngleDeg,
          settings.plungeRate,
          rampSampleSpacing,
          climbForward
        );
        if (!appendPoints(points, leadInRamp.points)) break;

        if (leadInRamp.needsSplineTail) {
          const splineTail = standardSplineTailFromPoint(
            layout,
            layerZ,
            settings.feedRate,
            leadInRamp.endPoint,
            rampSampleSpacing
          );
          if (!appendPoints(points, splineTail)) break;
        }

        loopAnchor = contourJoin;
        loopStartS = layout.contourJoinS;
      } else {
        ramp = generateContourLinearRamp(
          traverse,
          rampStart,
          fromZ,
          layerZ,
          rampLength,
          settings.rampAngleDeg,
          settings.plungeRate,
          rampSampleSpacing,
          climbForward
        );
        if (!appendPoints(points, ramp.points)) break;
        loopAnchor = ramp.endPoint;
        loopStartS = findClosestSOnGuide(arcGuide, ramp.endPoint).s;
      }

      loopSkipNear = lastPathPoint(points) ?? undefined;
    }

    if (
      !appendContourLoopFromArcS(
        points,
        traverse,
        layerZ,
        settings.feedRate,
        loopStartS,
        rampSampleSpacing,
        climbForward,
        loopSkipNear,
        traverseLength,
        arcGuide,
        loopAnchor
      )
    ) {
      break;
    }
  }

  if (settings.finishingPass) {
    const finishZ = layers[layers.length - 1];
    appendConnectedFinishingPass(points, loop, settings, finishZ, safeZ, globals, undefined, offsetContext);
  } else {
    appendStraightRetractToSafe(points, safeZ);
  }

  return points;
}

function generateOutlinePath(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
): ToolpathPoint[] {
  const { settings, geometry } = op;
  const jobs = resolveOutlinePathJobs(geometry, ctx);
  if (jobs.length === 0) return [];

  const points: ToolpathPoint[] = [];
  for (const job of jobs) {
    const path = settings.adaptiveMode
      ? generateAdaptiveOutlinePath(
          op,
          ctx,
          globals,
          job.loop,
          job.extent,
          job.offsetContext
        )
      : generateStandardOutlinePath(
          job.loop,
          settings,
          ctx,
          globals,
          geometry,
          undefined,
          job.extent,
          job.offsetContext
        );
    if (!appendPoints(points, path)) break;
  }

  return points;
}

function trochoidParams(
  partLoop: LoopPoint[],
  settings: Operation['settings'],
  slotCenterGuide: LoopPoint[],
  z: number,
  roughing: boolean,
  globals: ToolpathGlobalOptions,
  cutFeedRate?: number,
  offsetContext: OutlineOffsetContext = DEFAULT_OUTLINE_OFFSET_CONTEXT
) {
  const slot = resolveAdaptiveSlotGeometry(settings, { roughing });
  const guideSign = resolveGuideTraverseSign(
    slotCenterGuide,
    settings.climbMilling,
    offsetContext.wallSide
  );
  return {
    forwardIncrement: slot.forwardIncrement,
    slotClearance: slot.slotClearance,
    z,
    liftAmount: Math.max(settings.liftAmount ?? 0, 0),
    partLoop,
    minCenterDist: slot.minCenterDist,
    rotSign: resolveOrbitRotSign(slotCenterGuide, settings.climbMilling),
    guideSign,
    feedRate: cutFeedRate ?? adaptiveCutFeed(settings),
    travelFeedRate: globals.travelFeedRate,
    sampleSpacing: trochoidSampleSpacing(
      slot.forwardIncrement,
      slot.trochoidRadius,
      globals.resolution
    ),
    orbitStepsPerRev: helixSegmentsPerRev(globals.resolution),
  };
}

function generateAdaptiveTrochoidalPath(
  partLoop: LoopPoint[],
  settings: Operation['settings'],
  z: number,
  globals: ToolpathGlobalOptions,
  roughing = true,
  startS?: number,
  skipArcLength?: number,
  omitFirstOrbitSample?: boolean,
  offsetContext: OutlineOffsetContext = DEFAULT_OUTLINE_OFFSET_CONTEXT
): ToolpathPoint[] {
  const roughSlot = resolveAdaptiveSlotGeometry(settings, { roughing });
  const finishSlot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
  const segLen = minkowskiSegmentLen(globals.resolution);
  const sampleSpacing = trochoidSampleSpacing(
    roughSlot.forwardIncrement,
    roughSlot.trochoidRadius,
    globals.resolution
  );
  const { guide: slotCenterGuide, spurMarkers } = buildSlotCenterGuideWithCornerSpurs(
    partLoop,
    roughSlot.slotCenterOffset,
    finishSlot.innerCenterOffset,
    segLen,
    cornerSpurOptionsForRoughing(settings),
    offsetContext.offsetSign,
    offsetContext.wallSide
  );
  const { arcGuide, spurRanges } = mapSpurRangesToArcGuide(
    slotCenterGuide,
    spurMarkers,
    sampleSpacing,
    { trochoidR: roughSlot.trochoidRadius, resolution: globals.resolution }
  );
  return generateFourZoneAdaptivePath(
    slotCenterGuide,
    {
      ...trochoidParams(
        partLoop,
        settings,
        slotCenterGuide,
        z,
        roughing,
        globals,
        undefined,
        offsetContext
      ),
      startS,
      skipArcLength,
      omitFirstOrbitSample,
      arcGuide,
      trochoidRAtGuide:
        spurRanges.length > 0
          ? buildGuideRadiusSampler(
              roughSlot.trochoidRadius,
              arcGuide.totalLength,
              spurRanges
            )
          : undefined,
    },
    spurRanges
  );
}

function appendGeneratedPath(
  target: ToolpathPoint[],
  generated: ToolpathPoint[]
): boolean {
  if (generated.length === 0) return true;
  const last = target[target.length - 1];
  const first = generated[0];
  const dist = last ? Math.hypot(first.x - last.x, first.y - last.y) : Infinity;
  const sameZ = last ? Math.abs((first.z ?? 0) - (last.z ?? 0)) < 1e-4 : false;
  const start = last && dist < 0.02 && sameZ ? 1 : 0;
  return appendPoints(target, generated.slice(start));
}

function appendStraightRetractToSafe(
  points: ToolpathPoint[],
  safeZ: number
): void {
  const last = lastPathPoint(points);
  if (!last) return;
  if (Math.abs(last.z - safeZ) > 1e-4) {
    points.push({ x: last.x, y: last.y, z: safeZ, rapid: true });
  }
}

function finishContourPointFromToolPosition(
  partLoop: LoopPoint[],
  settings: Operation['settings'],
  toolPos: { x: number; y: number }
): { x: number; y: number } {
  const offsetMag = toolRadius(settings) + (settings.radialOffset ?? 0);
  const onPart = closestPointOnLoop2D(toolPos.x, toolPos.y, partLoop);
  return {
    x: onPart.x + onPart.outX * offsetMag,
    y: onPart.y + onPart.outY * offsetMag,
  };
}

function appendConnectedFinishingPass(
  points: ToolpathPoint[],
  partLoop: LoopPoint[],
  settings: Operation['settings'],
  finishZ: number,
  safeZ: number,
  globals: ToolpathGlobalOptions,
  finishPath?: ToolpathPoint[],
  offsetContext: OutlineOffsetContext = DEFAULT_OUTLINE_OFFSET_CONTEXT
): boolean {
  const sampleSpacing = pathSampleSpacing(globals.resolution);
  const stockAllowance = finishingStockAllowance(settings);
  const passCount = Math.max(1, Math.round(settings.finishPassCount ?? 1));
  const cutFeed = finishCutFeed(settings);
  const easeFeed = finishEaseFeed(settings);
  const easeLength = Math.max(settings.toolDiameter * 1.25, 2);
  const chipClear = settings.chipClearBeforeFinal !== false;

  for (let pass = 0; pass < passCount; pass++) {
    const isFinal = pass === passCount - 1;
    const extraStock =
      passCount === 1 ? 0 : stockAllowance * ((passCount - 1 - pass) / passCount);

    if (chipClear && isFinal && passCount >= 1) {
      appendStraightRetractToSafe(points, safeZ);
      const last = lastPathPoint(points);
      if (last && Math.abs(last.z - finishZ) > 1e-4) {
        points.push({ x: last.x, y: last.y, z: finishZ, feedRate: settings.plungeRate });
      }
    }

    const finishPts =
      isFinal && finishPath && finishPath.length > 0
        ? finishPath.map((p) => ({ ...p, z: finishZ, feedRate: cutFeed }))
        : contourTraverse(partLoop, settings, extraStock, globals.resolution, offsetContext).map(
            (p) => ({
              x: p.x,
              y: p.y,
              z: finishZ,
              feedRate: cutFeed,
            })
          );

    if (finishPts.length === 0) continue;

    const last = lastPathPoint(points);
    if (last) {
      const traverse = finishPts.map((p) => ({ x: p.x, y: p.y, z: finishZ }));
      const finishEntry = finishContourPointFromToolPosition(partLoop, settings, last);

      // Ease into the wall: approach from outside stock, then radial feed at ease rate.
      const onPart = closestPointOnLoop2D(finishEntry.x, finishEntry.y, partLoop);
      const easeOut = Math.max(stockAllowance * 0.65, settings.toolDiameter * 0.15, 0.3);
      const easeStart = {
        x: finishEntry.x + onPart.outX * easeOut,
        y: finishEntry.y + onPart.outY * easeOut,
      };

      if (Math.hypot(last.x - easeStart.x, last.y - easeStart.y) > 0.05) {
        if (
          !appendPoints(points, [
            { x: easeStart.x, y: easeStart.y, z: finishZ, feedRate: easeFeed },
          ])
        ) {
          return false;
        }
      }
      if (Math.hypot(easeStart.x - finishEntry.x, easeStart.y - finishEntry.y) > 0.05) {
        if (
          !appendPoints(points, [
            { x: finishEntry.x, y: finishEntry.y, z: finishZ, feedRate: easeFeed },
          ])
        ) {
          return false;
        }
      }

      const loopAnchor = { x: finishEntry.x, y: finishEntry.y };
      const startS = stationOnContour(traverse, finishEntry, sampleSpacing);
      const finishTraverseLength = buildArcLengthGuide(traverse, Math.max(sampleSpacing, 0.25))
        .totalLength;

      // First easeLength mm at ease feed, then full finish feed for the remainder.
      const easeArc = Math.min(easeLength, finishTraverseLength * 0.35);
      if (easeArc > sampleSpacing) {
        if (
          !appendContourLoopFromArcS(
            points,
            traverse,
            finishZ,
            easeFeed,
            startS,
            sampleSpacing,
            true,
            lastPathPoint(points) ?? undefined,
            easeArc,
            undefined,
            loopAnchor
          )
        ) {
          return false;
        }
        const afterEase = lastPathPoint(points);
        const resumeS = afterEase
          ? stationOnContour(traverse, afterEase, sampleSpacing)
          : startS + easeArc;
        if (
          !appendContourLoopFromArcS(
            points,
            traverse,
            finishZ,
            cutFeed,
            resumeS,
            sampleSpacing,
            true,
            lastPathPoint(points) ?? undefined,
            Math.max(finishTraverseLength - easeArc, sampleSpacing),
            undefined,
            loopAnchor
          )
        ) {
          return false;
        }
      } else if (
        !appendContourLoopFromArcS(
          points,
          traverse,
          finishZ,
          cutFeed,
          startS,
          sampleSpacing,
          true,
          lastPathPoint(points) ?? undefined,
          finishTraverseLength,
          undefined,
          loopAnchor
        )
      ) {
        return false;
      }
    } else if (!appendPoints(points, finishPts)) {
      return false;
    }

    const endAt = lastPathPoint(points);
    if (endAt && isFinal) {
      if (stockAllowance > 1e-4) {
        const onPart = closestPointOnLoop2D(endAt.x, endAt.y, partLoop);
        if (
          !appendPoints(points, [
            {
              x: endAt.x + onPart.outX * stockAllowance,
              y: endAt.y + onPart.outY * stockAllowance,
              z: finishZ,
              feedRate: cutFeed,
            },
          ])
        ) {
          return false;
        }
      }
      const retractFrom = lastPathPoint(points) ?? endAt;
      points.push({ x: retractFrom.x, y: retractFrom.y, z: safeZ, rapid: true });
    }
  }

  return true;
}

function sampleFinishPoint(
  partLoop: LoopPoint[],
  finishSlot: ReturnType<typeof resolveAdaptiveSlotGeometry>,
  roughSlot: ReturnType<typeof resolveAdaptiveSlotGeometry>,
  roughCenterGuide: LoopPoint[],
  x: number,
  y: number,
  layerZ: number
): ToolpathPoint {
  const finishTarget = finishSlot.minCenterDist;
  let atFinish = closestPointOnLoop2D(x, y, partLoop);

  if (roughCenterGuide.length >= 3) {
    const onRoughGuide = closestPointOnLoop2D(x, y, roughCenterGuide);
    const partAtGuide = closestPointOnLoop2D(onRoughGuide.x, onRoughGuide.y, partLoop);
    const roughEnvelope = partAtGuide.dist - roughSlot.trochoidRadius;
    if (roughEnvelope < finishTarget - 0.02 && atFinish.dist < roughEnvelope - 0.02) {
      x = partAtGuide.x + partAtGuide.outX * roughEnvelope;
      y = partAtGuide.y + partAtGuide.outY * roughEnvelope;
      atFinish = closestPointOnLoop2D(x, y, partLoop);
    }
  }

  if (atFinish.dist < finishTarget - 0.02) {
    x = atFinish.x + atFinish.outX * finishTarget;
    y = atFinish.y + atFinish.outY * finishTarget;
  }

  return { x, y, z: layerZ };
}

function generateFinishingOutline(
  partLoop: LoopPoint[],
  settings: Operation['settings'],
  layerZ: number,
  globals: ToolpathGlobalOptions,
  offsetContext: OutlineOffsetContext = DEFAULT_OUTLINE_OFFSET_CONTEXT
): ToolpathPoint[] {
  const roughSlot = resolveAdaptiveSlotGeometry(settings, { roughing: true });
  const finishSlot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
  const segLen = minkowskiSegmentLen(globals.resolution);
  const finishGuide = offsetLoop2DMinkowski(
    partLoop,
    resolveSignedOutlineOffset(partLoop, finishSlot.innerCenterOffset, offsetContext),
    segLen,
    offsetContext.wallSide
  );
  const { guide: roughCenterGuide } = buildSlotCenterGuideWithCornerSpurs(
    partLoop,
    roughSlot.slotCenterOffset,
    finishSlot.innerCenterOffset,
    segLen,
    cornerSpurOptionsForRoughing(settings),
    offsetContext.offsetSign,
    offsetContext.wallSide
  );
  if (finishGuide.length < 3) return [];

  const ccw = signedLoopArea2D(finishGuide) >= 0;
  const reverse = settings.climbMilling ? ccw : !ccw;
  const traverse = reverse ? [...finishGuide].reverse() : finishGuide;

  const pts: ToolpathPoint[] = [];
  for (const p of traverse) {
    pts.push(
      sampleFinishPoint(
        partLoop,
        finishSlot,
        roughSlot,
        roughCenterGuide,
        p.x,
        p.y,
        layerZ
      )
    );
  }

  if (pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-3) {
      pts.push({ x: first.x, y: first.y, z: layerZ });
    }
  }
  return pts;
}

function appendFreshSlotWidthBore(
  target: ToolpathPoint[],
  boreCenter: { x: number; y: number },
  startZ: number,
  targetZ: number,
  slotHelixR: number,
  settings: Operation['settings'],
  helixOpts: { stockTopZ: number; globals: ToolpathGlobalOptions }
): void {
  const travelFeed = helixOpts.globals.travelFeedRate;
  const last = lastPathPoint(target);
  const startAngle = 0;
  const boreStartX = boreCenter.x + Math.cos(startAngle) * slotHelixR;
  const boreStartY = boreCenter.y + Math.sin(startAngle) * slotHelixR;

  let at = last;
  if (at) {
    if (Math.abs(at.z - startZ) > 1e-4) {
      target.push({ x: at.x, y: at.y, z: startZ, feedRate: travelFeed });
      at = { x: at.x, y: at.y, z: startZ };
    }
    if (Math.hypot(at.x - boreStartX, at.y - boreStartY) > 0.12) {
      target.push({ x: boreStartX, y: boreStartY, z: startZ, feedRate: travelFeed });
    }
  }

  const bore = generateHelixBorePoints(boreCenter, settings, startZ, targetZ, {
    ...helixOpts,
    taper: true,
    helixR: slotHelixR,
    taperFromStart: true,
    startAngle,
    rotDir: resolveHelixRotationDir(settings.climbMilling),
    feedRate: settings.plungeRate,
  });
  appendPoints(target, bore.points);
}

function appendBoreBottomWidenAndLeadIn(
  target: ToolpathPoint[],
  boreCenter: { x: number; y: number },
  layerZ: number,
  slotHelixR: number,
  bottomHelixR: number,
  stepoverIncrement: number,
  rotDir: number,
  segmentsPerRev: number,
  plungeFeed: number,
  firstLeadIn: ToolpathPoint
): boolean {
  const boreBottom = lastPathPoint(target);
  if (!boreBottom) return true;

  let boreStartAngle = Math.atan2(
    boreBottom.y - boreCenter.y,
    boreBottom.x - boreCenter.x
  );
  const needsWiden = bottomHelixR + 1e-3 < slotHelixR;

  if (needsWiden) {
    if (
      !appendPoints(
        target,
        adjustBoreRadiusToSlotWidth(
          boreCenter,
          bottomHelixR,
          slotHelixR,
          layerZ,
          stepoverIncrement,
          rotDir,
          segmentsPerRev,
          boreStartAngle,
          plungeFeed
        )
      )
    ) {
      return false;
    }

    const afterWiden = lastPathPoint(target) ?? boreBottom;
    boreStartAngle = Math.atan2(
      afterWiden.y - boreCenter.y,
      afterWiden.x - boreCenter.x
    );

    const fullRev = generateFullRevolutionOrbit(
      boreCenter,
      slotHelixR,
      layerZ,
      boreStartAngle,
      rotDir,
      segmentsPerRev,
      plungeFeed
    );
    if (!appendPoints(target, fullRev.points)) return false;
    boreStartAngle = fullRev.endAngle;
  }

  const afterRadius = lastPathPoint(target) ?? boreBottom;
  return appendPoints(
    target,
    generateBoreBottomToLeadInTransition(
      boreCenter,
      afterRadius,
      firstLeadIn,
      layerZ,
      stepoverIncrement,
      rotDir,
      segmentsPerRev,
      plungeFeed
    )
  );
}

function appendBoreWidenAlignToTrochoidEntry(
  target: ToolpathPoint[],
  boreCenter: { x: number; y: number },
  layerZ: number,
  slotHelixR: number,
  bottomHelixR: number,
  stepoverIncrement: number,
  rotDir: number,
  segmentsPerRev: number,
  plungeFeed: number,
  orbitRotSign: number
): boolean {
  const boreBottom = lastPathPoint(target);
  if (!boreBottom) return true;

  let boreStartAngle = Math.atan2(
    boreBottom.y - boreCenter.y,
    boreBottom.x - boreCenter.x
  );
  const needsWiden = bottomHelixR + 1e-3 < slotHelixR;

  if (needsWiden) {
    if (
      !appendPoints(
        target,
        adjustBoreRadiusToSlotWidth(
          boreCenter,
          bottomHelixR,
          slotHelixR,
          layerZ,
          stepoverIncrement,
          rotDir,
          segmentsPerRev,
          boreStartAngle,
          plungeFeed
        )
      )
    ) {
      return false;
    }

    const afterWiden = lastPathPoint(target) ?? boreBottom;
    boreStartAngle = Math.atan2(
      afterWiden.y - boreCenter.y,
      afterWiden.x - boreCenter.x
    );

    const fullRev = generateFullRevolutionOrbit(
      boreCenter,
      slotHelixR,
      layerZ,
      boreStartAngle,
      rotDir,
      segmentsPerRev,
      plungeFeed
    );
    if (!appendPoints(target, fullRev.points)) return false;
    boreStartAngle = fullRev.endAngle;
  }

  const targetAngle = trochoidOrbitAngleAtPhase(0, orbitRotSign);
  return appendPoints(
    target,
    generateBoreAlignOrbit(
      boreCenter,
      slotHelixR,
      layerZ,
      boreStartAngle,
      targetAngle,
      rotDir,
      segmentsPerRev,
      plungeFeed
    )
  );
}

function appendRetractViaSlotCenter(
  points: ToolpathPoint[],
  slotCenter: { x: number; y: number },
  clearanceZ: number,
  travelFeedRate: number
): void {
  const last = lastPathPoint(points);
  if (!last) return;

  if (Math.hypot(last.x - slotCenter.x, last.y - slotCenter.y) > 0.12) {
    points.push({ x: slotCenter.x, y: slotCenter.y, z: last.z, feedRate: travelFeedRate });
  }
  points.push({ x: slotCenter.x, y: slotCenter.y, z: clearanceZ, feedRate: travelFeedRate });
}


function helixStartWorldZ(
  topZ: number,
  safeHeight: number,
  zStartOffset: number
): number {
  return outlineApproachWorldZ(topZ, safeHeight, zStartOffset);
}

function buildInterOperationTravel(
  from: ToolpathPoint,
  to: ToolpathPoint
): ToolpathPoint[] {
  const xySpan = Math.hypot(from.x - to.x, from.y - to.y);
  const zSpan = Math.abs(from.z - to.z);
  if (xySpan < 0.05 && zSpan < 0.05) return [];

  const travelZ = Math.max(from.z, to.z);
  const points: ToolpathPoint[] = [{ ...from, rapid: true }];

  if (xySpan >= 0.05) {
    if (Math.abs(from.z - travelZ) > 0.05) {
      points.push({ x: from.x, y: from.y, z: travelZ, rapid: true });
    }
    points.push({ x: to.x, y: to.y, z: travelZ, rapid: true });
  }

  if (Math.abs(to.z - travelZ) > 0.05) {
    points.push({ x: to.x, y: to.y, z: to.z, rapid: true });
  }

  return points;
}

function lastPathPoint(points: ToolpathPoint[]): { x: number; y: number; z: number } | null {
  if (points.length === 0) return null;
  const p = points[points.length - 1];
  return { x: p.x, y: p.y, z: p.z };
}

function appendRadialToBoreCenter(
  points: ToolpathPoint[],
  boreCenter: { x: number; y: number },
  feedRate: number
): void {
  const last = lastPathPoint(points);
  if (!last) return;
  if (Math.hypot(last.x - boreCenter.x, last.y - boreCenter.y) < 0.12) return;
  points.push({ x: boreCenter.x, y: boreCenter.y, z: last.z, feedRate });
}

function skipDuplicateLeadInPoint(
  points: ToolpathPoint[],
  leadIn: ToolpathPoint[],
  sampleSpacing: number
): ToolpathPoint[] {
  const last = lastPathPoint(points);
  if (
    !last ||
    leadIn.length === 0 ||
    Math.hypot(last.x - leadIn[0].x, last.y - leadIn[0].y) >= sampleSpacing * 0.75
  ) {
    return leadIn;
  }
  return leadIn.slice(1);
}

function generateAdaptiveOutlinePath(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions,
  loopOverride?: LoopPoint[],
  extent?: OutlineCutExtent,
  offsetContext: OutlineOffsetContext = DEFAULT_OUTLINE_OFFSET_CONTEXT
): ToolpathPoint[] {
  const { settings, geometry } = op;
  const loop = loopOverride ?? geometry?.loops?.[0];

  if (!loop) {
    return [];
  }

  const cutExtent = extent ?? defaultOutlineCutExtent(ctx);
  const topZ = cutExtent.cutTopZ;
  const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
  const layers = cutLayersWorldZForExtent(cutExtent, settings.depthOffset, settings.stepDown);
  const finalZ = finalCutWorldZForExtent(cutExtent, settings.depthOffset);

  const roughSlot = resolveAdaptiveSlotGeometry(settings, { roughing: true });
  const segLen = minkowskiSegmentLen(globals.resolution);
  const trochSampleSpacing = trochoidSampleSpacing(
    roughSlot.forwardIncrement,
    roughSlot.trochoidRadius,
    globals.resolution
  );

  const entryLayout = resolveAdaptiveEntryLayout(
    loop,
    settings,
    adaptiveEntryOverridesFromGeometry(geometry),
    segLen,
    trochSampleSpacing,
    globals.resolution,
    globals.toolOrigin,
    offsetContext
  );
  if (!entryLayout) {
    return generateStandardOutlinePath(
      loop,
      settings,
      ctx,
      globals,
      geometry,
      undefined,
      cutExtent,
      offsetContext
    );
  }

  const toolStart = entryLayout.toolStart;
  const trochoidStartS = entryLayout.trochoidStartS;
  const slotCenterGuide = entryLayout.slotCenterGuide;
  const trochArcGuide = entryLayout.trochArcGuide;
  const slotHelixR = resolveSlotHelixRadius(roughSlot.slotClearance);
  const helixOpts = { stockTopZ: topZ, globals };
  const cutFeed = adaptiveCutFeed(settings);
  const plungeFeed = settings.plungeRate;
  const travelFeed = globals.travelFeedRate;
  const points: ToolpathPoint[] = [];
  const approachZ = outlineApproachWorldZ(topZ, globals.safeHeight, settings.zStartOffset);

  points.push({ x: toolStart.x, y: toolStart.y, z: safeZ, rapid: true });
  if (approachZ < safeZ - 1e-4) {
    points.push({ x: toolStart.x, y: toolStart.y, z: approachZ, feedRate: plungeFeed });
  }

  const helixTarget = layers.length > 0 ? layers[0] : finalZ;
  let boreHelixAngle = 0;

  const initialBore = generateHelixBorePoints(toolStart, settings, approachZ, helixTarget, {
    ...helixOpts,
    taper: true,
    startAngle: boreHelixAngle,
    rotDir: resolveHelixRotationDir(settings.climbMilling),
    feedRate: plungeFeed,
  });
  appendPoints(points, initialBore.points);
  boreHelixAngle = initialBore.endAngle;

  const stepoverIncrement = adaptiveForwardIncrement(settings.toolDiameter, settings.stepover);
  const segmentsPerRev = helixSegmentsPerRev(globals.resolution);
  const rotDir = resolveHelixRotationDir(settings.climbMilling);
  const slotJoinCenter = sampleGuideAtS(trochArcGuide, trochoidStartS);
  const spurRadiusSampler =
    entryLayout.cornerSpurRanges.length > 0
      ? buildGuideRadiusSampler(
          roughSlot.trochoidRadius,
          trochArcGuide.totalLength,
          entryLayout.cornerSpurRanges
        )
      : undefined;

  for (let li = 0; li < layers.length; li++) {
    const layerZ = layers[li];
    const prevZ = li > 0 ? layers[li - 1] : helixTarget;

    if (li === 0 && Math.abs(layerZ - helixTarget) > 1e-4) {
      const layerBore = generateHelixBorePoints(toolStart, settings, helixTarget, layerZ, {
        ...helixOpts,
        taper: true,
        startAngle: boreHelixAngle,
        rotDir: resolveHelixRotationDir(settings.climbMilling),
        feedRate: plungeFeed,
      });
      if (!appendPoints(points, layerBore.points)) {
        break;
      }
      boreHelixAngle = layerBore.endAngle;
    }

    if (li === 0) {
      const splineGuide = buildSplineEntryGuide(
        toolStart,
        entryLayout.slotJoin,
        entryLayout.traverseTangent,
        trochSampleSpacing,
        layerZ
      );
      const layerTroch = generateContinuousEntryTrochoidPath(
        splineGuide,
        trochArcGuide,
        trochoidStartS,
        entryLayout.guideTraverseSign,
        {
          ...trochoidParams(loop, settings, slotCenterGuide, layerZ, true, globals, cutFeed),
          z: layerZ,
          arcGuide: trochArcGuide,
          trochoidRAtGuide: spurRadiusSampler,
          omitFirstOrbitSample: true,
        },
        slotCenterGuide,
        entryLayout.cornerSpurRanges
      );

      if (layerTroch.length === 0) continue;

      if (
        !appendBoreWidenAlignToTrochoidEntry(
          points,
          toolStart,
          layerZ,
          slotHelixR,
          helixRadiusAtZ(settings, layerZ, topZ),
          stepoverIncrement,
          rotDir,
          segmentsPerRev,
          plungeFeed,
          resolveOrbitRotSign(slotCenterGuide, settings.climbMilling)
        )
      ) {
        break;
      }
      if (!appendGeneratedPath(points, layerTroch)) break;
      continue;
    }

    const slotBoreCenter = { x: slotJoinCenter.x, y: slotJoinCenter.y };
    appendFreshSlotWidthBore(
      points,
      slotBoreCenter,
      prevZ,
      layerZ,
      slotHelixR,
      settings,
      helixOpts
    );

    const layerTroch = generateAdaptiveTrochoidalPath(
      loop,
      settings,
      layerZ,
      globals,
      true,
      trochoidStartS,
      0,
      true,
      offsetContext
    );

    if (layerTroch.length === 0) continue;

    if (
      !appendBoreWidenAlignToTrochoidEntry(
        points,
        slotBoreCenter,
        layerZ,
        slotHelixR,
        helixRadiusTaperedFromStart(settings, layerZ, prevZ, slotHelixR),
        stepoverIncrement,
        rotDir,
        segmentsPerRev,
        plungeFeed,
        resolveOrbitRotSign(slotCenterGuide, settings.climbMilling)
      )
    ) {
      break;
    }
    if (!appendGeneratedPath(points, layerTroch)) break;
  }

  if (settings.finishingPass) {
    const finishZ = layers.length > 0 ? layers[layers.length - 1] : finalZ;
    const finishPath = generateFinishingOutline(loop, settings, finishZ, globals, offsetContext);
    if (
      finishPath.length === 0 ||
      !appendConnectedFinishingPass(
        points,
        loop,
        settings,
        finishZ,
        safeZ,
        globals,
        finishPath,
        offsetContext
      )
    ) {
      appendRetractViaSlotCenter(points, slotJoinCenter, safeZ, travelFeed);
      return points;
    }
    return points;
  }

  appendRetractViaSlotCenter(points, slotJoinCenter, safeZ, travelFeed);
  return points;
}

function generateDrillPathForHole(
  cx: number,
  cy: number,
  settings: Operation['settings'],
  ctx: CutZContext,
  safeZ: number,
  holeTopZ?: number,
  holeBottomZ?: number
): ToolpathPoint[] {
  const stockTop = stockTopWorldZ(ctx);
  const topZ =
    holeTopZ !== undefined && Number.isFinite(holeTopZ) ? holeTopZ : stockTop;
  const extent =
    holeBottomZ !== undefined && Number.isFinite(holeBottomZ)
      ? outlineCutExtentFromLoopZ(topZ, holeBottomZ)
      : defaultOutlineCutExtent(ctx);
  // When using stock extent, still start pecks from hole opening if known.
  const cutExtent =
    holeBottomZ !== undefined && Number.isFinite(holeBottomZ)
      ? extent
      : { ...defaultOutlineCutExtent(ctx), cutTopZ: topZ, cutHeight: topZ - defaultOutlineCutExtent(ctx).cutBottomZ };

  const layers = cutLayersWorldZForExtent(cutExtent, settings.depthOffset, settings.stepDown);
  const plungeFeed = Math.max(1, settings.plungeRate);
  const chipClearH = Math.max(0, settings.chipClearHeight ?? 2);
  const chipClearZ = topZ + chipClearH;
  const fullEvery = Math.max(0, Math.round(settings.peckFullRetractEvery ?? 0));
  const points: ToolpathPoint[] = [];

  points.push({ x: cx, y: cy, z: safeZ, rapid: true });
  points.push({ x: cx, y: cy, z: Math.min(safeZ, Math.max(chipClearZ, topZ)), feedRate: plungeFeed });

  for (let i = 0; i < layers.length; i++) {
    const layerZ = layers[i];
    points.push({ x: cx, y: cy, z: layerZ, feedRate: plungeFeed });

    const isLast = i === layers.length - 1;
    const forceFull = fullEvery > 0 && (i + 1) % fullEvery === 0;
    if (isLast || forceFull || chipClearH <= 1e-6) {
      points.push({ x: cx, y: cy, z: safeZ, rapid: true });
    } else {
      const retractZ = Math.min(safeZ, Math.max(chipClearZ, layerZ + 0.1));
      points.push({ x: cx, y: cy, z: retractZ, rapid: true });
    }
  }

  return points;
}

function generateDrillPath(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
): ToolpathPoint[] {
  const { settings, geometry } = op;
  const holes = getSelectedHoles(geometry);
  if (holes.length === 0) return [];

  const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
  const points: ToolpathPoint[] = [];

  holes.forEach((hole) => {
    appendPoints(
      points,
      generateDrillPathForHole(
        hole.center.x,
        hole.center.y,
        settings,
        ctx,
        safeZ,
        hole.topZ,
        hole.bottomZ
      )
    );
  });

  const last = holes[holes.length - 1];
  points.push({ x: last.center.x, y: last.center.y, z: safeZ, rapid: true });
  return points;
}

function generateHelixPathForHole(
  cx: number,
  cy: number,
  holeR: number,
  settings: Operation['settings'],
  ctx: CutZContext,
  safeZ: number,
  globals: ToolpathGlobalOptions
): ToolpathPoint[] {
  const topZ = stockTopWorldZ(ctx);
  const targetZ = finalCutWorldZ(ctx, settings.depthOffset);
  const toolR = toolRadius(settings);
  const cutR = resolveInteriorHelixRadius(holeR, toolR, settings.radialOffset ?? 0);
  const useTaper = settings.boreTaperAngleDeg > 0;
  const plungeFeed = settings.plungeRate;
  const rotDir = resolveInteriorHelixRotationDir(settings.climbMilling);
  const segmentsPerRev = helixSegmentsPerRev(globals.resolution);
  const radialStepPerRev = settings.toolDiameter * (settings.stepover / 100);
  const helixStartZ = helixStartWorldZ(topZ, globals.safeHeight, settings.zStartOffset);
  const entryX = cx + cutR;
  const entryY = cy;
  const center = { x: cx, y: cy };
  const helixOpts = {
    stockTopZ: topZ,
    globals,
    taper: useTaper,
    interiorCutR: cutR,
    rotDir,
    feedRate: plungeFeed,
  };
  const points: ToolpathPoint[] = [];

  points.push({ x: entryX, y: entryY, z: safeZ, rapid: true });
  if (helixStartZ < safeZ - 1e-4) {
    points.push({ x: entryX, y: entryY, z: helixStartZ, feedRate: plungeFeed });
  }

  if (targetZ < helixStartZ - 1e-4) {
    const helixBore = generateHelixBorePoints(center, settings, helixStartZ, targetZ, helixOpts);
    appendPoints(points, helixBore.points);
    let finishAngle = helixBore.endAngle;
    let finishR = interiorHelixRadiusAtZ(cutR, targetZ, topZ, settings.boreTaperAngleDeg);

    if (useTaper) {
      const bottomR = finishR;
      if (bottomR + 1e-3 < cutR) {
        const spiralPoints = adjustBoreRadiusToSlotWidth(
          center,
          bottomR,
          cutR,
          targetZ,
          radialStepPerRev,
          rotDir,
          segmentsPerRev,
          finishAngle,
          plungeFeed
        );
        appendPoints(points, spiralPoints);
        finishR = cutR;
        const spiralEnd = lastPathPoint(spiralPoints);
        if (spiralEnd) {
          finishAngle = Math.atan2(spiralEnd.y - cy, spiralEnd.x - cx);
        }
      }
    }

    const finishOrbit = generateFullRevolutionOrbit(
      center,
      finishR,
      targetZ,
      finishAngle,
      rotDir,
      segmentsPerRev,
      plungeFeed
    );
    appendPoints(points, finishOrbit.points);
  }

  appendRetractViaSlotCenter(points, center, safeZ, globals.travelFeedRate);
  return points;
}

function generateHelixPath(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions,
  warnings: string[] = []
): ToolpathPoint[] {
  const { settings, geometry } = op;
  const holes = getSelectedHoles(geometry);
  if (holes.length === 0) return [];

  const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
  const points: ToolpathPoint[] = [];

  holes.forEach((hole) => {
    const validation = validateHelixHole(hole.radius, settings, ctx);
    if (!validation.valid) {
      warnings.push(
        `Helix skipped hole at (${hole.center.x.toFixed(1)}, ${hole.center.y.toFixed(1)}): ${helixHoleInvalidLabel(validation.reason!)}`
      );
      return;
    }

    appendPoints(
      points,
      generateHelixPathForHole(
        hole.center.x,
        hole.center.y,
        hole.radius,
        settings,
        ctx,
        safeZ,
        globals
      )
    );
  });

  return points;
}

function largestLoop(loops: LoopPoint[][]): LoopPoint[] | null {
  let best: LoopPoint[] | null = null;
  let bestArea = -1;
  for (const loop of loops) {
    if (loop.length < 3) continue;
    const area = Math.abs(signedLoopArea2D(loop));
    if (area > bestArea) {
      bestArea = area;
      best = loop;
    }
  }
  return best;
}

function loopCentroid2D(loop: LoopPoint[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of loop) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(loop.length, 1);
  return { x: x / n, y: y / n };
}

function orientLoopCcw(loop: LoopPoint[]): LoopPoint[] {
  return signedLoopArea2D(loop) >= 0 ? loop.map((p) => ({ ...p })) : [...loop].reverse().map((p) => ({ ...p }));
}

/** Zigzag hatch lines clipped to a pocket polygon (point-in-polygon sampling). */
function zigzagFillLoop(
  boundary: LoopPoint[],
  stepover: number,
  z: number,
  feedRate: number
): ToolpathPoint[] {
  if (boundary.length < 3 || stepover <= 1e-4) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of boundary) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const points: ToolpathPoint[] = [];
  let y = minY;
  let direction = 1;
  const sampleDx = Math.max(stepover * 0.25, 0.25);

  while (y <= maxY + 1e-6) {
    const xs: number[] = [];
    for (let x = minX; x <= maxX + 1e-6; x += sampleDx) {
      if (pointInPolygon2D(x, y, boundary)) xs.push(x);
    }
    if (xs.length >= 2) {
      const xStart = direction === 1 ? xs[0] : xs[xs.length - 1];
      const xEnd = direction === 1 ? xs[xs.length - 1] : xs[0];
      points.push({ x: xStart, y, z, feedRate });
      points.push({ x: xEnd, y, z, feedRate });
      direction *= -1;
    }
    y += stepover;
  }

  return points;
}

/** Concentric offset loops for adaptive pocket clearing (outside → inside). */
function concentricPocketLoops(
  outer: LoopPoint[],
  toolR: number,
  stepover: number,
  radialExtra: number,
  maxLoops = 80
): LoopPoint[][] {
  const loops: LoopPoint[][] = [];
  // Inset first by tool radius (+ finish stock) so tool stays inside the pocket.
  let current = offsetClosedLoop2D(orientLoopCcw(outer), -(toolR + radialExtra), {
    maxSegmentLen: Math.max(toolR * 0.4, 0.5),
  });
  if (current.length < 3) return loops;

  for (let i = 0; i < maxLoops; i++) {
    if (current.length < 3) break;
    const area = Math.abs(signedLoopArea2D(current));
    if (area < toolR * toolR * 0.5) break;
    loops.push(current);
    const next = offsetClosedLoop2D(current, -stepover, {
      maxSegmentLen: Math.max(stepover * 0.5, 0.5),
    });
    if (next.length < 3) break;
    if (Math.abs(signedLoopArea2D(next)) >= area * 0.98) break;
    current = next;
  }
  return loops;
}

function appendClosedLoopCut(
  points: ToolpathPoint[],
  loop: LoopPoint[],
  z: number,
  feedRate: number,
  climb: boolean
): boolean {
  if (loop.length < 3) return true;
  const ccw = signedLoopArea2D(loop) >= 0;
  const traverse = climb === ccw ? [...loop].reverse() : loop;
  const pts: ToolpathPoint[] = traverse.map((p) => ({ x: p.x, y: p.y, z, feedRate }));
  const first = pts[0];
  pts.push({ x: first.x, y: first.y, z, feedRate });
  return appendPoints(points, pts);
}

function generatePocketPath(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
): ToolpathPoint[] {
  const { settings, geometry } = op;
  if (!hasRegionGeometry(geometry)) {
    return [];
  }

  const loops = geometry?.loops?.filter((l) => l.length >= 3) ?? [];
  const outer = largestLoop(loops);
  if (!outer) {
    // Fallback: AABB zigzag when loops are missing.
    const { minX, maxX, minY, maxY } = getBounds(geometry);
    const stepover = settings.toolDiameter * (settings.stepover / 100);
    const layers = cutLayersWorldZ(ctx, settings.depthOffset, settings.stepDown);
    const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
    const cutFeed = baseCutFeed(settings);
    const points: ToolpathPoint[] = [];
    points.push({ x: minX, y: minY, z: safeZ, rapid: true });
    for (const layerZ of layers) {
      points.push({ x: minX, y: minY, z: layerZ, feedRate: settings.plungeRate });
      let y = minY;
      let direction = 1;
      while (y <= maxY) {
        points.push({ x: direction === 1 ? maxX : minX, y, z: layerZ, feedRate: cutFeed });
        y += stepover;
        if (y <= maxY) {
          points.push({ x: direction === 1 ? maxX : minX, y, z: layerZ, feedRate: cutFeed });
        }
        direction *= -1;
      }
    }
    points.push({ x: minX, y: minY, z: safeZ, rapid: true });
    return points;
  }

  const toolR = toolRadius(settings);
  const stepover = Math.max(settings.toolDiameter * (settings.stepover / 100), 0.1);
  const stock = finishingStockAllowance(settings);
  const layers = cutLayersWorldZ(ctx, settings.depthOffset, settings.stepDown);
  const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
  const cutFeed = settings.adaptiveMode ? adaptiveCutFeed(settings) : baseCutFeed(settings);
  const finishFeed = finishCutFeed(settings);
  const points: ToolpathPoint[] = [];
  const entry = loopCentroid2D(outer);

  points.push({ x: entry.x, y: entry.y, z: safeZ, rapid: true });

  for (const layerZ of layers) {
    points.push({ x: entry.x, y: entry.y, z: layerZ, feedRate: settings.plungeRate });

    if (settings.adaptiveMode) {
      const concentric = concentricPocketLoops(outer, toolR, stepover, stock);
      for (const loop of concentric) {
        const start = loop[0];
        points.push({ x: start.x, y: start.y, z: layerZ, feedRate: cutFeed });
        if (!appendClosedLoopCut(points, loop, layerZ, cutFeed, settings.climbMilling)) {
          return points;
        }
      }
    } else {
      const inset = offsetClosedLoop2D(orientLoopCcw(outer), -(toolR + stock), {
        maxSegmentLen: Math.max(stepover * 0.5, 0.5),
      });
      if (inset.length >= 3) {
        const hatch = zigzagFillLoop(inset, stepover, layerZ, cutFeed);
        if (hatch.length > 0) {
          if (!appendPoints(points, hatch)) return points;
        }
      }
    }
  }

  if (settings.finishingPass && layers.length > 0) {
    const finishZ = layers[layers.length - 1];
    if (settings.chipClearBeforeFinal !== false) {
      appendStraightRetractToSafe(points, safeZ);
      points.push({ x: entry.x, y: entry.y, z: finishZ, feedRate: settings.plungeRate });
    }
    const wall = offsetClosedLoop2D(orientLoopCcw(outer), -toolR, {
      maxSegmentLen: Math.max(toolR * 0.35, 0.4),
    });
    if (wall.length >= 3) {
      const start = wall[0];
      points.push({ x: start.x, y: start.y, z: finishZ, feedRate: finishEaseFeed(settings) });
      appendClosedLoopCut(points, wall, finishZ, finishFeed, settings.climbMilling);
    }
  }

  const last = lastPathPoint(points);
  if (last) {
    points.push({ x: last.x, y: last.y, z: safeZ, rapid: true });
  }
  return points;
}

function generateContourPath(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
): ToolpathPoint[] {
  const { settings, geometry } = op;
  if (!hasRegionGeometry(geometry)) {
    return [];
  }

  const loops = geometry?.loops?.filter((l) => l.length >= 3) ?? [];
  const wallLoop = largestLoop(loops);
  const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
  const cutFeed = baseCutFeed(settings);
  const points: ToolpathPoint[] = [];

  if (!wallLoop) {
    // Fallback waterline along AABB diagonal (legacy stub replaced with layered lines).
    const { minX, maxX, minY, maxY } = getBounds(geometry);
    const layers = cutLayersWorldZ(ctx, settings.depthOffset, settings.stepDown);
    points.push({ x: minX, y: minY, z: safeZ, rapid: true });
    for (const layerZ of layers) {
      points.push({ x: minX, y: minY, z: layerZ, feedRate: settings.plungeRate });
      points.push({ x: maxX, y: maxY, z: layerZ, feedRate: cutFeed });
    }
    points.push({ x: maxX, y: maxY, z: safeZ, rapid: true });
    return points;
  }

  // Project wall boundary to XY and offset by tool radius for waterline contouring.
  const xyLoop = wallLoop.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const toolR = toolRadius(settings) + (settings.radialOffset ?? 0);
  const area = signedLoopArea2D(xyLoop);
  // Expand away from material: CCW walls expand outward (+), CW expand with −delta via offsetSign.
  const delta = area >= 0 ? toolR : -toolR;
  const toolCenter = offsetClosedLoop2D(xyLoop, delta, {
    maxSegmentLen: minkowskiSegmentLen(globals.resolution),
  });
  if (toolCenter.length < 3) return [];

  const layers = cutLayersWorldZ(ctx, settings.depthOffset, settings.stepDown);
  const start = toolCenter[0];
  points.push({ x: start.x, y: start.y, z: safeZ, rapid: true });

  for (let i = 0; i < layers.length; i++) {
    const layerZ = layers[i];
    if (i === 0) {
      points.push({ x: start.x, y: start.y, z: layerZ, feedRate: settings.plungeRate });
    } else {
      const last = lastPathPoint(points);
      if (last) {
        points.push({ x: last.x, y: last.y, z: layerZ, feedRate: settings.plungeRate });
      }
    }
    if (!appendClosedLoopCut(points, toolCenter, layerZ, cutFeed, settings.climbMilling)) {
      break;
    }
  }

  const end = lastPathPoint(points);
  if (end) {
    points.push({ x: end.x, y: end.y, z: safeZ, rapid: true });
  }
  return points;
}

function normalizedSettings(settings: Operation['settings']): Operation['settings'] {
  return clampOperationSettings({ ...DEFAULT_SETTINGS, ...settings });
}

function generatePathForOperation(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions,
  warnings: string[] = []
): ToolpathPoint[] {
  const normalizedOp = normalizeOperation(op);
  const settings = normalizedSettings(normalizedOp.settings);
  const operation = { ...normalizedOp, settings };

  switch (operation.type) {
    case 'outline':
    case 'adaptive-outline':
      return generateOutlinePath(operation, ctx, globals);
    case 'drill':
      return generateDrillPath(operation, ctx, globals);
    case 'helix':
      return generateHelixPath(operation, ctx, globals, warnings);
    case 'pocket':
      return generatePocketPath(operation, ctx, globals);
    case 'contour':
      return generateContourPath(operation, ctx, globals);
    case 'custom-gcode':
      return [];
    default:
      return [];
  }
}

export const INTER_OPERATION_TRAVEL_PREFIX = '__travel__';

export function generateToolpaths(
  operations: Operation[],
  partBounds: PartBounds | null = null,
  globals: ToolpathGlobalOptions = {
    safeHeight: DEFAULT_SAFE_HEIGHT,
    resolution: DEFAULT_TOOLPATH_RESOLUTION,
    travelFeedRate: DEFAULT_TRAVEL_FEED_RATE,
  }
): ToolpathGenerationResult {
  const ctx = createCutZContext(partBounds);
  const budget = { discarded: 0 };
  activePointBudget = budget;

  const enabledOps = operations.filter((op) => op.enabled);
  const segments: ToolpathSegment[] = [];
  const warnings: string[] = [];
  let prevLastPoint: ToolpathPoint | null = null;

  for (let i = 0; i < enabledOps.length; i++) {
    const op = enabledOps[i];
    const opWarnings: string[] = [];
    const points = generatePathForOperation(op, ctx, globals, opWarnings);
    warnings.push(...opWarnings);
    if (points.length === 0) continue;

    if (prevLastPoint) {
      const travelPoints = buildInterOperationTravel(prevLastPoint, points[0]);
      if (travelPoints.length >= 2) {
        segments.push({
          operationId: `${INTER_OPERATION_TRAVEL_PREFIX}${i}`,
          points: travelPoints,
          color: '#f59e0b',
        });
      }
    }

    segments.push({
      operationId: op.id,
      points,
      color: OPERATION_COLORS[op.type],
    });
    prevLastPoint = points[points.length - 1];
  }

  activePointBudget = null;

  if (budget.discarded > 0) {
    const totalPoints = segments.reduce((sum, seg) => sum + seg.points.length, 0);
    warnings.push(
      `Toolpath point limit reached (${MAX_TOOLPATH_POINTS.toLocaleString()} max). ` +
        `${budget.discarded.toLocaleString()} point${budget.discarded === 1 ? '' : 's'} discarded; ` +
        `${totalPoints.toLocaleString()} kept. Increase Toolpath Resolution or disable operations to reduce point count.`
    );
  }

  return { segments, warnings };
}

/** Keep visible operation segments plus travel links between adjacent visible ops. */
export function filterVisibleToolpathSegments(
  toolpaths: ToolpathSegment[],
  operations: Operation[]
): ToolpathSegment[] {
  const visibleIds = new Set(operations.filter((o) => o.visible).map((o) => o.id));
  const filtered: ToolpathSegment[] = [];

  for (let i = 0; i < toolpaths.length; i++) {
    const segment = toolpaths[i];
    if (visibleIds.has(segment.operationId)) {
      filtered.push(segment);
      continue;
    }
    if (!segment.operationId.startsWith(INTER_OPERATION_TRAVEL_PREFIX)) continue;

    const prev = toolpaths[i - 1];
    const next = toolpaths[i + 1];
    if (
      prev &&
      next &&
      visibleIds.has(prev.operationId) &&
      visibleIds.has(next.operationId)
    ) {
      filtered.push(segment);
    }
  }

  return filtered;
}

/** Visible toolpaths with origin-to-first-point approach for preview/simulation. */
export function buildVisiblePreviewToolpaths(
  toolpaths: ToolpathSegment[],
  operations: Operation[],
  toolOrigin: ToolOrigin,
  stockTopWorldZ: number,
  safeHeight: number
): ToolpathSegment[] {
  const visible = filterVisibleToolpathSegments(toolpaths, operations);
  return prependToolOriginApproach(
    visible,
    toolOrigin,
    safeHeightWorldZ({ worldTopZ: stockTopWorldZ }, safeHeight)
  );
}
