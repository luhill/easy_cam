import type { LoopPoint, OperationDefaults } from '../types/operations';
import type { ToolOrigin } from './geometryProcessing';
import { resolveGuideTraverseSign } from './adaptiveFourZone';
import {
  buildSlotCenterGuideWithCornerSpurs,
  mapSpurRangesToArcGuide,
  type CornerSpurRange,
} from './cornerSpurs';
import {
  buildArcLengthGuide,
  findClosestSOnGuide,
  sampleGuideAtS,
  type ArcLengthGuide,
} from './trochoidalPath';
import {
  computeDefaultEntryPoint,
  resolveAdaptiveEntryPoint,
  resolveAdaptiveSlotGeometry,
  cornerSpurOptionsForRoughing,
} from './adaptiveOutline';
import {
  DEFAULT_OUTLINE_OFFSET_CONTEXT,
  type OutlineOffsetContext,
} from './outlineEntry';

export interface AdaptiveEntryOverrides {
  toolStartPoint?: { x: number; y: number } | null;
  slotJoinPoint?: { x: number; y: number } | null;
  /** @deprecated maps to toolStartPoint */
  entryPoint?: { x: number; y: number } | null;
}

export interface AdaptiveEntryLayout {
  toolStart: { x: number; y: number };
  slotJoin: { x: number; y: number };
  trochoidStartS: number;
  slotJoinS: number;
  guideTraverseSign: number;
  slotCenterGuide: LoopPoint[];
  trochArcGuide: ArcLengthGuide;
  cornerSpurRanges: CornerSpurRange[];
  traverseTangent: { x: number; y: number };
}

export function adaptiveEntryOverridesFromGeometry(
  geometry: AdaptiveEntryOverrides | null | undefined
): AdaptiveEntryOverrides | null {
  if (!geometry) return null;
  return {
    toolStartPoint: geometry.toolStartPoint,
    slotJoinPoint: geometry.slotJoinPoint,
    entryPoint: geometry.entryPoint,
  };
}

/** Resolve bore start, slot join on centerline, and trochoid start station. */
export function resolveAdaptiveEntryLayout(
  partLoop: LoopPoint[],
  settings: OperationDefaults,
  overrides: AdaptiveEntryOverrides | null | undefined,
  centerGuideSegLen: number,
  trochSampleSpacing: number,
  resolution = 2,
  toolOrigin?: Pick<ToolOrigin, 'x' | 'y'> | null,
  offsetContext: OutlineOffsetContext = DEFAULT_OUTLINE_OFFSET_CONTEXT
): AdaptiveEntryLayout | null {
  if (partLoop.length < 2) return null;

  const roughSlot = resolveAdaptiveSlotGeometry(settings, { roughing: true });
  const finishSlot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
  const { guide: slotCenterGuide, spurMarkers } = buildSlotCenterGuideWithCornerSpurs(
    partLoop,
    roughSlot.slotCenterOffset,
    finishSlot.innerCenterOffset,
    centerGuideSegLen,
    cornerSpurOptionsForRoughing(settings),
    offsetContext.offsetSign,
    offsetContext.wallSide,
    offsetContext.voidNormalX,
    offsetContext.voidNormalY
  );
  if (slotCenterGuide.length < 3) return null;

  const arcGuide = buildArcLengthGuide(
    slotCenterGuide,
    Math.max(centerGuideSegLen, 0.25)
  );
  const { arcGuide: trochArcGuide, spurRanges: cornerSpurRanges } = mapSpurRangesToArcGuide(
    slotCenterGuide,
    spurMarkers,
    trochSampleSpacing,
    { trochoidR: roughSlot.trochoidRadius, resolution }
  );
  const guideTraverseSign = resolveGuideTraverseSign(
    slotCenterGuide,
    settings.climbMilling,
    offsetContext.wallSide
  );
  const forward = guideTraverseSign >= 0;
  const tangentSign = forward ? 1 : -1;

  const toolStartOverride = overrides?.toolStartPoint ?? overrides?.entryPoint ?? null;
  const toolStart = toolStartOverride
    ? resolveAdaptiveEntryPoint(
        partLoop,
        settings,
        toolStartOverride,
        toolOrigin,
        offsetContext.offsetSign,
        offsetContext.wallSide
      )
    : computeDefaultEntryPoint(
        partLoop,
        settings,
        toolOrigin,
        offsetContext.offsetSign,
        offsetContext.wallSide,
        offsetContext.voidNormalX,
        offsetContext.voidNormalY
      );

  const slotJoinSnap = overrides?.slotJoinPoint
    ? findClosestSOnGuide(arcGuide, overrides.slotJoinPoint)
    : toolOrigin
      ? findClosestSOnGuide(arcGuide, toolOrigin)
      : findClosestSOnGuide(arcGuide, toolStart);
  const slotJoinS = slotJoinSnap.s;
  const slotJoinFrame = sampleGuideAtS(arcGuide, slotJoinS);

  const trochoidStartS = findClosestSOnGuide(trochArcGuide, slotJoinFrame).s;
  const trochFrame = sampleGuideAtS(trochArcGuide, trochoidStartS);
  const d2Len = Math.hypot(trochFrame.tx, trochFrame.ty) || 1;
  const traverseTangent = {
    x: (trochFrame.tx * tangentSign) / d2Len,
    y: (trochFrame.ty * tangentSign) / d2Len,
  };

  return {
    toolStart,
    slotJoin: { x: slotJoinFrame.x, y: slotJoinFrame.y },
    trochoidStartS,
    slotJoinS,
    guideTraverseSign,
    slotCenterGuide,
    trochArcGuide,
    cornerSpurRanges,
    traverseTangent,
  };
}

/** Snap an XY pick to the nearest point on the slot centerline guide. */
export function snapPointToSlotCenterline(
  arcGuide: ArcLengthGuide,
  point: { x: number; y: number }
): { x: number; y: number; s: number } {
  const hit = findClosestSOnGuide(arcGuide, point);
  const frame = sampleGuideAtS(arcGuide, hit.s);
  return { x: frame.x, y: frame.y, s: hit.s };
}
