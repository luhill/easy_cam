import type { LoopPoint, OperationDefaults, ToolpathPoint } from '../types/operations';
import {
  closestPointOnLoop2D,
  distanceToLoop2D,
  pointInPolygon2D,
  signedLoopArea2D,
} from './geometryProcessing';
import { resolveAdaptiveSlotGeometry } from './adaptiveOutline';
import {
  buildArcLengthGuide,
  advanceGuideArcLength,
  extractGuideArcSegment,
  findClosestSOnGuide,
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

/** Pitch from helix angle for an arbitrary helix radius. */
export function helixPitchForRadius(helixR: number, angleDeg: number): number {
  const r = Math.max(helixR, 0.05);
  const angleRad = (angleDeg * Math.PI) / 180;
  return Math.max(2 * Math.PI * r * Math.tan(angleRad), 0.05);
}

/** One revolution Z drop from helix lead angle (degrees). */
export function helixPitchFromAngle(settings: OperationDefaults): number {
  return helixPitchForRadius(resolveHelixRadius(settings), settings.helixAngleDeg);
}

/** Layer-step helix radius — bore diameter equals slot width (slot clearance). */
export function resolveSlotHelixRadius(slotClearance: number): number {
  return Math.max(slotClearance / 2, 0.05);
}

/**
 * Largest tool-center radius from bore center during entry — derived from the
 * greater of bore outer diameter and slot width so the widen spiral cannot
 * cross the inner slot path.
 */
export function resolveMaxEntryHelixRadius(settings: OperationDefaults): number {
  const slot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
  const boreOuterD = 2 * resolveBoreOuterRadius(settings);
  const effectiveDiameter = Math.max(boreOuterD, slot.slotWidth);
  return Math.max(effectiveDiameter / 2 - slot.toolRadius, 0.05);
}

/** +1 = CCW helix, −1 = CW helix (climb external default). */
export function resolveHelixRotationDir(climbMilling: boolean): number {
  return climbMilling ? -1 : 1;
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

/** Push entry outward if it lies inside the part or too close to the outline. */
export function ensureEntryOutsidePart(
  partLoop: LoopPoint[],
  point: { x: number; y: number },
  minDist: number
): { x: number; y: number } {
  const inside = pointInPolygon2D(point.x, point.y, partLoop);
  const dist = distanceToLoop2D(point.x, point.y, partLoop);
  if (!inside && dist >= minDist) return point;

  const closest = closestPointOnLoop2D(point.x, point.y, partLoop);
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

function solveTangentFilletCenter(
  t1: { x: number; y: number },
  d1: { x: number; y: number },
  p2: { x: number; y: number },
  d2: { x: number; y: number },
  radius: number,
  turnSign: number
): { x: number; y: number } {
  const n1x = -d1.y;
  const n1y = d1.x;
  const n2x = -d2.y;
  const n2y = d2.x;

  for (const s1 of [turnSign, -turnSign]) {
    for (const s2 of [turnSign, -turnSign]) {
      const cx = t1.x + s1 * n1x * radius;
      const cy = t1.y + s1 * n1y * radius;
      const cx2 = p2.x + s2 * n2x * radius;
      const cy2 = p2.y + s2 * n2y * radius;
      if (Math.hypot(cx - cx2, cy - cy2) > 1e-2) continue;

      const toT1 = Math.hypot(t1.x - cx, t1.y - cy);
      const toP2 = Math.hypot(p2.x - cx, p2.y - cy);
      const line2Dist = Math.abs((cx - p2.x) * (-d2.y) + (cy - p2.y) * d2.x);
      if (
        Math.abs(toT1 - radius) < 1e-2 &&
        Math.abs(toP2 - radius) < 1e-2 &&
        line2Dist < 1e-2
      ) {
        return { x: cx, y: cy };
      }
    }
  }

  return { x: t1.x + turnSign * n1x * radius, y: t1.y + turnSign * n1y * radius };
}

function sampleTangentFilletArc(
  center: { x: number; y: number },
  radius: number,
  t1: { x: number; y: number },
  p2: { x: number; y: number },
  turnSign: number,
  z: number,
  sampleSpacing: number
): LoopPoint[] {
  let a1 = Math.atan2(t1.y - center.y, t1.x - center.x);
  let a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
  let sweep = a2 - a1;
  if (turnSign > 0) {
    while (sweep <= 1e-6) sweep += 2 * Math.PI;
  } else {
    while (sweep >= -1e-6) sweep -= 2 * Math.PI;
  }

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

/**
 * Tangent fillet from the straight entry leg onto the slot centerline curve.
 * The arc ends on the guide at the fillet tangent point with matching slope.
 */
function filletEntryToSlotCenterline(
  boreCenter: { x: number; y: number },
  corner: { x: number; y: number },
  trochArcGuide: ReturnType<typeof buildArcLengthGuide>,
  cornerS: number,
  joinS: number,
  guideTraverseSign: number,
  filletRadius: number,
  sampleSpacing: number,
  z: number
): LoopPoint[] | null {
  const forward = guideTraverseSign >= 0;
  const tangentSign = forward ? 1 : -1;

  const inX = corner.x - boreCenter.x;
  const inY = corner.y - boreCenter.y;
  const inAvail = Math.hypot(inX, inY);
  if (inAvail < sampleSpacing * 0.1) return null;

  const d1x = inX / inAvail;
  const d1y = inY / inAvail;

  const frameCorner = sampleGuideAtS(trochArcGuide, cornerS);
  let d2x = frameCorner.tx * tangentSign;
  let d2y = frameCorner.ty * tangentSign;
  const d2Len0 = Math.hypot(d2x, d2y) || 1;
  d2x /= d2Len0;
  d2y /= d2Len0;

  let cross = d1x * d2y - d1y * d2x;
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

  let resumeS = advanceGuideArcLength(trochArcGuide, cornerS, trim, forward);
  let curveFrame = sampleGuideAtS(trochArcGuide, resumeS);
  d2x = curveFrame.tx * tangentSign;
  d2y = curveFrame.ty * tangentSign;
  const d2Len = Math.hypot(d2x, d2y) || 1;
  d2x /= d2Len;
  d2y /= d2Len;

  cross = d1x * d2y - d1y * d2x;
  dot = Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y));
  turn = Math.acos(dot);
  half = turn / 2;
  trim = radius / Math.tan(half);
  if (trim > maxInTrim) {
    radius = maxInTrim * Math.tan(half);
    trim = maxInTrim;
  }

  resumeS = advanceGuideArcLength(trochArcGuide, cornerS, trim, forward);
  curveFrame = sampleGuideAtS(trochArcGuide, resumeS);
  d2x = curveFrame.tx * tangentSign;
  d2y = curveFrame.ty * tangentSign;
  const d2LenFinal = Math.hypot(d2x, d2y) || 1;
  d2x /= d2LenFinal;
  d2y /= d2LenFinal;

  const t1 = { x: corner.x - d1x * trim, y: corner.y - d1y * trim };
  const p2 = { x: curveFrame.x, y: curveFrame.y };
  const turnSign = cross >= 0 ? 1 : -1;
  const center = solveTangentFilletCenter(
    t1,
    { x: d1x, y: d1y },
    p2,
    { x: d2x, y: d2y },
    radius,
    turnSign
  );

  const straightLeg = sampleStraightLeg(boreCenter, t1, z, sampleSpacing);
  const filletPts = sampleTangentFilletArc(
    center,
    radius,
    t1,
    p2,
    turnSign,
    z,
    sampleSpacing
  );

  const continuation = extractGuideArcSegment(
    trochArcGuide,
    resumeS,
    joinS,
    guideTraverseSign,
    sampleSpacing,
    z
  );
  const contStart =
    continuation.length > 0 &&
    Math.hypot(continuation[0].x - p2.x, continuation[0].y - p2.y) < sampleSpacing * 0.2
      ? 1
      : 0;

  return [...straightLeg, ...filletPts, ...continuation.slice(contStart)];
}

/**
 * Lead-in centerline: straight leg from bore center to the nearest slot-center
 * point, then along the slot center guide to the join station.
 */
export function buildBoreLeadInGuide(
  boreCenter: { x: number; y: number },
  trochArcGuide: ReturnType<typeof buildArcLengthGuide>,
  joinS: number,
  guideTraverseSign: number,
  sampleSpacing: number,
  z: number,
  filletRadius = 0
): LoopPoint[] {
  const nearest = findClosestSOnGuide(trochArcGuide, boreCenter);
  const nearestPt = sampleGuideAtS(trochArcGuide, nearest.s);

  if (filletRadius > 0) {
    const filleted = filletEntryToSlotCenterline(
      boreCenter,
      nearestPt,
      trochArcGuide,
      nearest.s,
      joinS,
      guideTraverseSign,
      filletRadius,
      sampleSpacing,
      z
    );
    if (filleted && filleted.length >= 2) {
      return filleted;
    }
  }

  const straightLeg: LoopPoint[] = [{ x: boreCenter.x, y: boreCenter.y, z }];
  const span = Math.hypot(nearestPt.x - boreCenter.x, nearestPt.y - boreCenter.y);
  if (span > sampleSpacing * 0.5) {
    const steps = Math.max(1, Math.ceil(span / sampleSpacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      straightLeg.push({
        x: boreCenter.x + (nearestPt.x - boreCenter.x) * t,
        y: boreCenter.y + (nearestPt.y - boreCenter.y) * t,
        z,
      });
    }
  } else if (Math.hypot(straightLeg[0].x - nearestPt.x, straightLeg[0].y - nearestPt.y) > 1e-4) {
    straightLeg.push({ x: nearestPt.x, y: nearestPt.y, z });
  }

  const arcPts = extractGuideArcSegment(
    trochArcGuide,
    nearest.s,
    joinS,
    guideTraverseSign,
    sampleSpacing,
    z
  );
  if (arcPts.length === 0) return straightLeg;

  const last = straightLeg[straightLeg.length - 1];
  const dup = Math.hypot(last.x - arcPts[0].x, last.y - arcPts[0].y) < sampleSpacing * 0.3;
  return dup ? [...straightLeg, ...arcPts.slice(1)] : [...straightLeg, ...arcPts];
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

/**
 * Minimum distance from part outline to bore center.
 * Clears the inner slot path for the largest tool orbit during entry (bore
 * helix or bottom widen spiral, whichever is greater).
 */
export function minimumEntryCenterDist(settings: OperationDefaults): number {
  const slot = resolveAdaptiveSlotGeometry(settings, { roughing: false });
  return slot.minCenterDist + resolveMaxEntryHelixRadius(settings);
}

/** Outward offset from the inner slot guide to the bore center. */
export function boreCenterOffsetFromInnerGuide(settings: OperationDefaults): number {
  return resolveMaxEntryHelixRadius(settings);
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

export function isGuideOutwardCCW(partLoop: LoopPoint[]): boolean {
  return signedLoopArea2D(partLoop) >= 0;
}

export interface HelixBoreOptions {
  stockTopZ: number;
  /** Apply bore taper below stock top */
  taper: boolean;
  helixR?: number;
  globals: ToolpathGlobalOptions;
  /** Continue rotation from a prior bore segment (radians). */
  startAngle?: number;
}

export interface HelixBoreResult {
  points: ToolpathPoint[];
  endAngle: number;
}

/** Helical bore from startZ down to targetZ. */
export function generateHelixBorePoints(
  center: { x: number; y: number },
  settings: OperationDefaults,
  startZ: number,
  targetZ: number,
  options: HelixBoreOptions
): HelixBoreResult {
  const feedRate = settings.helixFeedRate;
  const rotDir = resolveHelixRotationDir(settings.climbMilling);
  const segments = helixSegmentsPerRev(options.globals.resolution);
  const defaultHelixR = options.helixR ?? resolveHelixRadius(settings);
  const points: ToolpathPoint[] = [];

  let z = startZ;
  let angle = options.startAngle ?? 0;
  let iterations = 0;
  const maxIterations = 500 * segments;

  while (z > targetZ + 1e-6 && iterations < maxIterations) {
    const helixR =
      options.taper && z < options.stockTopZ - 1e-6
        ? helixRadiusAtZ(settings, z, options.stockTopZ)
        : defaultHelixR;
    const pitch = helixPitchForRadius(helixR, settings.helixAngleDeg);

    for (let i = 0; i < segments; i++) {
      angle += rotDir * ((Math.PI * 2) / segments);
      z = Math.max(z - pitch / segments, targetZ);
      const r =
        options.taper && z < options.stockTopZ - 1e-6
          ? helixRadiusAtZ(settings, z, options.stockTopZ)
          : defaultHelixR;
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
