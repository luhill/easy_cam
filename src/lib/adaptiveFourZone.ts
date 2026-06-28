import type { ToolpathPoint } from '../types/operations';
import type { ArcLengthGuide, GuideFrame, TrochoidalParams } from './trochoidalPath';
import {
  buildArcLengthGuide,
  sampleGuideAtS,
} from './trochoidalPath';
import type { LoopPoint } from '../types/operations';
import { clampToolCenterMinDistanceFromPart, signedLoopArea2D } from './geometryProcessing';

/** Micro-retract / lift between trochoid passes (mm). 0 = bypass exit lift entirely. */
export type LiftAmount = number;

export interface FourZoneParams extends TrochoidalParams {
  liftAmount: LiftAmount;
}

interface PlanarFrame {
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
}

const RETURN_STEP_MM = 2.5;
const ENTRY_ARC_STEPS = 10;
const EXIT_LIFT_STEPS = 4;

function normalizeFrame(frame: GuideFrame): PlanarFrame {
  let tx = frame.tx;
  let ty = frame.ty;
  let nx = frame.nx;
  let ny = frame.ny;
  const nlen = Math.hypot(nx, ny) || 1;
  nx /= nlen;
  ny /= nlen;
  const tlen = Math.hypot(tx, ty) || 1;
  tx /= tlen;
  ty /= tlen;
  return { x: frame.x, y: frame.y, z: frame.z, tx, ty, nx, ny };
}

function trochoidCutPoint(
  frame: PlanarFrame,
  trochoidR: number,
  theta: number
): ToolpathPoint {
  const cx = frame.x + frame.nx * trochoidR;
  const cy = frame.y + frame.ny * trochoidR;
  return {
    x: cx + trochoidR * (Math.cos(theta) * frame.tx + Math.sin(theta) * frame.nx),
    y: cy + trochoidR * (Math.cos(theta) * frame.ty + Math.sin(theta) * frame.ny),
    z: frame.z,
  };
}

function maybeClampCut(
  point: ToolpathPoint,
  partLoop: LoopPoint[] | undefined,
  minCenterDist: number | undefined
): ToolpathPoint {
  if (!partLoop || minCenterDist === undefined) return point;
  const clamped = clampToolCenterMinDistanceFromPart(
    partLoop,
    point.x,
    point.y,
    minCenterDist
  );
  return { ...point, x: clamped.x, y: clamped.y };
}

function blendLength(
  liftAmount: number,
  forwardIncrement: number,
  span: number,
  trochoidR: number
): number {
  if (liftAmount > 0) return Math.max(liftAmount, trochoidR * 0.25);
  return Math.min(forwardIncrement * 0.4, span * 0.35, Math.max(trochoidR, 0.5));
}

function pushPoints(target: ToolpathPoint[], zone: ToolpathPoint[], skipFirst = false): void {
  for (let i = 0; i < zone.length; i++) {
    if (skipFirst && i === 0) continue;
    target.push(zone[i]);
  }
}

// ─── Zone 1: Cutting ───────────────────────────────────────────────────────

function generateCuttingZone(
  arcGuide: ArcLengthGuide,
  cycle: number,
  increment: number,
  trochoidR: number,
  rotSign: number,
  z: number,
  maxAngleStep: number,
  partLoop: LoopPoint[] | undefined,
  minCenterDist: number | undefined
): { points: ToolpathPoint[]; exitPoint: ToolpathPoint; exitFrame: PlanarFrame } {
  const sStart = cycle * increment;
  const steps = Math.max(2, Math.ceil((2 * Math.PI) / maxAngleStep));
  const points: ToolpathPoint[] = [];
  let exitPoint: ToolpathPoint = { x: 0, y: 0, z };
  let exitFrame: PlanarFrame = { x: 0, y: 0, z, tx: 1, ty: 0, nx: 0, ny: 1 };

  for (let i = 0; i <= steps; i++) {
    const phase = i / steps;
    const sAlong = sStart + phase * increment;
    if (sAlong > arcGuide.totalLength + increment * 0.01) break;

    const theta = -Math.PI / 2 + rotSign * phase * 2 * Math.PI;
    const frame = normalizeFrame(sampleGuideAtS(arcGuide, sAlong));
    frame.z = z;

    let cut = trochoidCutPoint(frame, trochoidR, theta);
    cut = maybeClampCut(cut, partLoop, minCenterDist);
    points.push(cut);

    if (i === steps) {
      exitPoint = cut;
      exitFrame = frame;
    }
  }

  return { points, exitPoint, exitFrame };
}

// ─── Zone 2: Exit & lift ─────────────────────────────────────────────────────

function generateExitLiftZone(
  cutEnd: ToolpathPoint,
  frame: PlanarFrame,
  liftAmount: LiftAmount
): ToolpathPoint[] {
  if (liftAmount <= 0) return [];

  const points: ToolpathPoint[] = [];
  for (let i = 1; i <= EXIT_LIFT_STEPS; i++) {
    const t = i / EXIT_LIFT_STEPS;
    points.push({
      x: cutEnd.x + frame.nx * liftAmount * t,
      y: cutEnd.y + frame.ny * liftAmount * t,
      z: cutEnd.z + liftAmount * t,
    });
  }
  return points;
}

function liftedPosition(
  cutEnd: ToolpathPoint,
  frame: PlanarFrame,
  liftAmount: LiftAmount
): ToolpathPoint {
  if (liftAmount <= 0) return cutEnd;
  return {
    x: cutEnd.x + frame.nx * liftAmount,
    y: cutEnd.y + frame.ny * liftAmount,
    z: cutEnd.z + liftAmount,
  };
}

// ─── Zone 3: Return (high-feed non-cutting) ──────────────────────────────────

function generateReturnZone(from: ToolpathPoint, to: ToolpathPoint): ToolpathPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return [];

  const steps = Math.max(2, Math.ceil(len / RETURN_STEP_MM));
  const points: ToolpathPoint[] = [];

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: from.x + dx * t,
      y: from.y + dy * t,
      z: from.z + dz * t,
      rapid: true,
    });
  }
  return points;
}

// ─── Zone 4: Entry (tangential blend) ────────────────────────────────────────

function cubicHermitePoint(
  p0: ToolpathPoint,
  m0x: number,
  m0y: number,
  m0z: number,
  p1: ToolpathPoint,
  m1x: number,
  m1y: number,
  m1z: number,
  t: number
): ToolpathPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return {
    x: h00 * p0.x + h10 * m0x + h01 * p1.x + h11 * m1x,
    y: h00 * p0.y + h10 * m0y + h01 * p1.y + h11 * m1y,
    z: h00 * p0.z + h10 * m0z + h01 * p1.z + h11 * m1z,
  };
}

function generateEntryZone(
  approach: ToolpathPoint,
  cutStart: ToolpathPoint,
  returnDirX: number,
  returnDirY: number,
  cutTangentX: number,
  cutTangentY: number,
  chord: number
): ToolpathPoint[] {
  const scale = chord * 0.35;
  const m0x = returnDirX * scale;
  const m0y = returnDirY * scale;
  const m0z = 0;
  const m1x = cutTangentX * scale;
  const m1y = cutTangentY * scale;
  const m1z = 0;

  const points: ToolpathPoint[] = [];
  for (let i = 1; i <= ENTRY_ARC_STEPS; i++) {
    const t = i / ENTRY_ARC_STEPS;
    points.push(cubicHermitePoint(approach, m0x, m0y, m0z, cutStart, m1x, m1y, m1z, t));
  }
  return points;
}

function nextCycleCutStart(
  arcGuide: ArcLengthGuide,
  cycle: number,
  increment: number,
  trochoidR: number,
  z: number,
  partLoop: LoopPoint[] | undefined,
  minCenterDist: number | undefined
): { cutStart: ToolpathPoint; frame: PlanarFrame } {
  const frame = normalizeFrame(sampleGuideAtS(arcGuide, cycle * increment));
  frame.z = z;
  const theta = -Math.PI / 2;
  let cutStart = trochoidCutPoint(frame, trochoidR, theta);
  cutStart = maybeClampCut(cutStart, partLoop, minCenterDist);
  return { cutStart, frame };
}

function computeApproachPoint(
  cutStart: ToolpathPoint,
  frame: PlanarFrame,
  liftAmount: LiftAmount,
  blendLen: number,
  returnFrom: ToolpathPoint
): ToolpathPoint {
  if (liftAmount > 0) {
    return {
      x: cutStart.x + frame.nx * liftAmount,
      y: cutStart.y + frame.ny * liftAmount,
      z: cutStart.z + liftAmount,
    };
  }

  const dx = cutStart.x - returnFrom.x;
  const dy = cutStart.y - returnFrom.y;
  const len = Math.hypot(dx, dy) || 1;
  const dist = Math.min(blendLen, len * 0.9);
  return {
    x: cutStart.x - (dx / len) * dist,
    y: cutStart.y - (dy / len) * dist,
    z: cutStart.z,
  };
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Four-zone adaptive trochoidal pattern per pass:
 * 1. Cutting — rolling trochoid orbit
 * 2. Exit & lift — optional micro-retract (liftAmount == 0 skips this zone)
 * 3. Return — straight rapid traverse
 * 4. Entry — tangential Hermite blend into the next cut
 */
export function generateFourZoneAdaptivePath(
  innerGuideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  const { forwardIncrement: increment, slotClearance, z, liftAmount } = params;
  if (innerGuideLoop.length < 3 || increment <= 0 || slotClearance <= 0) return [];

  const trochoidR = slotClearance / 2;
  const maxAngleStep = params.maxAngleStep ?? (4 * Math.PI) / 180;
  const sampleSpacing = Math.min(increment / 4, trochoidR / 2, 0.5);
  const arcGuide = buildArcLengthGuide(innerGuideLoop, sampleSpacing);
  const { totalLength } = arcGuide;
  if (totalLength <= 0) return [];

  const ccwGuide = signedLoopArea2D(innerGuideLoop) >= 0;
  const rotSign = ccwGuide ? -1 : 1;
  const numCycles = Math.ceil(totalLength / increment);
  const points: ToolpathPoint[] = [];
  const partLoop = params.partLoop;
  const minCenterDist = params.minCenterDist;

  for (let cycle = 0; cycle < numCycles; cycle++) {
    const { points: cutPoints, exitPoint, exitFrame } = generateCuttingZone(
      arcGuide,
      cycle,
      increment,
      trochoidR,
      rotSign,
      z,
      maxAngleStep,
      partLoop,
      minCenterDist
    );

    pushPoints(points, cutPoints, points.length > 0);

    if (cycle >= numCycles - 1) continue;

    const { cutStart: nextStart, frame: nextFrame } = nextCycleCutStart(
      arcGuide,
      cycle + 1,
      increment,
      trochoidR,
      z,
      partLoop,
      minCenterDist
    );

    const retracted = liftedPosition(exitPoint, exitFrame, liftAmount);
    const exitLift = generateExitLiftZone(exitPoint, exitFrame, liftAmount);
    pushPoints(points, exitLift, true);

    const span = Math.hypot(nextStart.x - retracted.x, nextStart.y - retracted.y);
    const blendLen = blendLength(liftAmount, increment, span, trochoidR);
    const approach = computeApproachPoint(nextStart, nextFrame, liftAmount, blendLen, retracted);

    const returnMove = generateReturnZone(
      exitLift.length > 0 ? exitLift[exitLift.length - 1] : retracted,
      approach
    );
    pushPoints(points, returnMove, true);

    const rdx = approach.x - retracted.x;
    const rdy = approach.y - retracted.y;
    const rlen = Math.hypot(rdx, rdy) || 1;
    const entryArc = generateEntryZone(
      approach,
      nextStart,
      rdx / rlen,
      rdy / rlen,
      nextFrame.tx,
      nextFrame.ty,
      Math.max(span, blendLen)
    );
    pushPoints(points, entryArc, true);
  }

  return points;
}

export function generateConstantEngagementTrochoid(
  innerGuideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  return generateFourZoneAdaptivePath(innerGuideLoop, params);
}

export function generateTrochoidalOutlinePath(
  guideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  return generateFourZoneAdaptivePath(guideLoop, params);
}
