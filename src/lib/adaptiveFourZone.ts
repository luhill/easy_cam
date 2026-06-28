/**
 * Four-zone adaptive slot path — carved from solid stock outside the part outline.
 *
 * Context (same as a simple outline, but channel wider than the tool):
 *
 *   Part wall │ inner guide (0) │──── slot / stock ────│ outer (slotClearance)
 *
 *   • Material lives OUTWARD of the inner guide.
 *   • The "safe zone" is BEHIND the tool along the travel direction — already cleared.
 *   • Cutting pushes inner → outer while advancing forward (engaging stock).
 *   • Return crosses the SLOT CENTER (away from both edges), moving backward in travel
 *     through the safe / cleared zone — never along the outer (stock) edge.
 *   • Motions are rounded (O-with-flat-bottom feel) — no sharp corner reversals.
 *   • Lift (if liftAmount > 0) ramps up during return, peaks at slot-center / mid-return,
 *     then ramps down before the next cut. liftAmount === 0 skips all Z motion.
 */

import type { LoopPoint, ToolpathPoint } from '../types/operations';
import type { ArcLengthGuide } from './trochoidalPath';
import { buildArcLengthGuide, sampleGuideAtS } from './trochoidalPath';
import { clampToolCenterMinDistanceFromPart, signedLoopArea2D } from './geometryProcessing';

export interface FourZoneParams {
  /** Net forward advance per cycle along the outline (mm) — stepover. */
  forwardIncrement: number;
  /** Tool-center lateral range inside slot = slotWidth − toolDiameter (mm). */
  slotClearance: number;
  z: number;
  /** Peak Z lift during return (mm). 0 = remain at cut depth throughout. */
  liftAmount?: number;
  partLoop?: LoopPoint[];
  minCenterDist?: number;
}

// ─── Cycle layout (fractions of one loop parameter u ∈ [0, 1]) ───────────────
const CUT_END = 0.38;       // Zone 1 ends — forward cutting arc
const EXIT_END = 0.46;      // Zone 2 ends — smooth fillet off the cut (still at depth)
// Zone 3: RETURN_END — backward stroke through slot center with lift
const RETURN_END = 0.9;     // Zone 4: final blend down to inner / next cut start

const CUT_STEPS = 28;
const EXIT_STEPS = 6;
const RETURN_STEPS = 24;
const LEADIN_STEPS = 8;

/** Smooth 0→1 step (C¹ at ends). */
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function slotPoint(guide: ArcLengthGuide, s: number, outward: number, z: number): ToolpathPoint {
  const f = sampleGuideAtS(guide, s);
  return { x: f.x + f.nx * outward, y: f.y + f.ny * outward, z };
}

function clampCut(
  pt: ToolpathPoint,
  partLoop: LoopPoint[] | undefined,
  minDist: number | undefined
): ToolpathPoint {
  if (!partLoop || minDist === undefined) return pt;
  const c = clampToolCenterMinDistanceFromPart(partLoop, pt.x, pt.y, minDist);
  return { ...pt, x: c.x, y: c.y };
}

/** Forward arc length during the cut — overshoots stepover so return can move backward. */
function forwardSpan(slotClearance: number, stepover: number): number {
  return Math.max(stepover * 1.75, slotClearance * 1.1, stepover + slotClearance * 0.5);
}

// ─── Shared kinematics for one cycle (local outline frame) ───────────────────

interface CyclePose {
  s: number;
  outward: number;
  z: number;
  /** true = non-cutting traverse (return / lead-in). */
  nonCutting: boolean;
}

/**
 * Map loop parameter u ∈ [0,1] to tool pose for cycle starting at s_n.
 *
 * outward = 0   → inner guide (part side, cleared)
 * outward = slotClearance → outer slot wall (stock contact side)
 * outward = slotClearance/2 → slot center (safe return corridor)
 */
function cyclePose(
  s_n: number,
  u: number,
  stepover: number,
  span: number,
  slotClearance: number,
  zCut: number,
  liftAmount: number
): CyclePose {
  const half = slotClearance / 2;

  // ── Zone 1: Forward cutting arc (inner → outer, advancing along outline) ──
  if (u <= CUT_END) {
    const t = u / CUT_END;
    const s = s_n + span * smoothstep(t);
    // Flattened-bottom O: ease out to full depth, hold, soft handoff to exit fillet
    let outward: number;
    if (t < 0.55) {
      const p = smoothstep(t / 0.55);
      outward = slotClearance * (1 - Math.cos((Math.PI * p) / 2));
    } else {
      const p = (t - 0.55) / 0.45;
      outward = slotClearance * (1 - 0.04 * smoothstep(p));
    }
    return { s, outward, z: zCut, nonCutting: false };
  }

  // ── Zone 2: Exit fillet — round the corner off the cut, still at cut depth ──
  if (u <= EXIT_END) {
    const t = (u - CUT_END) / (EXIT_END - CUT_END);
    const s = s_n + span - t * span * 0.06;
    const outward = slotClearance * (1 - 0.12 * smoothstep(t));
    return { s, outward, z: zCut, nonCutting: false };
  }

  // ── Zone 3: Return through slot center, backward in travel (safe zone) ─────
  if (u <= RETURN_END) {
    const t = (u - EXIT_END) / (RETURN_END - EXIT_END);
    const backDist = span - stepover;
    const s = s_n + span - t * backDist * 0.82;
    const outward = half + half * Math.cos(Math.PI * smoothstep(t));
    const zLift = liftAmount > 0 ? liftAmount * Math.sin(Math.PI * smoothstep(t)) : 0;
    return { s, outward, z: zCut + zLift, nonCutting: true };
  }

  // ── Zone 4: Lead-in — finish backward travel, descend, land on inner guide ───
  const t = (u - RETURN_END) / (1 - RETURN_END);
  const backDist = span - stepover;
  const s = s_n + span - backDist * (0.82 + 0.18 * smoothstep(t));
  const outward = half * (1 - smoothstep(t));
  const zLift = liftAmount > 0 ? liftAmount * (1 - smoothstep(t)) : 0;
  return { s, outward, z: zCut + zLift, nonCutting: t < 0.35 };
}

function sampleZone(
  guide: ArcLengthGuide,
  s_n: number,
  u0: number,
  u1: number,
  steps: number,
  stepover: number,
  span: number,
  slotClearance: number,
  zCut: number,
  liftAmount: number,
  partLoop: LoopPoint[] | undefined,
  minDist: number | undefined,
  clampStandoff: boolean
): ToolpathPoint[] {
  const pts: ToolpathPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = u0 + (u1 - u0) * (i / steps);
    const pose = cyclePose(s_n, u, stepover, span, slotClearance, zCut, liftAmount);
    let pt = slotPoint(guide, pose.s, pose.outward, pose.z);
    if (clampStandoff) pt = clampCut(pt, partLoop, minDist);
    if (pose.nonCutting) pt = { ...pt, rapid: true };
    pts.push(pt);
  }
  return pts;
}

// ─── Zone builders (explicit phases) ───────────────────────────────────────

/** Zone 1 — forward cutting arc: inner guide → outer slot wall, advancing in travel. */
function buildCuttingArcZone(
  guide: ArcLengthGuide,
  s_n: number,
  stepover: number,
  span: number,
  slotClearance: number,
  zCut: number,
  partLoop: LoopPoint[] | undefined,
  minDist: number | undefined
): ToolpathPoint[] {
  return sampleZone(
    guide, s_n, 0, CUT_END, CUT_STEPS,
    stepover, span, slotClearance, zCut, 0,
    partLoop, minDist, true
  );
}

/** Zone 2 — exit fillet: smooth rounded transition off the cut (no sharp reversal). */
function buildExitFilletZone(
  guide: ArcLengthGuide,
  s_n: number,
  stepover: number,
  span: number,
  slotClearance: number,
  zCut: number,
  partLoop: LoopPoint[] | undefined,
  minDist: number | undefined
): ToolpathPoint[] {
  return sampleZone(
    guide, s_n, CUT_END, EXIT_END, EXIT_STEPS,
    stepover, span, slotClearance, zCut, 0,
    partLoop, minDist, true
  );
}

/**
 * Zone 3 — return stroke: backward in travel through slot center (cleared safe corridor).
 * Lift ramps up to liftAmount at the middle of this zone when liftAmount > 0.
 */
function buildReturnThroughSlotZone(
  guide: ArcLengthGuide,
  s_n: number,
  stepover: number,
  span: number,
  slotClearance: number,
  zCut: number,
  liftAmount: number
): ToolpathPoint[] {
  return sampleZone(
    guide, s_n, EXIT_END, RETURN_END, RETURN_STEPS,
    stepover, span, slotClearance, zCut, liftAmount,
    undefined, undefined, false
  );
}

/**
 * Zone 4 — lead-in: complete backward travel to s_n+stepover on inner guide,
 * gradual descent to cut depth, tangential re-engagement for the next cut arc.
 */
function buildLeadInZone(
  guide: ArcLengthGuide,
  s_n: number,
  stepover: number,
  span: number,
  slotClearance: number,
  zCut: number,
  liftAmount: number,
  partLoop: LoopPoint[] | undefined,
  minDist: number | undefined
): ToolpathPoint[] {
  return sampleZone(
    guide, s_n, RETURN_END, 1, LEADIN_STEPS,
    stepover, span, slotClearance, zCut, liftAmount,
    partLoop, minDist, true
  );
}

function appendZone(target: ToolpathPoint[], zone: ToolpathPoint[], skipFirst: boolean): void {
  for (let i = skipFirst ? 1 : 0; i < zone.length; i++) target.push(zone[i]);
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export function generateFourZoneAdaptivePath(
  innerGuideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  const stepover = params.forwardIncrement;
  const { slotClearance, z: zCut, liftAmount = 0 } = params;

  if (innerGuideLoop.length < 3 || stepover <= 0 || slotClearance <= 0) return [];

  const span = forwardSpan(slotClearance, stepover);
  const spacing = Math.min(stepover / 8, slotClearance / 6, 0.4);
  const guide = buildArcLengthGuide(innerGuideLoop, spacing);
  if (guide.totalLength <= 0) return [];

  void signedLoopArea2D(innerGuideLoop);

  const numCycles = Math.ceil(guide.totalLength / stepover);
  const pts: ToolpathPoint[] = [];
  const { partLoop, minCenterDist } = params;

  for (let cycle = 0; cycle < numCycles; cycle++) {
    const s_n = cycle * stepover;

    const zone1 = buildCuttingArcZone(
      guide, s_n, stepover, span, slotClearance, zCut, partLoop, minCenterDist
    );
    const zone2 = buildExitFilletZone(
      guide, s_n, stepover, span, slotClearance, zCut, partLoop, minCenterDist
    );
    const zone3 = buildReturnThroughSlotZone(
      guide, s_n, stepover, span, slotClearance, zCut, liftAmount
    );
    const zone4 = buildLeadInZone(
      guide, s_n, stepover, span, slotClearance, zCut, liftAmount, partLoop, minCenterDist
    );

    appendZone(pts, zone1, cycle > 0);
    appendZone(pts, zone2, true);
    appendZone(pts, zone3, true);
    appendZone(pts, zone4, true);
  }

  return pts;
}

export function generateConstantEngagementTrochoid(
  innerGuideLoop: LoopPoint[],
  params: FourZoneParams
): ToolpathPoint[] {
  return generateFourZoneAdaptivePath(innerGuideLoop, params);
}
