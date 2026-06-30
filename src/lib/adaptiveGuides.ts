import type { LoopPoint, Operation, OperationDefaults } from '../types/operations';
import { offsetLoop2DMinkowski } from './geometryProcessing';
import { resolveAdaptiveEntryPoint, resolveAdaptiveSlotGeometry } from './adaptiveOutline';
import { resolveGuideTraverseSign } from './adaptiveFourZone';
import { buildBoreLeadInGuide } from './entryPath';
import {
  createCutZContext,
  cutLayersWorldZ,
  finalCutWorldZ,
  type CutZContext,
} from './cutDepth';
import {
  buildArcLengthGuide,
  findClosestSOnGuide,
  sampleGuideAtS,
} from './trochoidalPath';
import {
  minkowskiSegmentLen,
  pathSampleSpacing,
  trochoidSampleSpacing,
  type ToolpathGlobalOptions,
} from './toolpathConfig';

export interface AdaptiveOutlineDebugGuides {
  slotCenterline: LoopPoint[];
  leadInGuide: LoopPoint[];
  layerZ: number;
}

function resolveGuideContext(
  loop: LoopPoint[],
  settings: OperationDefaults,
  entryPoint: { x: number; y: number } | null | undefined,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
) {
  const entry = resolveAdaptiveEntryPoint(loop, settings, entryPoint);
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
  const guideTraverseSign = resolveGuideTraverseSign(slotCenterGuide, settings.climbMilling);
  const layers = cutLayersWorldZ(ctx, settings.depthOffset, settings.stepDown);
  const finalZ = finalCutWorldZ(ctx, settings.depthOffset);
  const layerZ = layers.length > 0 ? layers[0] : finalZ;

  return {
    entry,
    roughSlot,
    slotCenterGuide,
    trochArcGuide,
    trochoidStartS,
    guideTraverseSign,
    trochSampleSpacing,
    layerZ,
  };
}

/** Slot centerline and layer-0 lead-in guide for adaptive-outline debug display. */
export function computeAdaptiveOutlineDebugGuides(
  op: Operation,
  ctx: CutZContext,
  globals: ToolpathGlobalOptions
): AdaptiveOutlineDebugGuides | null {
  const loop = op.geometry?.loops?.[0];
  if (!loop || op.type !== 'adaptive-outline') return null;

  const guideCtx = resolveGuideContext(loop, op.settings, op.geometry?.entryPoint, ctx, globals);
  const leadInGuide = buildBoreLeadInGuide(
    guideCtx.entry,
    guideCtx.trochArcGuide,
    guideCtx.trochoidStartS,
    guideCtx.guideTraverseSign,
    guideCtx.trochSampleSpacing,
    guideCtx.layerZ,
    guideCtx.roughSlot.slotWidth / 2
  );

  return {
    slotCenterline: guideCtx.slotCenterGuide.map((p) => ({ ...p, z: guideCtx.layerZ })),
    leadInGuide,
    layerZ: guideCtx.layerZ,
  };
}

export function computeAdaptiveOutlineDebugGuidesFromBounds(
  op: Operation,
  partBounds: NonNullable<Parameters<typeof createCutZContext>[0]>,
  globals: ToolpathGlobalOptions
): AdaptiveOutlineDebugGuides | null {
  return computeAdaptiveOutlineDebugGuides(op, createCutZContext(partBounds), globals);
}
