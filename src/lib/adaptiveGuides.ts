import type { LoopPoint, Operation, OperationDefaults } from '../types/operations';
import {
  adaptiveEntryOverridesFromGeometry,
  resolveAdaptiveEntryLayout,
} from './adaptiveEntryLayout';
import { buildSplineEntryGuide, buildUnifiedEntryCenterlineGuide } from './entryPath';
import {
  createCutZContext,
  cutLayersWorldZ,
  finalCutWorldZ,
  type CutZContext,
} from './cutDepth';
import { buildArcLengthGuide } from './trochoidalPath';
import {
  minkowskiSegmentLen,
  pathSampleSpacing,
  trochoidSampleSpacing,
  type ToolpathGlobalOptions,
} from './toolpathConfig';
import { resolveAdaptiveSlotGeometry, cornerSpurOptionsForRoughing } from './adaptiveOutline';
import { buildSlotCenterGuideWithCornerSpurs } from './cornerSpurs';

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
    trochSampleSpacing,
    globals.resolution
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

  const { entryLayout, trochSampleSpacing, layerZ } = guideCtx;
  const leadInGuide = buildUnifiedEntryCenterlineGuide(
    buildSplineEntryGuide(
      entryLayout.toolStart,
      entryLayout.slotJoin,
      entryLayout.traverseTangent,
      trochSampleSpacing,
      layerZ
    ),
    entryLayout.trochArcGuide,
    entryLayout.trochoidStartS,
    entryLayout.guideTraverseSign,
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
  const finishSlot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
  const segLen = minkowskiSegmentLen(globals.resolution);
  const { guide: slotCenterGuide } = buildSlotCenterGuideWithCornerSpurs(
    loop,
    roughSlot.slotCenterOffset,
    finishSlot.innerCenterOffset,
    segLen,
    cornerSpurOptionsForRoughing(settings)
  );
  return buildArcLengthGuide(slotCenterGuide, pathSampleSpacing(globals.resolution));
}

export { resolveAdaptiveEntryLayout, adaptiveEntryOverridesFromGeometry, snapPointToSlotCenterline } from './adaptiveEntryLayout';
