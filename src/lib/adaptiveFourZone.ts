/**
 * Four-zone adaptive D-arc path generator.
 *
 * The slot being cleared sits OUTSIDE the part outline:
 *
 *   Part outline (keep) ─── inner guide ─── [SLOT / STOCK] ─── outer boundary
 *
 * Material exists OUTWARD of the inner guide. The inner guide channel (next to
 * the part wall) is always clear — safe for rapid return travel.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Each cycle advances by one `forwardIncrement` (stepover) along the outline.
 *
 *   Zone 1 – Cutting arc:
 *     inner[s_n] ──▶ outer-peak[s_n + arcStep/2] ──▶ inner[s_n + arcStep]
 *     Sinusoidal D-arc: sweeps outward (into stock) then returns to inner guide.
 *     At the midpoint the arc is PERPENDICULAR to the slot centerline.
 *     arcStep > forwardIncrement, so the D-arc overshoots past the next start.
 *
 *   Zone 2 – Exit / lift:
 *     Vertical Z-lift at inner[s_n + arcStep].
 *     Bypassed entirely when liftAmount === 0.
 *
 *   Zone 3 – Flat return:
 *     inner[s_n + arcStep] ──▶ inner[s_n + forwardIncrement]   (BACKWARD)
 *     Follows the inner guide (part side), which is always clear.
 *     Travels backward along the slot centerline through cleared space.
 *     Rapid traverse — no cutting.
 *
 *   Zone 4 – Lead-in:
 *     Descent back to cut depth at inner[s_n + forwardIncrement] (if lifted).
 *     Tangential blend into the next D-arc start — smooth re-engagement.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { LoopPoint, ToolpathPoint } from '../types/operations';
import type { ArcLengthGuide } from './trochoidalPath';
import { buildArcLengthGuide, sampleGuideAtS } from './trochoidalPath';
import { clampToolCenterMinDistanceFromPart } from './geometryProcessing';

export interface FourZoneParams {
  /** Net forward advance along the slot per cycle (mm). Maps to stepover setting. */
  forwardIncrement: number;
  /** Slot clearance = slotWidth − toolDiameter (mm). Drives D-arc peak depth. */
  slotClearance: number;
  /** Z cutting depth for this layer. */
  z: number;
  /** Z micro-lift at the D-arc endpoint (mm). 0 = bypass exit/lift entirely. */
  liftAmount?: number;
  /** Part outline — used to enforce minimum standoff from the part wall. */
  partLoop?: LoopPoint[];
  /** Minimum allowed tool-center distance from part (= toolRadius + radialOffset). */
  minCenterDist?: number;
}

// ─── Resolution constants ─────────────────────────────────────────────────────
const CUT_STEPS = 32;    // arc sample count for the D-arc (Zone 1)
const LIFT_STEPS = 4;    // steps for Z lift / descent (Zones 2 & 4)
const RETURN_STEPS = 12; // steps for the backward inner-guide return (Zone 3)

// ─── Geometry helpers ─────────────────────────────────────────────────────────

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

/**
 * Compute the D-arc forward span (arcStep).
 *
 * arcStep > forwardIncrement  ←  guarantees Zone 3 is genuinely backward.
 *
 * Target: arcStep ≈ 2*slotClearance gives a near-semicircular D-arc where
 * the peak is perpendicular to the guide and the arc depth equals the slot depth.
 * Minimum: arcStep ≥ forwardIncrement * 1.5 so the backward return is meaningful.
 */
function computeArcStep(slotClearance: number, forwardIncrement: number): number {
  const semicircular = 2 * slotClearance;
  const minimum = forwardIncrement * 1.5;
  return Math.max(semicircular, minimum);
}

// ─── Zone 1: Cutting arc ──────────────────────────────────────────────────────

/**
 * D-arc: sweeps outward from the inner guide into uncut stock, peaks at
 * full slot depth (slotClearance) at the midpoint, then returns to the
 * inner guide at s_n + arcStep.
 *
 * Sinusoidal outward profile: outward = slotClearance * sin(π * t)
 *   t=0   → outward=0   (inner guide, part side)
 *   t=0.5 → outward=slotClearance  (outer stock, max depth — perpendicular to guide)
 *   t=1   → outward=0   (inner guide, part side — D-arc endpoint)
 */
function buildCuttingArc(
  guide: ArcLengthGuide,
  s_n: number,
  arcStep: number,
  slotClearance: number,
  z: number,
  partLoop: LoopPoint[] | undefined,
  minDist: number | undefined
): ToolpathPoint[] {
  const pts: ToolpathPoint[] = [];
  for (let i = 0; i <= CUT_STEPS; i++) {
    const t = i / CUT_STEPS;
    const outward = slotClearance * Math.sin(Math.PI * t);
    const s = s_n + t * arcStep;
    pts.push(applyMinStandoff(slotPoint(guide, s, outward, z), partLoop, minDist));
  }
  return pts;
}

// ─── Zone 2: Exit / lift ──────────────────────────────────────────────────────

/**
 * Pure vertical Z-lift at the D-arc endpoint (inner guide, part side).
 * Returns an empty array when liftAmount === 0 — zone is completely bypassed.
 */
function buildExitLift(exitPt: ToolpathPoint, liftAmount: number): ToolpathPoint[] {
  if (liftAmount <= 0) return [];
  const pts: ToolpathPoint[] = [];
  for (let i = 1; i <= LIFT_STEPS; i++) {
    pts.push({ x: exitPt.x, y: exitPt.y, z: exitPt.z + liftAmount * (i / LIFT_STEPS) });
  }
  return pts;
}

// ─── Zone 3: Flat return ──────────────────────────────────────────────────────

/**
 * Backward return along the inner guide (part side):
 *   inner[s_n + arcStep] ──rapid──▶ inner[s_n + forwardIncrement]
 *
 * The inner guide is always adjacent to the part wall — no material exists there.
 * This is genuine backward motion (arcStep > forwardIncrement).
 * Rapid traverse — the return chord follows the guide curve to stay safe
 * against concave part shapes where a straight chord might enter the part.
 */
function buildFlatReturn(
  guide: ArcLengthGuide,
  s_n: number,
  arcStep: number,
  forwardIncrement: number,
  z: number  // lifted Z if applicable
): ToolpathPoint[] {
  const returnDist = arcStep - forwardIncrement; // how far backward we travel
  const pts: ToolpathPoint[] = [];
  for (let i = 1; i <= RETURN_STEPS; i++) {
    const t = i / RETURN_STEPS;
    // Trace the inner guide backward: s goes from s_n+arcStep down to s_n+forwardIncrement
    const s = (s_n + arcStep) - t * returnDist;
    pts.push({ ...slotPoint(guide, s, 0, z), rapid: true });
  }
  return pts;
}

// ─── Zone 4: Lead-in ──────────────────────────────────────────────────────────

/**
 * Descent back to cut depth at inner[s_n+forwardIncrement] (if lifted), then
 * a short tangential blend that eases the D-arc's first bite into the stock.
 *
 * The D-arc already starts smoothly (sin(0)=0, derivative = π*slotClearance·T)
 * so a minimal lead-in is sufficient. If no lift, this zone is empty.
 */
function buildLeadIn(
  guide: ArcLengthGuide,
  s_next: number,         // = s_n + forwardIncrement
  liftAmount: number,
  z_cut: number
): ToolpathPoint[] {
  if (liftAmount <= 0) return [];

  const pts: ToolpathPoint[] = [];
  const innerPt = slotPoint(guide, s_next, 0, z_cut);
  for (let i = 1; i <= LIFT_STEPS; i++) {
    const t = i / LIFT_STEPS;
    pts.push({ x: innerPt.x, y: innerPt.y, z: z_cut + liftAmount * (1 - t) });
  }
  return pts;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Generate the full four-zone adaptive D-arc path for one Z layer.
 *
 * Each cycle in local slot coordinates (T = forward, N = outward into stock):
 *
 *   N ↑
 *     │     Zone 1 (D-arc into stock)
 *     │      ╭─────────────────╮
 *  slotC ─── │                 │
 *     │      │                 │
 *     0 ─────●─────────────────●───────● → T
 *           s_n           s_n+arcStep
 *                              ←←←←←←←←
 *                              Zone 3 (backward return along inner guide)
 *                              to s_n + forwardIncrement
 */
export function generateFourZoneAdaptivePath(
  innerGuideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  const { forwardIncrement, slotClearance, z, liftAmount = 0 } = params;

  if (innerGuideLoop.length < 3 || forwardIncrement <= 0 || slotClearance <= 0) return [];

  const arcStep = computeArcStep(slotClearance, forwardIncrement);
  const sampleSpacing = Math.min(arcStep / 8, slotClearance / 4, 0.5);
  const guide = buildArcLengthGuide(innerGuideLoop, sampleSpacing);
  if (guide.totalLength <= 0) return [];

  // Number of cycles to cover the whole guide
  const numCycles = Math.ceil(guide.totalLength / forwardIncrement);
  const pts: ToolpathPoint[] = [];
  const { partLoop, minCenterDist } = params;

  for (let cycle = 0; cycle < numCycles; cycle++) {
    const s_n = cycle * forwardIncrement;
    const s_next = s_n + forwardIncrement; // start of next cycle's D-arc

    // ── Zone 1: D-arc cutting arc ───────────────────────────────────────────
    // inner[s_n] → (D outward into stock) → inner[s_n + arcStep]
    const cutArc = buildCuttingArc(
      guide, s_n, arcStep, slotClearance, z, partLoop, minCenterDist
    );

    if (cycle === 0) {
      // First cycle: include the starting point (inner[s_0])
      pts.push(...cutArc);
    } else {
      // Zone 4 of the previous cycle already placed inner[s_n]; skip duplicate.
      pts.push(...cutArc.slice(1));
    }

    // D-arc endpoint = inner[s_n + arcStep]
    const exitPt = pts[pts.length - 1];

    // ── Zone 2: Exit / lift ─────────────────────────────────────────────────
    const liftPts = buildExitLift(exitPt, liftAmount);
    pts.push(...liftPts);
    const zAtReturn = z + liftAmount;

    // ── Zone 3: Flat return along inner guide ───────────────────────────────
    // inner[s_n + arcStep] ←backward── inner[s_n + forwardIncrement]
    // Rapid. Follows inner-guide curve. Always in clear space (part wall side).
    pts.push(...buildFlatReturn(guide, s_n, arcStep, forwardIncrement, zAtReturn));

    // ── Zone 4: Lead-in ─────────────────────────────────────────────────────
    // Descend to cut depth at inner[s_next] (if lifted). Empty when liftAmount=0.
    const leadInPts = buildLeadIn(guide, s_next, liftAmount, z);
    pts.push(...leadInPts);

    // After Zone 4, tool is at inner[s_next] at z — start of next D-arc.
  }

  return pts;
}

export function generateConstantEngagementTrochoid(
  innerGuideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  return generateFourZoneAdaptivePath(innerGuideLoop, params);
}
