/**
 * Four-zone adaptive trochoidal path generator.
 *
 * Each cycle produces exactly one forward step (stepover) along the slot:
 *
 *   Zone 1 – Cutting arc :  inner[s] ─────────────→ outer[s + step]
 *                           (sweeps outward while advancing – engages material)
 *
 *   Zone 2 – Exit / lift :  vertical Z-lift at outer[s + step]
 *                           (bypassed when liftAmount === 0)
 *
 *   Zone 3 – Flat return :  outer[s + step] ←────────── outer[s]
 *                           (straight rapid backward along outer boundary,
 *                            runs through already-cleared material,
 *                            NEVER backtracks over the cut path)
 *
 *   Zone 4 – Lead-in arc :  outer[s] ─────────────→ inner[s + step]
 *                           (smooth inward sweep, forward + inward,
 *                            tangentially re-engages next cutting arc start)
 *
 * The outer boundary is always on the far (open-stock) side of the slot,
 * so Zones 3 & 4 never conflict with the cut path of Zone 1.
 */

import type { LoopPoint, ToolpathPoint } from '../types/operations';
import type { ArcLengthGuide } from './trochoidalPath';
import { buildArcLengthGuide, sampleGuideAtS } from './trochoidalPath';
import { clampToolCenterMinDistanceFromPart } from './geometryProcessing';

export interface FourZoneParams {
  /** Forward advance per cycle (mm). Maps to stepover setting. */
  forwardIncrement: number;
  /** Slot clearance = slotWidth − toolDiameter (mm). Drives outward sweep amplitude. */
  slotClearance: number;
  /** Z cutting depth for this layer. */
  z: number;
  /** Z micro-lift at exit (mm). 0 = bypass exit/lift zone entirely. */
  liftAmount?: number;
  /** Part outline — minimum standoff is enforced on cutting zones. */
  partLoop?: LoopPoint[];
  /** Minimum allowed tool-center distance from part (= toolRadius + radialOffset). */
  minCenterDist?: number;
}

// ─── Resolution constants ─────────────────────────────────────────────────────
/** Points on the cutting arc (Zone 1). */
const CUT_STEPS = 24;
/** Points on the lift / descent transitions (Zone 2 & descent part of Zone 4). */
const LIFT_STEPS = 4;
/** Points on the flat return (Zone 3). */
const RETURN_STEPS = 8;
/** Points on the lead-in arc (Zone 4). */
const LEADIN_STEPS = 24;

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/**
 * Sample a point on the slot band.
 * @param s     Arc-length position along the inner guide.
 * @param outward  Distance outward from the inner guide (0 = part side, slotClearance = open side).
 */
function slotPoint(
  guide: ArcLengthGuide,
  s: number,
  outward: number,
  z: number
): ToolpathPoint {
  const f = sampleGuideAtS(guide, s);
  return { x: f.x + f.nx * outward, y: f.y + f.ny * outward, z };
}

function applyMinStandoff(
  pt: ToolpathPoint,
  partLoop: LoopPoint[] | undefined,
  minDist: number | undefined
): ToolpathPoint {
  if (!partLoop || minDist === undefined) return pt;
  const c = clampToolCenterMinDistanceFromPart(partLoop, pt.x, pt.y, minDist);
  return { ...pt, x: c.x, y: c.y };
}

// ─── Zone 1: Cutting arc ──────────────────────────────────────────────────────

/**
 * Sweeps the tool from the inner guide (part side, outward = 0) to the outer
 * boundary (open-stock side, outward = slotClearance) while advancing forward
 * from s_n to s_n + stepover. Uses a cosine ease-in/out for a smooth arc shape.
 *
 * Path: inner[s_n] ──arc──▶ outer[s_n + stepover]
 */
function buildCuttingArc(
  guide: ArcLengthGuide,
  s_n: number,
  stepover: number,
  slotClearance: number,
  z: number,
  partLoop: LoopPoint[] | undefined,
  minDist: number | undefined
): ToolpathPoint[] {
  const pts: ToolpathPoint[] = [];

  for (let i = 0; i <= CUT_STEPS; i++) {
    const t = i / CUT_STEPS;
    // Cosine ease gives a smooth, arc-like outward sweep (slow–fast–slow)
    const outward = 0.5 * (1 - Math.cos(Math.PI * t)) * slotClearance;
    const s = s_n + t * stepover;
    pts.push(applyMinStandoff(slotPoint(guide, s, outward, z), partLoop, minDist));
  }

  return pts;
}

// ─── Zone 2: Exit / lift ──────────────────────────────────────────────────────

/**
 * Vertical Z-lift at the exact exit point (outer boundary).
 * Returns an empty array when liftAmount === 0 — zone is completely bypassed.
 */
function buildExitLift(exitPt: ToolpathPoint, liftAmount: number): ToolpathPoint[] {
  if (liftAmount <= 0) return [];

  const pts: ToolpathPoint[] = [];
  for (let i = 1; i <= LIFT_STEPS; i++) {
    const t = i / LIFT_STEPS;
    pts.push({ x: exitPt.x, y: exitPt.y, z: exitPt.z + liftAmount * t });
  }
  return pts;
}

// ─── Zone 3: Flat return ──────────────────────────────────────────────────────

/**
 * Straight-line rapid traverse backward along the outer boundary:
 *   outer[s_n + stepover] ──rapid──▶ outer[s_n]
 *
 * Travels entirely in already-cleared material (the outer side of the slot was
 * opened by the current cycle's cutting arc). Never crosses the cut path.
 */
function buildFlatReturn(from: ToolpathPoint, to: ToolpathPoint): ToolpathPoint[] {
  const pts: ToolpathPoint[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;

  for (let i = 1; i <= RETURN_STEPS; i++) {
    const t = i / RETURN_STEPS;
    pts.push({ x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t, rapid: true });
  }
  return pts;
}

// ─── Zone 4: Lead-in arc ──────────────────────────────────────────────────────

/**
 * Smooth inward arc from outer[s_n] to inner[s_n + stepover], re-engaging
 * the part tangentially for the next cutting arc.
 *
 * If lifted, a rapid descent to cut depth is prepended first.
 * Mirror of the cutting arc: advances forward while sweeping inward.
 */
function buildLeadIn(
  guide: ArcLengthGuide,
  s_n: number,
  stepover: number,
  slotClearance: number,
  liftAmount: number,
  z_cut: number,
  partLoop: LoopPoint[] | undefined,
  minDist: number | undefined
): ToolpathPoint[] {
  const pts: ToolpathPoint[] = [];

  // Rapid descent back to cut depth (only when lifted)
  if (liftAmount > 0) {
    const outerPt = slotPoint(guide, s_n, slotClearance, z_cut);
    for (let i = 1; i <= LIFT_STEPS; i++) {
      const t = i / LIFT_STEPS;
      pts.push({ x: outerPt.x, y: outerPt.y, z: z_cut + liftAmount * (1 - t) });
    }
  }

  // Inward arc: outer[s_n] → inner[s_n + stepover]
  // Cosine ease mirrors the cutting arc, creating a symmetric slot profile.
  for (let i = 1; i <= LEADIN_STEPS; i++) {
    const t = i / LEADIN_STEPS;
    const outward = 0.5 * (1 + Math.cos(Math.PI * t)) * slotClearance;
    const s = s_n + t * stepover;
    pts.push(applyMinStandoff(slotPoint(guide, s, outward, z_cut), partLoop, minDist));
  }

  return pts;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Generate the complete four-zone adaptive path for one Z layer.
 *
 * Cycle geometry (slot cross-section view, part to the left):
 *
 *   inner (part side) │  outer (open stock)
 *   ──────────────────┼──────────────────────────────
 *         s_n ●       │         Zone 3 ←←←←← ●
 *              \      │                       |
 *        Zone 1 \     │               Zone 4  |
 *         (cut)  \    │              (lead-in) |
 *                 \   │                       |
 *                  ●──┘ Zone 2 (lift)         |
 *                s_n+step                     |
 *   s_n+step ●───────────────────────────────┘
 *
 * Each cycle is self-contained and advances the slot centerline by stepover.
 */
export function generateFourZoneAdaptivePath(
  innerGuideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  const { forwardIncrement: stepover, slotClearance, z, liftAmount = 0 } = params;

  if (innerGuideLoop.length < 3 || stepover <= 0 || slotClearance <= 0) return [];

  const sampleSpacing = Math.min(stepover / 6, slotClearance / 4, 0.5);
  const guide = buildArcLengthGuide(innerGuideLoop, sampleSpacing);
  if (guide.totalLength <= 0) return [];

  const numCycles = Math.ceil(guide.totalLength / stepover);
  const pts: ToolpathPoint[] = [];
  const { partLoop, minCenterDist } = params;

  for (let cycle = 0; cycle < numCycles; cycle++) {
    const s_n = cycle * stepover;

    // ── Zone 1: Cutting arc ─────────────────────────────────────────────────
    // inner[s_n] → outer[s_n1]
    const cutArc = buildCuttingArc(guide, s_n, stepover, slotClearance, z, partLoop, minCenterDist);

    if (cycle === 0) {
      // First cycle: include the path start (inner[0])
      pts.push(...cutArc);
    } else {
      // Subsequent cycles: Zone 4 of the previous cycle already placed inner[s_n];
      // skip the duplicate first point.
      pts.push(...cutArc.slice(1));
    }

    // Exit point = outer[s_n1]
    const exitPt = pts[pts.length - 1];

    // ── Zone 2: Exit / lift ─────────────────────────────────────────────────
    // Pure vertical Z lift. Empty when liftAmount === 0.
    const liftPts = buildExitLift(exitPt, liftAmount);
    pts.push(...liftPts);
    const postLiftPt = liftPts.length > 0 ? liftPts[liftPts.length - 1] : exitPt;

    // ── Zone 3: Flat return ─────────────────────────────────────────────────
    // outer[s_n1] (lifted) → outer[s_n] (lifted)
    // Backward along the outer boundary — entirely in cleared material.
    const outerAtStart = slotPoint(guide, s_n, slotClearance, z);
    const returnTarget: ToolpathPoint = { ...outerAtStart, z: z + liftAmount };
    pts.push(...buildFlatReturn(postLiftPt, returnTarget));

    // ── Zone 4: Lead-in arc ─────────────────────────────────────────────────
    // outer[s_n] → inner[s_n1]  (descent + smooth inward arc)
    // Ends at inner[s_n1] which is the start of the next cycle's cutting arc.
    pts.push(...buildLeadIn(guide, s_n, stepover, slotClearance, liftAmount, z, partLoop, minCenterDist));
  }

  return pts;
}

export function generateConstantEngagementTrochoid(
  innerGuideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  return generateFourZoneAdaptivePath(innerGuideLoop, params);
}
