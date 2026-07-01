import type { Operation, ToolpathPoint, ToolpathSegment } from '../types/operations';
import type { LoopPoint } from '../types/operations';
import { DEFAULT_SETTINGS } from '../types/operations';
import type { PartBounds } from './geometryProcessing';
import {
  closestPointOnLoop2D,
  offsetLoop2D,
  offsetLoop2DMinkowski,
  signedLoopArea2D,
} from './geometryProcessing';
import { OPERATION_COLORS, getSelectedHoles } from '../types/operations';
import { clampOperationSettings } from './settingLimits';
import {
  buildSlotCenterGuideWithCornerSpurs,
  mapSpurRangesToArcGuide,
  buildGuideRadiusSampler,
} from './cornerSpurs';
import { resolveAdaptiveSlotGeometry, cornerSpurOptionsForRoughing } from './adaptiveOutline';
import {
  adaptiveEntryOverridesFromGeometry,
  resolveAdaptiveEntryLayout,
} from './adaptiveEntryLayout';
import {
  generateFourZoneAdaptivePath,
  generateContinuousEntryTrochoidPath,
  resolveGuideTraverseSign,
  resolveOrbitRotSign,
  wrapPathFromIndex,
} from './adaptiveFourZone';
import {
  buildSplineEntryGuide,
  adjustBoreRadiusToSlotWidth,
  closestPointIndexOnPath,
  generateBoreBottomToLeadInTransition,
  generateFullRevolutionOrbit,
  generateHelixBorePoints,
  helixRadiusAtZ,
  helixRadiusTaperedFromStart,
  interiorHelixRadiusAtZ,
  isGuideOutwardCCW,
  resolveHelixRotationDir,
  resolveInteriorHelixRadius,
  resolveInteriorHelixRotationDir,
  resolveSlotHelixRadius,
} from './entryPath';
import {
  adaptiveForwardIncrement,
  sampleGuideAtS,
} from './trochoidalPath';
import {
  createCutZContext,
  cutLayersWorldZ,
  finalCutWorldZ,
  stockTopWorldZ,
  type CutZContext,
} from './cutDepth';
import {
  helixHoleInvalidLabel,
  validateHelixHole,
} from './helixValidation';
import {
  contourSteps,
  helixSegmentsPerRev,
  minkowskiSegmentLen,
  safeHeightWorldZ,
  trochoidSampleSpacing,
  type ToolpathGlobalOptions,
  DEFAULT_SAFE_HEIGHT,
  DEFAULT_TOOLPATH_RESOLUTION,
  DEFAULT_TRAVEL_FEED_RATE,
} from './toolpathConfig';

export const MAX_TOOLPATH_POINTS = 500_000;

export interface ToolpathGenerationResult {
  segments: ToolpathSegment[];
  warnings: string[];
}

let activePointBudget: { discarded: number } | null = null;

function toolRadius(settings: Operation['settings']): number {
  return Math.max(settings.toolDiameter, 0.1) / 2;
}

function toolCenterlineOffset(settings: Operation['settings']): number {
  return toolRadius(settings) + (settings.radialOffset ?? 0);
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

  return { minX: -25, maxX: 25, minY: -25, maxY: 25 };
}

function appendPoints(target: ToolpathPoint[], points: ToolpathPoint[]): boolean {
  const room = MAX_TOOLPATH_POINTS - target.length;
  if (room <= 0) {
    if (activePointBudget) activePointBudget.discarded += points.length;
    return false;
  }
  if (points.length <= room) {
    target.push(...points);
    return true;
  }
  target.push(...points.slice(0, room));
  if (activePointBudget) activePointBudget.discarded += points.length - room;
  return false;
}

function loopToToolpathPoints(
  loop: LoopPoint[],
  settings: Operation['settings'],
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
): ToolpathPoint[] {
  const topZ = stockTopWorldZ(ctx);
  const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
  const layers = cutLayersWorldZ(ctx, settings.depthOffset, settings.stepDown);
  const points: ToolpathPoint[] = [];

  if (loop.length === 0) return points;

  const toolLoop = offsetLoop2D(loop, toolCenterlineOffset(settings));
  const ccw = signedLoopArea2D(loop) >= 0;
  const reverse = settings.climbMilling ? ccw : !ccw;
  const traverse = reverse ? [...toolLoop].reverse() : toolLoop;

  const start = traverse[0];
  points.push({ x: start.x, y: start.y, z: safeZ, rapid: true });
  points.push({ x: start.x, y: start.y, z: topZ });

  for (const layerZ of layers) {
    for (const p of traverse) {
      points.push({ x: p.x, y: p.y, z: layerZ });
    }
    points.push({ x: traverse[0].x, y: traverse[0].y, z: layerZ });
  }

  points.push({ x: start.x, y: start.y, z: safeZ, rapid: true });
  return points;
}

function generateOutlinePath(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
): ToolpathPoint[] {
  const { settings, geometry } = op;
  const topZ = stockTopWorldZ(ctx);

  if (geometry?.loops && geometry.loops.length > 0) {
    return loopToToolpathPoints(geometry.loops[0], settings, ctx, globals);
  }

  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const fallbackLoop: LoopPoint[] = [
    { x: minX, y: minY, z: topZ },
    { x: maxX, y: minY, z: topZ },
    { x: maxX, y: maxY, z: topZ },
    { x: minX, y: maxY, z: topZ },
  ];
  return loopToToolpathPoints(fallbackLoop, settings, ctx, globals);
}

function trochoidParams(
  partLoop: LoopPoint[],
  settings: Operation['settings'],
  slotCenterGuide: LoopPoint[],
  z: number,
  roughing: boolean,
  globals: ToolpathGlobalOptions,
  cutFeedRate?: number
) {
  const slot = resolveAdaptiveSlotGeometry(settings, { roughing });
  const guideSign = resolveGuideTraverseSign(slotCenterGuide, settings.climbMilling);
  return {
    forwardIncrement: slot.forwardIncrement,
    slotClearance: slot.slotClearance,
    z,
    liftAmount: Math.max(settings.liftAmount ?? 0, 0),
    partLoop,
    minCenterDist: slot.minCenterDist,
    rotSign: resolveOrbitRotSign(slotCenterGuide, settings.climbMilling),
    guideSign,
    feedRate: cutFeedRate ?? settings.feedRate,
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
  omitFirstOrbitSample?: boolean
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
    cornerSpurOptionsForRoughing(settings)
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
      ...trochoidParams(partLoop, settings, slotCenterGuide, z, roughing, globals),
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

function appendClosedOutlinePath(
  target: ToolpathPoint[],
  path: ToolpathPoint[],
  from: { x: number; y: number }
): boolean {
  if (path.length < 2) return true;

  const joinIdx = closestPointIndexOnPath(path, from);
  const loop = wrapPathFromIndex(path, joinIdx);

  if (!appendGeneratedPath(target, loop)) return false;

  const loopStart = loop[0];
  return appendPoints(target, [{ x: loopStart.x, y: loopStart.y, z: loopStart.z }]);
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
  globals: ToolpathGlobalOptions
): ToolpathPoint[] {
  const roughSlot = resolveAdaptiveSlotGeometry(settings, { roughing: true });
  const finishSlot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
  const segLen = minkowskiSegmentLen(globals.resolution);
  const finishGuide = offsetLoop2DMinkowski(partLoop, finishSlot.innerCenterOffset, segLen);
  const { guide: roughCenterGuide } = buildSlotCenterGuideWithCornerSpurs(
    partLoop,
    roughSlot.slotCenterOffset,
    finishSlot.innerCenterOffset,
    segLen,
    cornerSpurOptionsForRoughing(settings)
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

  const boreStartAngle = Math.atan2(
    boreBottom.y - boreCenter.y,
    boreBottom.x - boreCenter.x
  );

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
  return topZ + Math.min(Math.max(safeHeight, 0), Math.max(zStartOffset, 0));
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

function generateAdaptiveOutlinePath(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
): ToolpathPoint[] {
  const { settings, geometry } = op;
  const loop = geometry?.loops?.[0];

  if (!loop) {
    return generateOutlinePath(op, ctx, globals);
  }

  const topZ = stockTopWorldZ(ctx);
  const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
  const layers = cutLayersWorldZ(ctx, settings.depthOffset, settings.stepDown);
  const finalZ = finalCutWorldZ(ctx, settings.depthOffset);

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
    globals.resolution
  );
  if (!entryLayout) {
    return generateOutlinePath(op, ctx, globals);
  }

  const toolStart = entryLayout.toolStart;
  const trochoidStartS = entryLayout.trochoidStartS;
  const slotCenterGuide = entryLayout.slotCenterGuide;
  const trochArcGuide = entryLayout.trochArcGuide;
  const slotHelixR = resolveSlotHelixRadius(roughSlot.slotClearance);
  const helixOpts = { stockTopZ: topZ, globals };
  const cutFeed = settings.feedRate;
  const plungeFeed = settings.plungeRate;
  const travelFeed = globals.travelFeedRate;
  const outwardCCW = isGuideOutwardCCW(loop);
  const points: ToolpathPoint[] = [];

  points.push({ x: toolStart.x, y: toolStart.y, z: safeZ, rapid: true });

  const helixTarget = layers.length > 0 ? layers[0] : finalZ;
  let boreHelixAngle = 0;

  const initialBore = generateHelixBorePoints(toolStart, settings, safeZ, helixTarget, {
    ...helixOpts,
    taper: true,
    startAngle: boreHelixAngle,
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
        feedRate: plungeFeed,
      });
      if (!appendPoints(points, layerBore.points)) {
        break;
      }
      boreHelixAngle = layerBore.endAngle;
    }

    if (li === 0) {
      const layerTroch = generateContinuousEntryTrochoidPath(
        buildSplineEntryGuide(
          toolStart,
          entryLayout.slotJoin,
          entryLayout.traverseTangent,
          trochSampleSpacing,
          layerZ
        ),
        trochArcGuide,
        trochoidStartS,
        entryLayout.guideTraverseSign,
        {
          ...trochoidParams(loop, settings, slotCenterGuide, layerZ, true, globals, cutFeed),
          z: layerZ,
          arcGuide: trochArcGuide,
          trochoidRAtGuide: spurRadiusSampler,
        },
        outwardCCW,
        entryLayout.cornerSpurRanges
      );

      if (layerTroch.length === 0) continue;

      if (
        !appendBoreBottomWidenAndLeadIn(
          points,
          toolStart,
          layerZ,
          slotHelixR,
          helixRadiusAtZ(settings, layerZ, topZ),
          stepoverIncrement,
          rotDir,
          segmentsPerRev,
          plungeFeed,
          layerTroch[0]
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
      false
    );

    if (layerTroch.length === 0) continue;

    if (
      !appendBoreBottomWidenAndLeadIn(
        points,
        slotBoreCenter,
        layerZ,
        slotHelixR,
        helixRadiusTaperedFromStart(settings, layerZ, prevZ, slotHelixR),
        stepoverIncrement,
        rotDir,
        segmentsPerRev,
        plungeFeed,
        layerTroch[0]
      )
    ) {
      break;
    }
    if (!appendGeneratedPath(points, layerTroch)) break;
  }

  if (settings.finishingPass) {
    const finishZ = layers.length > 0 ? layers[layers.length - 1] : finalZ;
    const finishPath = generateFinishingOutline(loop, settings, finishZ, globals);
    if (finishPath.length > 0) {
      const at = lastPathPoint(points);
      if (at) {
        if (!appendClosedOutlinePath(points, finishPath, at)) {
          appendRetractViaSlotCenter(points, slotJoinCenter, safeZ, travelFeed);
          return points;
        }
      } else if (!appendPoints(points, finishPath)) {
        appendRetractViaSlotCenter(points, slotJoinCenter, safeZ, travelFeed);
        return points;
      }
    }
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
  isFirst: boolean
): ToolpathPoint[] {
  const topZ = stockTopWorldZ(ctx);
  const layers = cutLayersWorldZ(ctx, settings.depthOffset, settings.stepDown);
  const points: ToolpathPoint[] = [];

  if (isFirst) {
    points.push({ x: cx, y: cy, z: safeZ, rapid: true });
  } else {
    points.push({ x: cx, y: cy, z: safeZ, rapid: true });
  }
  points.push({ x: cx, y: cy, z: topZ });

  for (const layerZ of layers) {
    points.push({ x: cx, y: cy, z: layerZ });
    points.push({ x: cx, y: cy, z: safeZ, rapid: true });
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

  holes.forEach((hole, index) => {
    appendPoints(
      points,
      generateDrillPathForHole(
        hole.center.x,
        hole.center.y,
        settings,
        ctx,
        safeZ,
        index === 0
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

function generatePocketPath(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
): ToolpathPoint[] {
  const { settings, geometry } = op;
  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const stepover = settings.toolDiameter * (settings.stepover / 100);
  const layers = cutLayersWorldZ(ctx, settings.depthOffset, settings.stepDown);
  const cutZ = layers.length > 0 ? layers[layers.length - 1] : finalCutWorldZ(ctx, settings.depthOffset);
  const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
  const points: ToolpathPoint[] = [];

  points.push({ x: minX, y: minY, z: safeZ, rapid: true });
  points.push({ x: minX, y: minY, z: cutZ });

  let y = minY;
  let direction = 1;
  while (y <= maxY) {
    if (direction === 1) {
      points.push({ x: maxX, y, z: cutZ });
    } else {
      points.push({ x: minX, y, z: cutZ });
    }
    y += stepover;
    if (y <= maxY) {
      points.push({ x: direction === 1 ? maxX : minX, y, z: cutZ });
    }
    direction *= -1;
  }

  points.push({ x: minX, y: minY, z: safeZ, rapid: true });
  return points;
}

function generateContourPath(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
): ToolpathPoint[] {
  const { settings, geometry } = op;
  const { minX, maxX, minY, maxY } = getBounds(geometry);
  const topZ = stockTopWorldZ(ctx);
  const finalZ = finalCutWorldZ(ctx, settings.depthOffset);
  const safeZ = safeHeightWorldZ(ctx, globals.safeHeight);
  const points: ToolpathPoint[] = [];
  const steps = contourSteps(globals.resolution);

  points.push({ x: minX, y: minY, z: safeZ, rapid: true });

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = minX + (maxX - minX) * t;
    const wave = Math.sin(t * Math.PI * 4) * 2;
    const currentZ = topZ + (finalZ - topZ) * t + wave;
    points.push({ x, y: minY + (maxY - minY) * t, z: currentZ });
  }

  points.push({ x: maxX, y: maxY, z: safeZ, rapid: true });
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
  const settings = normalizedSettings(op.settings);
  const operation = { ...op, settings };

  switch (operation.type) {
    case 'outline':
      return generateOutlinePath(operation, ctx, globals);
    case 'adaptive-outline':
      return generateAdaptiveOutlinePath(operation, ctx, globals);
    case 'drill':
      return generateDrillPath(operation, ctx, globals);
    case 'helix':
      return generateHelixPath(operation, ctx, globals, warnings);
    case 'pocket':
      return generatePocketPath(operation, ctx, globals);
    case 'contour':
      return generateContourPath(operation, ctx, globals);
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
