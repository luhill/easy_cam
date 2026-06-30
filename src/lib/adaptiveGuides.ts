import type { LoopPoint, Operation, OperationDefaults } from '../types/operations';
import {
  adaptiveEntryOverridesFromGeometry,
  resolveAdaptiveEntryLayout,
} from './adaptiveEntryLayout';
import { buildSplineToSlotTrochoidGuide } from './entryPath';
import {
  createCutZContext,
  cutLayersWorldZ,
  finalCutWorldZ,
  type CutZContext,
} from './cutDepth';
import { adaptiveForwardIncrement, buildArcLengthGuide } from './trochoidalPath';
import {
  minkowskiSegmentLen,
  pathSampleSpacing,
  trochoidSampleSpacing,
  type ToolpathGlobalOptions,
} from './toolpathConfig';
import { resolveAdaptiveSlotGeometry } from './adaptiveOutline';
import { offsetLoop2DMinkowski } from './geometryProcessing';

export interface AdaptiveOutlineDebugGuides {
  slotCenterline: LoopPoint[];
  leadInGuide: LoopPoint[];
  layerZ: number;
}

function resolveGuideContext(
  loop: LoopPoint[],
  settings: OperationDefaults,
  geometry: Operation['geometry'],
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
) {
  const segLen = minkowskiSegmentLen(globals.resolution);
  const roughSlot = resolveAdaptiveSlotGeometry(settings, { roughing: true });
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
    trochSampleSpacing
  );
  const layers = cutLayersWorldZ(ctx, settings.depthOffset, settings.stepDown);
  const finalZ = finalCutWorldZ(ctx, settings.depthOffset);
  const layerZ = layers.length > 0 ? layers[0] : finalZ;

  if (!entryLayout) {
    return null;
  }

  return {
    entryLayout,
    roughSlot,
    trochSampleSpacing,
    layerZ,
  };
}

/** Slot centerline and layer-0 spline lead-in for adaptive-outline debug display. */
export function computeAdaptiveOutlineDebugGuides(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
): AdaptiveOutlineDebugGuides | null {
  const loop = op.geometry?.loops?.[0];
  if (!loop || op.type !== 'adaptive-outline') return null;

  const guideCtx = resolveGuideContext(loop, op.settings, op.geometry, ctx, globals);
  if (!guideCtx) return null;

  const { entryLayout, trochSampleSpacing, layerZ, roughSlot } = guideCtx;
  const stepoverIncrement = adaptiveForwardIncrement(
    roughSlot.toolDiameter,
    op.settings.stepover
  );
  const leadInGuide = buildSplineToSlotTrochoidGuide(
    entryLayout.toolStart,
    entryLayout.slotJoin,
    entryLayout.traverseTangent,
    entryLayout.trochArcGuide,
    entryLayout.trochoidStartS,
    entryLayout.guideTraverseSign,
    stepoverIncrement,
    trochSampleSpacing,
    layerZ
  );

  return {
    slotCenterline: entryLayout.slotCenterGuide.map((p) => ({ ...p, z: layerZ })),
    leadInGuide,
    layerZ,
  };
}

export function computeAdaptiveOutlineDebugGuidesFromBounds(
  op: Operation,
  partBounds: NonNullable<Parameters<typeof createCutZContext>[0]>,
  globals: ToolpathGlobalOptions
): AdaptiveOutlineDebugGuides | null {
  return computeAdaptiveOutlineDebugGuides(op, createCutZContext(partBounds), globals);
}

/** Arc-length guide on slot centerline for snapping slot join drags in the viewer. */
export function buildSlotCenterlineArcGuide(
  loop: LoopPoint[],
  settings: OperationDefaults,
  globals: ToolpathGlobalOptions
) {
  const roughSlot = resolveAdaptiveSlotGeometry(settings, { roughing: true });
  const segLen = minkowskiSegmentLen(globals.resolution);
  const slotCenterGuide = offsetLoop2DMinkowski(loop, roughSlot.slotCenterOffset, segLen);
  return buildArcLengthGuide(slotCenterGuide, pathSampleSpacing(globals.resolution));
}

export { resolveAdaptiveEntryLayout, adaptiveEntryOverridesFromGeometry, snapPointToSlotCenterline } from './adaptiveEntryLayout';
