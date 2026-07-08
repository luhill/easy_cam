import type { LoopPoint, OperationDefaults, ToolpathPoint } from '../types/operations';
import {
  closestPointOnLoop2D,
  pointInPolygon2D,
  signedLoopArea2D,
  type OutlineWallSide,
} from './geometryProcessing';
import {
  advanceGuideArcLength,
  buildArcLengthGuide,
  extractGuideArcSegment,
  guideArcLengthBetween,
  sampleGuideAtS,
} from './trochoidalPath';
import { helixSegmentsPerRev, pathSampleSpacing, type ToolpathGlobalOptions } from './toolpathConfig';

/** Outside radius of the bored helix hole (mm). */
export function resolveBoreOuterRadius(settings: OperationDefaults): number {
  const toolD = Math.max(settings.toolDiameter, 0.1);
  return (settings.boreDiameterPercent / 100) * toolD * 0.5;
}

/** Tool-center helix radius at stock top (max bore diameter). */
export function resolveHelixRadius(settings: OperationDefaults): number {
  const toolR = Math.max(settings.toolDiameter, 0.1) / 2;
  return Math.max(resolveBoreOuterRadius(settings) - toolR, 0.05);
}

/** Tool-center helix radius at depth; taper applies below stock top (z < stockTopZ). */
export function helixRadiusAtZ(
  settings: OperationDefaults,
  z: number,
  stockTopZ: number
): number {
  const maxHelixR = resolveHelixRadius(settings);
  if (z >= stockTopZ - 1e-6) return maxHelixR;

  const depthBelowTop = stockTopZ - z;
  const taperRad = (settings.boreTaperAngleDeg * Math.PI) / 180;
  const boreOuterAtZ = resolveBoreOuterRadius(settings) - depthBelowTop * Math.tan(taperRad);
  const toolR = Math.max(settings.toolDiameter, 0.1) / 2;
  return Math.max(boreOuterAtZ - toolR, 0.05);
}

/**
 * Tool-center radius for a fresh bore segment that starts at `startHelixR` on `startZ`
 * and tapers inward with `boreTaperAngleDeg` as Z decreases (independent of stock top).
 */
export function helixRadiusTaperedFromStart(
  settings: OperationDefaults,
  z: number,
  startZ: number,
  startHelixR: number
): number {
  if (z >= startZ - 1e-6) return startHelixR;

  const depthBelowStart = startZ - z;
  const taperRad = (settings.boreTaperAngleDeg * Math.PI) / 180;
  return Math.max(startHelixR - depthBelowStart * Math.tan(taperRad), 0.05);
}

/** Pitch from helix angle for an arbitrary helix radius. */
export function helixPitchForRadius(helixR: number, angleDeg: number): number {
  const r = Math.max(helixR, 0.05);
  const angleRad = (angleDeg * Math.PI) / 180;
  return Math.max(2 * Math.PI * r * Math.tan(angleRad), 0.05);
}

/** One revolution Z drop from helix lead angle (degrees). */
export function helixPitchFromAngle(settings: OperationDefaults): number {
  return helixPitchForRadius(resolveHelixRadius(settings), settings.rampAngleDeg);
}

/**
 * Linear entry ramp along the approach direction into a contour start point.
 * Ramp ends at (endX, endY, toZ); starts upstream at rampAngleDeg above horizontal.
 */
export function generateLinearEntryRamp(
  endX: number,
  endY: number,
  approachTx: number,
  approachTy: number,
  fromZ: number,
  toZ: number,
  rampAngleDeg: number,
  feedRate?: number,
  steps = 16
): ToolpathPoint[] {
  if (Math.abs(fromZ - toZ) < 1e-5) {
    return [{ x: endX, y: endY, z: toZ, feedRate }];
  }

  const angleRad = (Math.max(rampAngleDeg, 0.5) * Math.PI) / 180;
  const dz = toZ - fromZ;
  const horizontalLen = Math.abs(dz) / Math.tan(angleRad);
  const tlen = Math.hypot(approachTx, approachTy) || 1;
  const tx = approachTx / tlen;
  const ty = approachTy / tlen;
  const startX = endX - tx * horizontalLen;
  const startY = endY - ty * horizontalLen;
  const segs = Math.max(4, steps);
  const points: ToolpathPoint[] = [];

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    points.push({
      x: startX + (endX - startX) * t,
      y: startY + (endY - startY) * t,
      z: fromZ + dz * t,
      feedRate,
    });
  }

  return points;
}

/** Layer-step helix radius — bore diameter equals slot width (slot clearance). */
export function resolveSlotHelixRadius(slotClearance: number): number {
  return Math.max(slotClearance / 2, 0.05);
}

/** +1 = CCW helix, −1 = CW helix. Adaptive outline bore and slotting helix. */
export function resolveHelixRotationDir(climbMilling: boolean): number {
  return climbMilling ? 1 : -1;
}

/** Interior helix bore: climb milling = CCW (+1), conventional = CW (−1). */
export function resolveInteriorHelixRotationDir(climbMilling: boolean): number {
  return climbMilling ? 1 : -1;
}

/** Tool-center helix radius for finishing an interior hole (nominal, unclamped). */
export function resolveInteriorHelixRadius(
  holeRadius: number,
  toolRadius: number,
  radialOffset: number
): number {
  return holeRadius - toolRadius - radialOffset;
}

/** Tapered interior helix radius at depth (narrows with Z below stock top). */
export function interiorHelixRadiusAtZ(
  cutRadius: number,
  z: number,
  stockTopZ: number,
  taperAngleDeg: number
): number {
  if (taperAngleDeg <= 0 || z >= stockTopZ - 1e-6) return cutRadius;
  const depthBelowTop = stockTopZ - z;
  const taperRad = (taperAngleDeg * Math.PI) / 180;
  return Math.max(cutRadius - depthBelowTop * Math.tan(taperRad), 0.01);
}

export function loopCentroid2D(loop: LoopPoint[]): { x: number; y: number } {
  if (loop.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of loop) {
    x += p.x;
    y += p.y;
  }
  return { x: x / loop.length, y: y / loop.length };
}

/** Enforce valid tool-start placement relative to the part outline. */
export function ensureEntryOutsidePart(
  partLoop: LoopPoint[],
  point: { x: number; y: number },
  minDist: number,
  wallSide: OutlineWallSide = 'exterior'
): { x: number; y: number } {
  const closest = closestPointOnLoop2D(point.x, point.y, partLoop);

  if (wallSide === 'interior') {
    if (!pointInPolygon2D(point.x, point.y, partLoop)) {
      const standoff = Math.max(minDist, 0.5);
      return {
        x: closest.x + closest.outX * standoff,
        y: closest.y + closest.outY * standoff,
      };
    }
    if (closest.dist >= minDist) return point;
    return {
      x: closest.x + closest.outX * minDist,
      y: closest.y + closest.outY * minDist,
    };
  }

  const inside = pointInPolygon2D(point.x, point.y, partLoop);
  if (!inside && closest.dist >= minDist) return point;

  const standoff = Math.max(minDist, 0.5);
  return {
    x: closest.x + closest.outX * standoff,
    y: closest.y + closest.outY * standoff,
  };
}

export function closestPointIndexOnPath(
  path: ToolpathPoint[],
  point: { x: number; y: number }
): number {
  if (path.length === 0) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = Math.hypot(path[i].x - point.x, path[i].y - point.y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function sampleStraightLeg(
  from: { x: number; y: number },
  to: { x: number; y: number },
  z: number,
  sampleSpacing: number
): LoopPoint[] {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  if (span <= sampleSpacing * 0.5) {
    return [
      { x: from.x, y: from.y, z },
      { x: to.x, y: to.y, z },
    ];
  }

  const steps = Math.max(1, Math.ceil(span / sampleSpacing));
  const points: LoopPoint[] = [{ x: from.x, y: from.y, z }];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    points.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z,
    });
  }
  points.push({ x: to.x, y: to.y, z });
  return points;
}

function distPointToLine(
  p: { x: number; y: number },
  origin: { x: number; y: number },
  dir: { x: number; y: number }
): number {
  const vx = p.x - origin.x;
  const vy = p.y - origin.y;
  return Math.abs(vx * -dir.y + vy * dir.x);
}

interface LineCurveFilletSolution {
  contactS: number;
  t1: { x: number; y: number };
  p2: { x: number; y: number };
  center: { x: number; y: number };
  turnSign: number;
  radius: number;
  error: number;
  /** Signed sweep from t1 to p2 matching approach entry and guide exit tangents. */
  sweep: number;
}

const FILLET_TANGENT_ALIGN = 0.965;

/** External tangent points from a point to a circle. */
function tangentPointsFromPointToCircle(
  point: { x: number; y: number },
  center: { x: number; y: number },
  radius: number
): { x: number; y: number }[] {
  const px = point.x - center.x;
  const py = point.y - center.y;
  const d2 = px * px + py * py;
  const d = Math.sqrt(d2);
  if (d <= radius + 1e-6) return [];

  const f = (radius * radius) / d2;
  const hx = center.x + f * px;
  const hy = center.y + f * py;
  const rPerp = radius * Math.sqrt(Math.max(0, (d2 - radius * radius) / d2));
  const nx = (-py / d) * rPerp;
  const ny = (px / d) * rPerp;
  return [
    { x: hx + nx, y: hy + ny },
    { x: hx - nx, y: hy - ny },
  ];
}

function minorArcSweep(
  center: { x: number; y: number },
  t1: { x: number; y: number },
  p2: { x: number; y: number }
): number {
  const a1 = Math.atan2(t1.y - center.y, t1.x - center.x);
  const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
  let sweep = a2 - a1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  return sweep;
}

/** Instantaneous travel direction on a circular arc at a point. */
function arcTangentAlongSweep(
  center: { x: number; y: number },
  pt: { x: number; y: number },
  sweep: number
): { x: number; y: number } {
  const rx = pt.x - center.x;
  const ry = pt.y - center.y;
  const len = Math.hypot(rx, ry) || 1;
  return sweep >= 0
    ? { x: -ry / len, y: rx / len }
    : { x: ry / len, y: -rx / len };
}

/**
 * Pick the arc sweep from t1 to p2 whose entry matches the approach line and
 * whose exit matches the guide traverse tangent (climb/conventional aware).
 */
function resolveFilletSweep(
  center: { x: number; y: number },
  t1: { x: number; y: number },
  p2: { x: number; y: number },
  d1: { x: number; y: number },
  d2: { x: number; y: number }
): number | null {
  const short = minorArcSweep(center, t1, p2);
  const candidates =
    Math.abs(Math.abs(short) - Math.PI) < 0.02 ? [short] : [short, -short];

  for (const sweep of candidates) {
    if (Math.abs(sweep) > Math.PI + 0.02) continue;
    const entry = arcTangentAlongSweep(center, t1, sweep);
    const exit = arcTangentAlongSweep(center, p2, sweep);
    if (
      entry.x * d1.x + entry.y * d1.y >= FILLET_TANGENT_ALIGN &&
      exit.x * d2.x + exit.y * d2.y >= FILLET_TANGENT_ALIGN
    ) {
      return sweep;
    }
  }

  return null;
}

function outwardNormalsToGuide(
  d2: { x: number; y: number },
  outN: { x: number; y: number }
): { x: number; y: number }[] {
  const leftN = { x: -d2.y, y: d2.x };
  const rightN = { x: d2.y, y: -d2.x };
  const leftOut = leftN.x * outN.x + leftN.y * outN.y;
  const rightOut = rightN.x * outN.x + rightN.y * outN.y;
  if (leftOut >= rightOut) {
    return leftOut >= 0.15 ? [leftN] : rightOut >= 0.15 ? [rightN] : [leftN, rightN];
  }
  return rightOut >= 0.15 ? [rightN] : leftOut >= 0.15 ? [leftN] : [rightN, leftN];
}

function validateLeadInFilletSolution(
  boreCenter: { x: number; y: number },
  solution: LineCurveFilletSolution,
  d2: { x: number; y: number },
  outN: { x: number; y: number }
): boolean {
  const { t1, p2, center, radius, sweep } = solution;

  const rcX = p2.x - center.x;
  const rcY = p2.y - center.y;
  if (Math.abs(rcX * d2.x + rcY * d2.y) > radius * 0.08) return false;

  const legLen = Math.hypot(t1.x - boreCenter.x, t1.y - boreCenter.y);
  if (legLen < 1e-4) return false;
  const d1x = (t1.x - boreCenter.x) / legLen;
  const d1y = (t1.y - boreCenter.y) / legLen;
  const rtX = t1.x - center.x;
  const rtY = t1.y - center.y;
  if (Math.abs(rtX * d1x + rtY * d1y) > radius * 0.08) return false;

  if (Math.abs(sweep) < (3 * Math.PI) / 180 || Math.abs(sweep) > (5 * Math.PI) / 6) {
    return false;
  }

  const entry = arcTangentAlongSweep(center, t1, sweep);
  const exit = arcTangentAlongSweep(center, p2, sweep);
  if (entry.x * d1x + entry.y * d1y < FILLET_TANGENT_ALIGN) return false;
  if (exit.x * d2.x + exit.y * d2.y < FILLET_TANGENT_ALIGN) return false;

  const midAngle = Math.atan2(t1.y - center.y, t1.x - center.x) + sweep / 2;
  const mid = {
    x: center.x + Math.cos(midAngle) * radius,
    y: center.y + Math.sin(midAngle) * radius,
  };
  const bulgeOut = (mid.x - p2.x) * outN.x + (mid.y - p2.y) * outN.y;
  if (bulgeOut < radius * 0.08) return false;

  const centerOut = (center.x - p2.x) * outN.x + (center.y - p2.y) * outN.y;
  if (centerOut < radius * 0.5) return false;

  const boreOut = (boreCenter.x - p2.x) * outN.x + (boreCenter.y - p2.y) * outN.y;
  if (boreOut < -radius * 0.1) return false;

  return true;
}

/**
 * Fillet with a free approach line from the bore center to the tangent point.
 * Center is offset along the guide outward normal so the arc bulges outside the part.
 */
function evalFreeApproachFilletAtS(
  boreCenter: { x: number; y: number },
  guide: ReturnType<typeof buildArcLengthGuide>,
  contactS: number,
  radius: number,
  guideTraverseSign: number
): LineCurveFilletSolution | null {
  const forward = guideTraverseSign >= 0;
  const tangentSign = forward ? 1 : -1;
  const frame = sampleGuideAtS(guide, contactS);
  const d2Len = Math.hypot(frame.tx, frame.ty) || 1;
  const d2 = { x: (frame.tx * tangentSign) / d2Len, y: (frame.ty * tangentSign) / d2Len };
  const p2 = { x: frame.x, y: frame.y };
  const outLen = Math.hypot(frame.nx, frame.ny) || 1;
  const outN = { x: frame.nx / outLen, y: frame.ny / outLen };

  let best: LineCurveFilletSolution | null = null;
  let bestScore = Infinity;

  for (const n2 of outwardNormalsToGuide(d2, outN)) {
    const center = {
      x: p2.x + n2.x * radius,
      y: p2.y + n2.y * radius,
    };

    const tangents = tangentPointsFromPointToCircle(boreCenter, center, radius);
    for (const t1 of tangents) {
      const legLen = Math.hypot(t1.x - boreCenter.x, t1.y - boreCenter.y);
      if (legLen < 1e-4) continue;
      const d1 = {
        x: (t1.x - boreCenter.x) / legLen,
        y: (t1.y - boreCenter.y) / legLen,
      };
      const sweep = resolveFilletSweep(center, t1, p2, d1, d2);
      if (sweep === null) continue;

      const candidate: LineCurveFilletSolution = {
        contactS,
        t1,
        p2,
        center,
        turnSign: sweep >= 0 ? 1 : -1,
        radius,
        error: 0,
        sweep,
      };
      if (!validateLeadInFilletSolution(boreCenter, candidate, d2, outN)) continue;

      const lineErr = Math.abs(distPointToLine(center, boreCenter, d1) - radius);
      if (lineErr < bestScore) {
        bestScore = lineErr;
        best = { ...candidate, error: lineErr };
      }
    }
  }

  if (!best || bestScore > Math.max(radius * 0.05, 0.08)) return null;
  return best;
}

/** Scan backward from the outline join station for a tangent fillet onto the guide. */
function findLeadInFillet(
  boreCenter: { x: number; y: number },
  guide: ReturnType<typeof buildArcLengthGuide>,
  outlineJoinS: number,
  guideTraverseSign: number,
  radius: number,
  sampleSpacing: number
): LineCurveFilletSolution | null {
  if (guide.totalLength <= 0) return null;

  const forward = guideTraverseSign >= 0;
  const maxBack = Math.min(
    guide.totalLength * 0.2,
    Math.max(radius * 8, sampleSpacing * 32)
  );
  const scanStep = Math.max(sampleSpacing * 0.35, radius * 0.06, 0.06);

  let best: LineCurveFilletSolution | null = null;
  let bestScore = Infinity;

  const maxForwardArc = Math.max(radius * 6, sampleSpacing * 40);

  for (let back = 0; back <= maxBack + scanStep * 0.5; back += scanStep) {
    const contactS = advanceGuideArcLength(guide, outlineJoinS, back, !forward);
    const candidate = evalFreeApproachFilletAtS(
      boreCenter,
      guide,
      contactS,
      radius,
      guideTraverseSign
    );
    if (!candidate) continue;

    const forwardToJoin = guideArcLengthBetween(
      guide.totalLength,
      candidate.contactS,
      outlineJoinS,
      forward
    );
    const reverseToJoin = guideArcLengthBetween(
      guide.totalLength,
      candidate.contactS,
      outlineJoinS,
      !forward
    );
    if (forwardToJoin > maxForwardArc || reverseToJoin + 1e-3 < forwardToJoin) continue;

    const score = back + candidate.error * 10 + Math.abs(candidate.radius - radius) * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function sampleTangentFilletArc(
  center: { x: number; y: number },
  radius: number,
  t1: { x: number; y: number },
  p2: { x: number; y: number },
  sweep: number,
  z: number,
  sampleSpacing: number
): LoopPoint[] {
  if (Math.abs(sweep) < 1e-6) {
    return [
      { x: t1.x, y: t1.y, z },
      { x: p2.x, y: p2.y, z },
    ];
  }

  const a1 = Math.atan2(t1.y - center.y, t1.x - center.x);
  const arcLen = Math.abs(sweep) * radius;
  const step = Math.min(sampleSpacing, Math.max(radius / 16, 0.05));
  const steps = Math.max(8, Math.ceil(arcLen / step));
  const points: LoopPoint[] = [{ x: t1.x, y: t1.y, z }];

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const ang = a1 + sweep * t;
    points.push({
      x: center.x + Math.cos(ang) * radius,
      y: center.y + Math.sin(ang) * radius,
      z,
    });
  }

  points.push({ x: p2.x, y: p2.y, z });
  return points;
}

function buildFilletFromSolution(
  boreCenter: { x: number; y: number },
  solution: LineCurveFilletSolution,
  trochArcGuide: ReturnType<typeof buildArcLengthGuide>,
  joinS: number,
  guideTraverseSign: number,
  sampleSpacing: number,
  z: number
): LoopPoint[] {
  const { contactS, t1, p2, center, radius, sweep } = solution;
  const straightLeg = sampleStraightLeg(boreCenter, t1, z, sampleSpacing);
  const filletPts = sampleTangentFilletArc(center, radius, t1, p2, sweep, z, sampleSpacing);

  const forward = guideTraverseSign >= 0;
  const forwardArc = guideArcLengthBetween(
    trochArcGuide.totalLength,
    contactS,
    joinS,
    forward
  );
  const maxForwardArc = Math.max(radius * 6, sampleSpacing * 40);
  const continuation =
    forwardArc <= maxForwardArc
      ? extractGuideArcSegment(
          trochArcGuide,
          contactS,
          joinS,
          guideTraverseSign,
          sampleSpacing,
          z
        )
      : [{ x: p2.x, y: p2.y, z }];
  const contStart =
    continuation.length > 0 &&
    Math.hypot(continuation[0].x - p2.x, continuation[0].y - p2.y) < sampleSpacing * 0.25
      ? 1
      : 0;

  return [...straightLeg, ...filletPts, ...continuation.slice(contStart)];
}

/**
 * Corner-based fillet at the outline join station with backward trim on the guide.
 */
function filletEntryToSlotCenterlineCornerApprox(
  boreCenter: { x: number; y: number },
  trochArcGuide: ReturnType<typeof buildArcLengthGuide>,
  outlineJoinS: number,
  guideTraverseSign: number,
  filletRadius: number,
  sampleSpacing: number,
  z: number
): LoopPoint[] | null {
  const forward = guideTraverseSign >= 0;
  const tangentSign = forward ? 1 : -1;
  const joinPt = sampleGuideAtS(trochArcGuide, outlineJoinS);

  const atJoin = evalFreeApproachFilletAtS(
    boreCenter,
    trochArcGuide,
    outlineJoinS,
    filletRadius,
    guideTraverseSign
  );
  if (atJoin) {
    return buildFilletFromSolution(
      boreCenter,
      atJoin,
      trochArcGuide,
      outlineJoinS,
      guideTraverseSign,
      sampleSpacing,
      z
    );
  }

  const inX = joinPt.x - boreCenter.x;
  const inY = joinPt.y - boreCenter.y;
  const inAvail = Math.hypot(inX, inY);
  if (inAvail < sampleSpacing * 0.1) return null;

  const d1x = inX / inAvail;
  const d1y = inY / inAvail;
  let d2x = joinPt.tx * tangentSign;
  let d2y = joinPt.ty * tangentSign;
  const d2Len0 = Math.hypot(d2x, d2y) || 1;
  d2x /= d2Len0;
  d2y /= d2Len0;

  let dot = Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y));
  let turn = Math.acos(dot);
  if (turn < (2 * Math.PI) / 180 || turn > Math.PI - (2 * Math.PI) / 180) {
    return null;
  }

  let half = turn / 2;
  let trim = filletRadius / Math.tan(half);
  let radius = filletRadius;
  const maxInTrim = inAvail * 0.95;
  if (trim > maxInTrim) {
    radius = maxInTrim * Math.tan(half);
    trim = maxInTrim;
  }
  if (radius < sampleSpacing * 0.05) return null;

  let resumeS = advanceGuideArcLength(trochArcGuide, outlineJoinS, trim, !forward);
  let curveFrame = sampleGuideAtS(trochArcGuide, resumeS);
  d2x = curveFrame.tx * tangentSign;
  d2y = curveFrame.ty * tangentSign;
  const d2Len = Math.hypot(d2x, d2y) || 1;
  d2x /= d2Len;
  d2y /= d2Len;

  dot = Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y));
  turn = Math.acos(dot);
  half = turn / 2;
  trim = radius / Math.tan(half);
  if (trim > maxInTrim) {
    radius = maxInTrim * Math.tan(half);
    trim = maxInTrim;
  }

  resumeS = advanceGuideArcLength(trochArcGuide, outlineJoinS, trim, !forward);
  curveFrame = sampleGuideAtS(trochArcGuide, resumeS);
  d2x = curveFrame.tx * tangentSign;
  d2y = curveFrame.ty * tangentSign;
  const d2LenFinal = Math.hypot(d2x, d2y) || 1;
  d2x /= d2LenFinal;
  d2y /= d2LenFinal;

  const t1 = { x: joinPt.x - d1x * trim, y: joinPt.y - d1y * trim };
  const p2 = { x: curveFrame.x, y: curveFrame.y };
  const p2OutLen = Math.hypot(curveFrame.nx, curveFrame.ny) || 1;
  const p2OutN = { x: curveFrame.nx / p2OutLen, y: curveFrame.ny / p2OutLen };
  const d1 = { x: d1x, y: d1y };
  const d2 = { x: d2x, y: d2y };

  let candidate: LineCurveFilletSolution | null = null;
  for (const n2 of outwardNormalsToGuide(d2, p2OutN)) {
    const center = { x: p2.x + n2.x * radius, y: p2.y + n2.y * radius };
    const sweep = resolveFilletSweep(center, t1, p2, d1, d2);
    if (sweep === null) continue;
    const tryCandidate: LineCurveFilletSolution = {
      contactS: resumeS,
      t1,
      p2,
      center,
      turnSign: sweep >= 0 ? 1 : -1,
      radius,
      error: 0,
      sweep,
    };
    if (validateLeadInFilletSolution(boreCenter, tryCandidate, d2, p2OutN)) {
      candidate = tryCandidate;
      break;
    }
  }
  if (!candidate) return null;

  return buildFilletFromSolution(
    boreCenter,
    candidate,
    trochArcGuide,
    outlineJoinS,
    guideTraverseSign,
    sampleSpacing,
    z
  );
}

/**
 * Tangent fillet from the bore center onto the slot centerline, ending at the
 * outline join station where the closed slot trochoid begins.
 */
function filletEntryToSlotCenterline(
  boreCenter: { x: number; y: number },
  trochArcGuide: ReturnType<typeof buildArcLengthGuide>,
  outlineJoinS: number,
  guideTraverseSign: number,
  filletRadius: number,
  sampleSpacing: number,
  z: number
): LoopPoint[] | null {
  let solution: LineCurveFilletSolution | null = null;

  for (let scale = 1; scale >= 0.35; scale -= 0.05) {
    const tryR = filletRadius * scale;
    solution = findLeadInFillet(
      boreCenter,
      trochArcGuide,
      outlineJoinS,
      guideTraverseSign,
      tryR,
      sampleSpacing
    );
    if (solution) break;
  }

  if (solution) {
    return buildFilletFromSolution(
      boreCenter,
      solution,
      trochArcGuide,
      outlineJoinS,
      guideTraverseSign,
      sampleSpacing,
      z
    );
  }

  return filletEntryToSlotCenterlineCornerApprox(
    boreCenter,
    trochArcGuide,
    outlineJoinS,
    guideTraverseSign,
    filletRadius,
    sampleSpacing,
    z
  );
}

/**
 * Hermite spline from the bore start to the slot join, tangent to the outline
 * traverse direction (climb / conventional) at the join.
 */
export function buildSplineEntryGuide(
  toolStart: { x: number; y: number },
  slotJoin: { x: number; y: number },
  exitTangent: { x: number; y: number },
  sampleSpacing: number,
  z: number
): LoopPoint[] {
  const dx = slotJoin.x - toolStart.x;
  const dy = slotJoin.y - toolStart.y;
  const chord = Math.hypot(dx, dy);
  if (chord <= 1e-6) {
    return [{ x: slotJoin.x, y: slotJoin.y, z }];
  }
  if (chord <= sampleSpacing * 0.25) {
    return [
      { x: toolStart.x, y: toolStart.y, z },
      { x: slotJoin.x, y: slotJoin.y, z },
    ];
  }

  const startHandle = Math.max(chord * 0.55, sampleSpacing * 2);
  const endHandle = Math.max(chord * 0.72, sampleSpacing * 2.5);
  const t0 = { x: (dx / chord) * startHandle, y: (dy / chord) * startHandle };
  const tLen = Math.hypot(exitTangent.x, exitTangent.y) || 1;
  const t1 = {
    x: (exitTangent.x / tLen) * endHandle,
    y: (exitTangent.y / tLen) * endHandle,
  };

  const steps = Math.max(8, Math.ceil(chord / sampleSpacing));
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
      x: h00 * toolStart.x + h10 * t0.x + h01 * slotJoin.x + h11 * t1.x,
      y: h00 * toolStart.y + h10 * t0.y + h01 * slotJoin.y + h11 * t1.y,
      z,
    });
  }
  return points;
}

/**
 * Spline lead-in merged with a full slot-center loop unwrap into one polyline.
 * Trochoids sample a single open arc-length guide so frames stay continuous.
 */
export function buildUnifiedEntryCenterlineGuide(
  splineGuide: LoopPoint[],
  trochArcGuide: ReturnType<typeof buildArcLengthGuide>,
  trochoidStartS: number,
  guideTraverseSign: number,
  sampleSpacing: number,
  z: number
): LoopPoint[] {
  const loopLen = trochArcGuide.totalLength;
  if (splineGuide.length === 0) return splineGuide;
  if (loopLen <= 0) return splineGuide;

  const forward = guideTraverseSign >= 0;
  const loopEndS = advanceGuideArcLength(
    trochArcGuide,
    trochoidStartS,
    Math.max(loopLen - sampleSpacing * 0.5, sampleSpacing),
    forward
  );
  const loopPolyline = extractGuideArcSegment(
    trochArcGuide,
    trochoidStartS,
    loopEndS,
    guideTraverseSign,
    sampleSpacing,
    z
  );
  if (loopPolyline.length === 0) return splineGuide;

  const last = splineGuide[splineGuide.length - 1];
  const joinDist = Math.hypot(last.x - loopPolyline[0].x, last.y - loopPolyline[0].y);
  const tail = joinDist <= sampleSpacing * 0.75 ? loopPolyline.slice(1) : loopPolyline;
  return [...splineGuide, ...tail];
}

/**
 * Hermite spline lead-in plus one loop stepover on the slot centerline so open
 * trochoids can hand off to the closed outline path without a straight stitch.
 * @deprecated Prefer buildUnifiedEntryCenterlineGuide for trochoid generation.
 */
export function buildSplineToSlotTrochoidGuide(
  toolStart: { x: number; y: number },
  slotJoin: { x: number; y: number },
  exitTangent: { x: number; y: number },
  trochArcGuide: ReturnType<typeof buildArcLengthGuide>,
  trochoidStartS: number,
  guideTraverseSign: number,
  loopStepover: number,
  sampleSpacing: number,
  z: number
): LoopPoint[] {
  const spline = buildSplineEntryGuide(
    toolStart,
    slotJoin,
    exitTangent,
    sampleSpacing,
    z
  );
  if (loopStepover <= 1e-6 || trochArcGuide.totalLength <= 0) return spline;

  const forward = guideTraverseSign >= 0;
  const loopEndS = advanceGuideArcLength(
    trochArcGuide,
    trochoidStartS,
    loopStepover,
    forward
  );
  const loopTail = extractGuideArcSegment(
    trochArcGuide,
    trochoidStartS,
    loopEndS,
    guideTraverseSign,
    sampleSpacing,
    z
  );
  if (loopTail.length === 0) return spline;

  const last = spline[spline.length - 1];
  const joinDist = Math.hypot(last.x - loopTail[0].x, last.y - loopTail[0].y);
  if (joinDist <= sampleSpacing * 0.75) {
    return [...spline, ...loopTail.slice(1)];
  }
  return [...spline, ...loopTail];
}

/**
 * Lead-in centerline from the bore center to the outline join station on the
 * slot center guide, with an optional fillet onto the guide.
 */
export function buildBoreLeadInGuide(
  boreCenter: { x: number; y: number },
  trochArcGuide: ReturnType<typeof buildArcLengthGuide>,
  outlineJoinS: number,
  guideTraverseSign: number,
  sampleSpacing: number,
  z: number,
  filletRadius = 0
): LoopPoint[] {
  if (filletRadius > 0) {
    const filleted = filletEntryToSlotCenterline(
      boreCenter,
      trochArcGuide,
      outlineJoinS,
      guideTraverseSign,
      filletRadius,
      sampleSpacing,
      z
    );
    if (filleted && filleted.length >= 2) {
      return filleted;
    }
  }

  const joinPt = sampleGuideAtS(trochArcGuide, outlineJoinS);
  const straightLeg = sampleStraightLeg(boreCenter, joinPt, z, sampleSpacing);
  return straightLeg.length >= 1 ? straightLeg : [{ x: boreCenter.x, y: boreCenter.y, z }];
}

/**
 * Open guide from the bore exit to the slot join — follows the slot-center loop
 * when possible, with an initial leg from the last bore point when off-guide.
 */
export function buildBoreToSlotConnectorGuide(
  lastPt: { x: number; y: number; z: number },
  trochArcGuide: ReturnType<typeof buildArcLengthGuide>,
  connectorStartS: number,
  joinS: number,
  guideTraverseSign: number,
  sampleSpacing: number,
  z: number
): LoopPoint[] {
  const guidePts = extractGuideArcSegment(
    trochArcGuide,
    connectorStartS,
    joinS,
    guideTraverseSign,
    sampleSpacing,
    z
  );

  if (guidePts.length === 0) return [];

  const distToGuide = Math.hypot(lastPt.x - guidePts[0].x, lastPt.y - guidePts[0].y);
  if (distToGuide > sampleSpacing * 1.2) {
    return [{ x: lastPt.x, y: lastPt.y, z }, ...guidePts];
  }

  return guidePts;
}

/** Shortest open guide: straight entry to the join on the slot-center loop. */
export function buildEntryConnectorGuide(
  entry: { x: number; y: number },
  slotCenterGuide: LoopPoint[],
  joinS: number,
  _guideTraverseSign: number,
  globals: ToolpathGlobalOptions
): LoopPoint[] {
  const sampleSpacing = pathSampleSpacing(globals.resolution);
  const guide = buildArcLengthGuide(slotCenterGuide, sampleSpacing);
  if (guide.totalLength <= 0) {
    return [{ x: entry.x, y: entry.y, z: 0 }];
  }

  const joinPt = sampleGuideAtS(guide, joinS);
  const span = Math.hypot(joinPt.x - entry.x, joinPt.y - entry.y);
  if (span <= sampleSpacing * 1.5) {
    return [
      { x: entry.x, y: entry.y, z: joinPt.z },
      { x: joinPt.x, y: joinPt.y, z: joinPt.z },
    ];
  }

  const points: LoopPoint[] = [{ x: entry.x, y: entry.y, z: joinPt.z }];
  const steps = Math.max(1, Math.ceil(span / sampleSpacing));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: entry.x + (joinPt.x - entry.x) * t,
      y: entry.y + (joinPt.y - entry.y) * t,
      z: joinPt.z,
    });
  }
  return points;
}

/** 2D expanding spiral at fixed Z, ending at a target angle and radius. */
export function generateExpandingSpiralToAngle(
  center: { x: number; y: number },
  startRadius: number,
  targetRadius: number,
  z: number,
  radialStepPerRev: number,
  rotDir: number,
  segmentsPerRev: number,
  endAngle: number,
  feedRate?: number
): ToolpathPoint[] {
  const startR = Math.max(startRadius, 0.05);
  const targetR = Math.max(targetRadius, startR);
  if (targetR <= startR + 1e-4 || radialStepPerRev <= 0) return [];

  const segments = Math.max(8, segmentsPerRev);
  const dr = radialStepPerRev / segments;
  const deltaR = targetR - startR;
  const revs = Math.max(1, Math.ceil(deltaR / radialStepPerRev));
  let angle = endAngle - rotDir * revs * 2 * Math.PI;
  let r = startR;
  const points: ToolpathPoint[] = [];

  while (r < targetR - 1e-4) {
    for (let i = 0; i < segments; i++) {
      angle += rotDir * ((Math.PI * 2) / segments);
      r = Math.min(r + dr, targetR);
      points.push({
        x: center.x + Math.cos(angle) * r,
        y: center.y + Math.sin(angle) * r,
        z,
        feedRate,
      });
      if (r >= targetR - 1e-4) break;
    }
  }

  if (points.length > 0) {
    const last = points[points.length - 1];
    last.x = center.x + Math.cos(endAngle) * targetR;
    last.y = center.y + Math.sin(endAngle) * targetR;
  }

  return points;
}

/** 2D contracting spiral at fixed Z to narrow a bore to the slot helix radius. */
export function generateContractingSpiral(
  center: { x: number; y: number },
  startRadius: number,
  targetRadius: number,
  z: number,
  radialStepPerRev: number,
  rotDir: number,
  segmentsPerRev: number,
  startAngle: number,
  feedRate?: number
): ToolpathPoint[] {
  const startR = Math.max(startRadius, 0.05);
  const targetR = Math.max(targetRadius, 0.05);
  if (startR <= targetR + 1e-4 || radialStepPerRev <= 0) return [];

  const segments = Math.max(8, segmentsPerRev);
  const dr = radialStepPerRev / segments;
  const points: ToolpathPoint[] = [];
  let r = startR;
  let angle = startAngle;

  while (r > targetR + 1e-4) {
    for (let i = 0; i < segments; i++) {
      angle += rotDir * ((Math.PI * 2) / segments);
      r = Math.max(r - dr, targetR);
      points.push({
        x: center.x + Math.cos(angle) * r,
        y: center.y + Math.sin(angle) * r,
        z,
        feedRate,
      });
      if (r <= targetR + 1e-4) break;
    }
  }

  return points;
}

/** 2D contracting spiral at fixed Z, ending at a target angle and radius. */
export function generateContractingSpiralToAngle(
  center: { x: number; y: number },
  startRadius: number,
  targetRadius: number,
  z: number,
  radialStepPerRev: number,
  rotDir: number,
  segmentsPerRev: number,
  endAngle: number,
  feedRate?: number
): ToolpathPoint[] {
  const startR = Math.max(startRadius, 0.05);
  const targetR = Math.max(targetRadius, 0.05);
  if (startR <= targetR + 1e-4 || radialStepPerRev <= 0) return [];

  const segments = Math.max(8, segmentsPerRev);
  const dr = radialStepPerRev / segments;
  const deltaR = startR - targetR;
  const revs = Math.max(1, Math.ceil(deltaR / radialStepPerRev));
  let angle = endAngle + rotDir * revs * 2 * Math.PI;
  let r = startR;
  const points: ToolpathPoint[] = [];

  while (r > targetR + 1e-4) {
    for (let i = 0; i < segments; i++) {
      angle += rotDir * ((Math.PI * 2) / segments);
      r = Math.max(r - dr, targetR);
      points.push({
        x: center.x + Math.cos(angle) * r,
        y: center.y + Math.sin(angle) * r,
        z,
        feedRate,
      });
      if (r <= targetR + 1e-4) break;
    }
  }

  if (points.length > 0) {
    const last = points[points.length - 1];
    last.x = center.x + Math.cos(endAngle) * targetR;
    last.y = center.y + Math.sin(endAngle) * targetR;
  }

  return points;
}

/** Radial spiral along a fixed bearing from center, ending on a target radius. */
export function generateRadialSpiralBetweenRadii(
  center: { x: number; y: number },
  startRadius: number,
  targetRadius: number,
  angle: number,
  z: number,
  radialStepPerRev: number,
  rotDir: number,
  segmentsPerRev: number,
  feedRate?: number
): ToolpathPoint[] {
  if (Math.abs(startRadius - targetRadius) < 1e-3) return [];

  if (targetRadius > startRadius) {
    return generateExpandingSpiralToAngle(
      center,
      startRadius,
      targetRadius,
      z,
      radialStepPerRev,
      rotDir,
      segmentsPerRev,
      angle,
      feedRate
    );
  }

  return generateContractingSpiralToAngle(
    center,
    startRadius,
    targetRadius,
    z,
    radialStepPerRev,
    rotDir,
    segmentsPerRev,
    angle,
    feedRate
  );
}

/** Tool center follows slot-center guide points at fixed Z. */
export function generateSlotCenterTraverse(
  guidePts: LoopPoint[],
  feedRate?: number
): ToolpathPoint[] {
  if (guidePts.length === 0) return [];
  return guidePts.map((p) => ({ x: p.x, y: p.y, z: p.z, feedRate }));
}

/** Spiral outward or inward at bore center until the tool orbit matches slot width. */
export function adjustBoreRadiusToSlotWidth(
  center: { x: number; y: number },
  currentRadius: number,
  slotRadius: number,
  z: number,
  radialStepPerRev: number,
  rotDir: number,
  segmentsPerRev: number,
  startAngle: number,
  feedRate?: number
): ToolpathPoint[] {
  if (Math.abs(currentRadius - slotRadius) < 1e-3) return [];

  if (currentRadius < slotRadius) {
    return generateExpandingSpiral(
      center,
      currentRadius,
      slotRadius,
      z,
      radialStepPerRev,
      rotDir,
      segmentsPerRev,
      startAngle,
      feedRate
    );
  }

  return generateContractingSpiral(
    center,
    currentRadius,
    slotRadius,
    z,
    radialStepPerRev,
    rotDir,
    segmentsPerRev,
    startAngle,
    feedRate
  );
}

/** Shortest angular span in the helix rotation direction, never exceeding one revolution. */
export function boreAlignAngleDelta(
  startAngle: number,
  targetAngle: number,
  rotDir: number
): number {
  let delta = targetAngle - startAngle;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  if (Math.abs(delta) < 1e-4) return 0;

  if (rotDir >= 0) {
    if (delta < 0) delta += 2 * Math.PI;
  } else if (delta > 0) {
    delta -= 2 * Math.PI;
  }
  return delta;
}

/**
 * Fixed-radius orbit around the bore center (≤ one revolution) until the tool
 * reaches the angular position where the slot trochoid path begins.
 */
export function generateBoreAlignOrbit(
  center: { x: number; y: number },
  radius: number,
  z: number,
  startAngle: number,
  targetAngle: number,
  rotDir: number,
  segmentsPerRev: number,
  feedRate?: number
): ToolpathPoint[] {
  const r = Math.max(radius, 0.05);
  const delta = boreAlignAngleDelta(startAngle, targetAngle, rotDir);
  if (Math.abs(delta) < 1e-4) return [];

  const segments = Math.max(4, Math.ceil((Math.abs(delta) / (2 * Math.PI)) * segmentsPerRev));
  const points: ToolpathPoint[] = [];

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + delta * t;
    points.push({
      x: center.x + Math.cos(angle) * r,
      y: center.y + Math.sin(angle) * r,
      z,
      feedRate,
    });
  }

  return points;
}

/**
 * Spiral around a center from one polar position to another (≤ one revolution
 * of azimuth change in the helix rotation direction).
 */
export function generateSpiralBetweenPolarPositions(
  center: { x: number; y: number },
  startRadius: number,
  startAngle: number,
  endRadius: number,
  endAngle: number,
  z: number,
  radialStepPerRev: number,
  rotDir: number,
  segmentsPerRev: number,
  feedRate?: number
): ToolpathPoint[] {
  const deltaR = endRadius - startRadius;
  const deltaAngle = boreAlignAngleDelta(startAngle, endAngle, rotDir);
  if (Math.abs(deltaR) < 1e-4 && Math.abs(deltaAngle) < 1e-4) return [];

  const revsFromR =
    Math.abs(deltaR) > 1e-4 ? Math.ceil(Math.abs(deltaR) / radialStepPerRev) : 0;
  const revsFromAngle =
    Math.abs(deltaAngle) > 1e-4 ? Math.ceil(Math.abs(deltaAngle) / (2 * Math.PI)) : 0;
  const revs = Math.max(1, revsFromR, revsFromAngle);
  const totalSegments = revs * Math.max(8, segmentsPerRev);
  const points: ToolpathPoint[] = [];

  for (let i = 1; i <= totalSegments; i++) {
    const t = i / totalSegments;
    const r = startRadius + deltaR * t;
    const angle = startAngle + deltaAngle * t;
    points.push({
      x: center.x + Math.cos(angle) * r,
      y: center.y + Math.sin(angle) * r,
      z,
      feedRate,
    });
  }

  return points;
}

/** Bore bottom → first lead-in trochoid sample via a spiral around the bore center. */
export function generateBoreBottomToLeadInTransition(
  boreCenter: { x: number; y: number },
  boreBottomPt: { x: number; y: number },
  firstLeadInPt: { x: number; y: number },
  z: number,
  radialStepPerRev: number,
  rotDir: number,
  segmentsPerRev: number,
  feedRate?: number
): ToolpathPoint[] {
  const startR = Math.hypot(boreBottomPt.x - boreCenter.x, boreBottomPt.y - boreCenter.y);
  const startAngle = Math.atan2(boreBottomPt.y - boreCenter.y, boreBottomPt.x - boreCenter.x);
  const endR = Math.hypot(firstLeadInPt.x - boreCenter.x, firstLeadInPt.y - boreCenter.y);
  const endAngle = Math.atan2(firstLeadInPt.y - boreCenter.y, firstLeadInPt.x - boreCenter.x);

  return generateSpiralBetweenPolarPositions(
    boreCenter,
    startR,
    startAngle,
    endR,
    endAngle,
    z,
    radialStepPerRev,
    rotDir,
    segmentsPerRev,
    feedRate
  );
}

/** 2D expanding spiral at fixed Z to widen a bore to the slot helix radius. */
export function generateExpandingSpiral(
  center: { x: number; y: number },
  startRadius: number,
  targetRadius: number,
  z: number,
  radialStepPerRev: number,
  rotDir: number,
  segmentsPerRev: number,
  startAngle: number,
  feedRate?: number
): ToolpathPoint[] {
  const startR = Math.max(startRadius, 0.05);
  const targetR = Math.max(targetRadius, startR);
  if (targetR <= startR + 1e-4 || radialStepPerRev <= 0) return [];

  const segments = Math.max(8, segmentsPerRev);
  const dr = radialStepPerRev / segments;
  const points: ToolpathPoint[] = [];
  let r = startR;
  let angle = startAngle;

  while (r < targetR - 1e-4) {
    for (let i = 0; i < segments; i++) {
      angle += rotDir * ((Math.PI * 2) / segments);
      r = Math.min(r + dr, targetR);
      points.push({
        x: center.x + Math.cos(angle) * r,
        y: center.y + Math.sin(angle) * r,
        z,
        feedRate,
      });
      if (r >= targetR - 1e-4) break;
    }
  }

  return points;
}

/** Exactly one full revolution at fixed Z and radius. */
export function generateFullRevolutionOrbit(
  center: { x: number; y: number },
  radius: number,
  z: number,
  startAngle: number,
  rotDir: number,
  segmentsPerRev: number,
  feedRate?: number
): { points: ToolpathPoint[]; endAngle: number } {
  const r = Math.max(radius, 0.01);
  const segments = Math.max(8, segmentsPerRev);
  const points: ToolpathPoint[] = [];
  let angle = startAngle;

  for (let i = 0; i < segments; i++) {
    angle += rotDir * ((Math.PI * 2) / segments);
    points.push({
      x: center.x + Math.cos(angle) * r,
      y: center.y + Math.sin(angle) * r,
      z,
      feedRate,
    });
  }

  return { points, endAngle: angle };
}

export function isGuideOutwardCCW(partLoop: LoopPoint[]): boolean {
  return signedLoopArea2D(partLoop) >= 0;
}

export interface HelixBoreOptions {
  stockTopZ: number;
  /** Apply bore taper below stock top (entry bore) or along segment (with taperFromStart). */
  taper: boolean;
  helixR?: number;
  /** Taper from helixR at startZ downward — fresh slot-width layer bores. */
  taperFromStart?: boolean;
  globals: ToolpathGlobalOptions;
  /** Continue rotation from a prior bore segment (radians). */
  startAngle?: number;
  /** Override feed rate (e.g. plunge rate for adaptive bores). */
  feedRate?: number;
  /** Interior hole finish radius at stock top (tool center). */
  interiorCutR?: number;
  /** Override helix rotation (+1 CCW, −1 CW). */
  rotDir?: number;
}

export interface HelixBoreResult {
  points: ToolpathPoint[];
  endAngle: number;
}

function resolveBoreHelixR(
  settings: OperationDefaults,
  z: number,
  stockTopZ: number,
  startZ: number,
  options: HelixBoreOptions,
  defaultHelixR: number
): number {
  const startR = options.helixR ?? defaultHelixR;
  if (options.interiorCutR !== undefined) {
    if (!options.taper || settings.boreTaperAngleDeg <= 0) return options.interiorCutR;
    return interiorHelixRadiusAtZ(options.interiorCutR, z, stockTopZ, settings.boreTaperAngleDeg);
  }

  if (!options.taper) return startR;

  if (options.taperFromStart && options.helixR !== undefined) {
    return helixRadiusTaperedFromStart(settings, z, startZ, startR);
  }

  if (z >= stockTopZ - 1e-6) return defaultHelixR;
  return helixRadiusAtZ(settings, z, stockTopZ);
}

/** Helical bore from startZ down to targetZ. */
export function generateHelixBorePoints(
  center: { x: number; y: number },
  settings: OperationDefaults,
  startZ: number,
  targetZ: number,
  options: HelixBoreOptions
): HelixBoreResult {
  const feedRate = options.feedRate ?? settings.helixFeedRate;
  const rotDir = options.rotDir ?? resolveHelixRotationDir(settings.climbMilling);
  const segments = helixSegmentsPerRev(options.globals.resolution);
  const defaultHelixR =
    options.interiorCutR ?? options.helixR ?? resolveHelixRadius(settings);
  const points: ToolpathPoint[] = [];

  let z = startZ;
  let angle = options.startAngle ?? 0;
  let iterations = 0;
  const maxIterations = 500 * segments;

  while (z > targetZ + 1e-6 && iterations < maxIterations) {
    const helixR = resolveBoreHelixR(
      settings,
      z,
      options.stockTopZ,
      startZ,
      options,
      defaultHelixR
    );
    const pitch = helixPitchForRadius(helixR, settings.rampAngleDeg);

    for (let i = 0; i < segments; i++) {
      angle += rotDir * ((Math.PI * 2) / segments);
      z = Math.max(z - pitch / segments, targetZ);
      const r = resolveBoreHelixR(
        settings,
        z,
        options.stockTopZ,
        startZ,
        options,
        defaultHelixR
      );
      points.push({
        x: center.x + Math.cos(angle) * r,
        y: center.y + Math.sin(angle) * r,
        z,
        feedRate,
      });
      iterations++;
      if (z <= targetZ + 1e-6) break;
    }
  }

  return { points, endAngle: angle };
}
