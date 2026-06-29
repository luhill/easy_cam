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
import { resolveAdaptiveEntryPoint, resolveAdaptiveSlotGeometry } from './adaptiveOutline';
import {
  generateFourZoneAdaptivePath,
  generateOpenTrochoidPath,
  resolveGuideTraverseSign,
  resolveOrbitRotSign,
  wrapPathFromIndex,
} from './adaptiveFourZone';
import {
  buildBoreToSlotConnectorGuide,
  closestPointIndexOnPath,
  generateExpandingSpiral,
  generateHelixBorePoints,
  helixRadiusAtZ,
  isGuideOutwardCCW,
  resolveHelixRotationDir,
  resolveSlotHelixRadius,
} from './entryPath';
import { buildArcLengthGuide, findClosestSOnGuide, sampleGuideAtS } from './trochoidalPath';
import {
  createCutZContext,
  cutLayersWorldZ,
  finalCutWorldZ,
  stockTopWorldZ,
  type CutZContext,
} from './cutDepth';
import {
  contourSteps,
  helixSegmentsPerRev,
  minkowskiSegmentLen,
  pathSampleSpacing,
  safeHeightWorldZ,
  trochoidSampleSpacing,
  type ToolpathGlobalOptions,
  DEFAULT_SAFE_HEIGHT,
  DEFAULT_TOOLPATH_RESOLUTION,
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
  feedRate?: number
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
    feedRate,
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
  const slot = resolveAdaptiveSlotGeometry(settings, { roughing });
  const segLen = minkowskiSegmentLen(globals.resolution);
  const slotCenterGuide = offsetLoop2DMinkowski(partLoop, slot.slotCenterOffset, segLen);
  return generateFourZoneAdaptivePath(slotCenterGuide, {
    ...trochoidParams(partLoop, settings, slotCenterGuide, z, roughing, globals),
    startS,
    skipArcLength,
    omitFirstOrbitSample,
  });
}

function appendGeneratedPath(
  target: ToolpathPoint[],
  generated: ToolpathPoint[]
): boolean {
  if (generated.length === 0) return true;
  const last = target[target.length - 1];
  const start =
    last && Math.hypot(generated[0].x - last.x, generated[0].y - last.y) < 0.12 ? 1 : 0;
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
  const roughCenterGuide = offsetLoop2DMinkowski(partLoop, roughSlot.slotCenterOffset, segLen);
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

function appendReturnToSlotCenter(
  target: ToolpathPoint[],
  guide: ReturnType<typeof buildArcLengthGuide>,
  joinS: number,
  z: number
): boolean {
  const center = sampleGuideAtS(guide, joinS);
  const last = lastPathPoint(target);
  if (!last) return true;
  if (Math.hypot(last.x - center.x, last.y - center.y) < 0.08) return true;
  return appendPoints(target, [{ x: center.x, y: center.y, z, rapid: true }]);
}

function appendVerticalRetract(
  points: ToolpathPoint[],
  clearanceZ: number
): void {
  const last = lastPathPoint(points);
  if (last) {
    points.push({ x: last.x, y: last.y, z: clearanceZ, rapid: true });
  }
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

  const entry = resolveAdaptiveEntryPoint(loop, settings, geometry?.entryPoint);
  const points: ToolpathPoint[] = [];
  const helixFeed = settings.helixFeedRate;
  const roughSlot = resolveAdaptiveSlotGeometry(settings, { roughing: true });
  const segLen = minkowskiSegmentLen(globals.resolution);
  const slotCenterGuide = offsetLoop2DMinkowski(loop, roughSlot.slotCenterOffset, segLen);
  const trochSampleSpacing = trochoidSampleSpacing(
    roughSlot.forwardIncrement,
    roughSlot.trochoidRadius,
    globals.resolution
  );
  const arcGuide = buildArcLengthGuide(
    slotCenterGuide,
    pathSampleSpacing(globals.resolution)
  );
  const trochArcGuide = buildArcLengthGuide(slotCenterGuide, trochSampleSpacing);
  const join = findClosestSOnGuide(arcGuide, entry);
  const joinPt = sampleGuideAtS(arcGuide, join.s);
  const trochoidStartS = findClosestSOnGuide(trochArcGuide, joinPt).s;
  const slotHelixR = resolveSlotHelixRadius(roughSlot.slotClearance);
  const helixOpts = { stockTopZ: topZ, globals };
  const guideTraverseSign = resolveGuideTraverseSign(slotCenterGuide, settings.climbMilling);
  const outwardCCW = isGuideOutwardCCW(loop);

  points.push({ x: entry.x, y: entry.y, z: safeZ, rapid: true });

  const helixTarget = layers.length > 0 ? layers[0] : finalZ;

  if (safeZ > topZ + 1e-4) {
    appendPoints(
      points,
      generateHelixBorePoints(entry, settings, safeZ, topZ, {
        ...helixOpts,
        taper: false,
      })
    );
  }

  appendPoints(
    points,
    generateHelixBorePoints(entry, settings, topZ, helixTarget, {
      ...helixOpts,
      taper: true,
    })
  );

  for (let li = 0; li < layers.length; li++) {
    const layerZ = layers[li];
    const prevZ = li > 0 ? layers[li - 1] : helixTarget;

    if (li > 0) {
      if (!appendReturnToSlotCenter(points, trochArcGuide, trochoidStartS, prevZ)) break;
      const slotCenter = sampleGuideAtS(trochArcGuide, trochoidStartS);
      if (
        !appendPoints(
          points,
          generateHelixBorePoints(slotCenter, settings, prevZ, layerZ, {
            ...helixOpts,
            taper: prevZ > topZ + 1e-4,
            helixR: slotHelixR,
          })
        )
      ) {
        break;
      }
    } else if (Math.abs(layerZ - helixTarget) > 1e-4) {
      if (
        !appendPoints(
          points,
          generateHelixBorePoints(entry, settings, helixTarget, layerZ, {
            ...helixOpts,
            taper: true,
          })
        )
      ) {
        break;
      }
    }

    if (li === 0) {
      const bottomHelixR = helixRadiusAtZ(settings, layerZ, topZ);
      const segmentsPerRev = helixSegmentsPerRev(globals.resolution);
      const rotParams = trochoidParams(
        loop,
        settings,
        slotCenterGuide,
        layerZ,
        true,
        globals,
        helixFeed
      );

      if (bottomHelixR < slotHelixR - 1e-3) {
        const lastPt = lastPathPoint(points);
        const startAngle = lastPt
          ? Math.atan2(lastPt.y - entry.y, lastPt.x - entry.x)
          : 0;
        if (
          !appendPoints(
            points,
            generateExpandingSpiral(
              entry,
              bottomHelixR,
              slotHelixR,
              layerZ,
              roughSlot.forwardIncrement,
              resolveHelixRotationDir(settings.climbMilling),
              segmentsPerRev,
              startAngle,
              helixFeed
            )
          )
        ) {
          break;
        }
      }

      const lastPt = lastPathPoint(points);
      if (lastPt) {
        const connectorStartS = findClosestSOnGuide(trochArcGuide, lastPt).s;
        const connectorGuide = buildBoreToSlotConnectorGuide(
          { x: lastPt.x, y: lastPt.y, z: layerZ },
          trochArcGuide,
          connectorStartS,
          trochoidStartS,
          guideTraverseSign,
          trochSampleSpacing,
          layerZ
        );

        if (connectorGuide.length >= 2) {
          const connectorTroch = generateOpenTrochoidPath(
            connectorGuide,
            { ...rotParams, z: layerZ, liftAmount: 0 },
            outwardCCW
          );
          if (connectorTroch.length > 0) {
            if (!appendGeneratedPath(points, connectorTroch)) break;
          }
        }
      }
    }

    const startS = trochoidStartS;
    const skipArc = li === 0 ? roughSlot.forwardIncrement : 0;
    const troch = generateAdaptiveTrochoidalPath(
      loop,
      settings,
      layerZ,
      globals,
      true,
      startS,
      skipArc,
      false
    );
    if (troch.length === 0) continue;

    if (!appendGeneratedPath(points, troch)) break;
  }

  if (settings.finishingPass) {
    const finishZ = layers.length > 0 ? layers[layers.length - 1] : finalZ;
    const finishPath = generateFinishingOutline(loop, settings, finishZ, globals);
    if (finishPath.length > 0) {
      const at = lastPathPoint(points);
      if (at) {
        if (!appendClosedOutlinePath(points, finishPath, at)) {
          appendVerticalRetract(points, safeZ);
          return points;
        }
      } else if (!appendPoints(points, finishPath)) {
        appendVerticalRetract(points, safeZ);
        return points;
      }
    }
  }

  appendVerticalRetract(points, safeZ);
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
  globals: ToolpathGlobalOptions,
  isFirst: boolean
): ToolpathPoint[] {
  const topZ = stockTopWorldZ(ctx);
  const finalZ = finalCutWorldZ(ctx, settings.depthOffset);
  const layers = cutLayersWorldZ(ctx, settings.depthOffset, settings.stepDown);
  const cutR = Math.max(holeR - toolRadius(settings), toolRadius(settings) * 0.25);
  const points: ToolpathPoint[] = [];
  const segments = Math.max(8, Math.round(36 / Math.max(globals.resolution, 0.5)));

  if (isFirst) {
    points.push({ x: cx + cutR, y: cy, z: safeZ, rapid: true });
  } else {
    points.push({ x: cx, y: cy, z: safeZ, rapid: true });
    points.push({ x: cx + cutR, y: cy, z: topZ });
  }

  const zTargets = layers.length > 0 ? layers : [finalZ];
  let currentZ = topZ;
  let angle = 0;

  for (const targetZ of zTargets) {
    const zSpan = currentZ - targetZ;
    if (zSpan <= 1e-6) continue;
    const zStep = zSpan / segments;
    for (let i = 0; i < segments; i++) {
      angle += (Math.PI * 2) / segments;
      currentZ = Math.max(currentZ - zStep, targetZ);
      points.push({
        x: cx + Math.cos(angle) * cutR,
        y: cy + Math.sin(angle) * cutR,
        z: currentZ,
      });
    }
    currentZ = targetZ;
  }

  return points;
}

function generateHelixPath(
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
      generateHelixPathForHole(
        hole.center.x,
        hole.center.y,
        hole.radius,
        settings,
        ctx,
        safeZ,
        globals,
        index === 0
      )
    );
  });

  const last = holes[holes.length - 1];
  points.push({ x: last.center.x, y: last.center.y, z: safeZ, rapid: true });
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
  globals: ToolpathGlobalOptions
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
      return generateHelixPath(operation, ctx, globals);
    case 'pocket':
      return generatePocketPath(operation, ctx, globals);
    case 'contour':
      return generateContourPath(operation, ctx, globals);
    default:
      return [];
  }
}

export function generateToolpaths(
  operations: Operation[],
  partBounds: PartBounds | null = null,
  globals: ToolpathGlobalOptions = {
    safeHeight: DEFAULT_SAFE_HEIGHT,
    resolution: DEFAULT_TOOLPATH_RESOLUTION,
  }
): ToolpathGenerationResult {
  const ctx = createCutZContext(partBounds);
  const budget = { discarded: 0 };
  activePointBudget = budget;

  const segments = operations
    .filter((op) => op.enabled)
    .map((op) => ({
      operationId: op.id,
      points: generatePathForOperation(op, ctx, globals),
      color: OPERATION_COLORS[op.type],
    }));

  activePointBudget = null;

  const warnings: string[] = [];
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
