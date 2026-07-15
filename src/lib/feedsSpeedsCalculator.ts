import type { OperationDefaults, OperationType } from '../types/operations';

export type MaterialId =
  | 'mild-steel'
  | 'solid-aluminium'
  | 'aluminium-composite'
  | 'hardwood'
  | 'softwood-plywood'
  | 'plastics-acrylic';

export type RecommendedMilling = 'climb' | 'conventional';

/** Primary feeds/speeds defaults loaded when a material is selected. */
export interface MaterialDefaults {
  name: string;
  chipLoad: number;
  stepoverPercentage: number;
  rampAngle: number;
  plungeRatio: number;
}

export const MATERIAL_DEFAULTS: Record<MaterialId, MaterialDefaults> = {
  'mild-steel': {
    name: 'Mild Steel',
    chipLoad: 0.015,
    stepoverPercentage: 5,
    rampAngle: 1.0,
    plungeRatio: 0.25,
  },
  'solid-aluminium': {
    name: 'Aluminum (6061)',
    // Conservative chip load for small router bits — aggressive loads snap cutters.
    chipLoad: 0.02,
    stepoverPercentage: 10,
    rampAngle: 1.5,
    plungeRatio: 0.25,
  },
  'aluminium-composite': {
    name: 'Aluminum Composite Panel (ACP)',
    chipLoad: 0.05,
    stepoverPercentage: 35,
    rampAngle: 2.5,
    plungeRatio: 0.35,
  },
  hardwood: {
    name: 'Hardwood',
    chipLoad: 0.04,
    stepoverPercentage: 40,
    rampAngle: 3.0,
    plungeRatio: 0.5,
  },
  'softwood-plywood': {
    name: 'Softwood / Plywood',
    chipLoad: 0.05,
    stepoverPercentage: 45,
    rampAngle: 3.0,
    plungeRatio: 0.5,
  },
  'plastics-acrylic': {
    name: 'Plastics / Acrylic',
    chipLoad: 0.05,
    stepoverPercentage: 25,
    rampAngle: 2.0,
    plungeRatio: 0.4,
  },
};

export interface MaterialProfile extends MaterialDefaults {
  id: string;
  adaptiveDocMaxRatio: number;
  pocketDocMaxRatio: number;
  finishAllowancePercent: number;
  recommendedMilling: RecommendedMilling;
  millingNote?: string;
}

const MATERIAL_DOC_AND_MILLING: Record<
  MaterialId,
  Pick<
    MaterialProfile,
    | 'adaptiveDocMaxRatio'
    | 'pocketDocMaxRatio'
    | 'finishAllowancePercent'
    | 'recommendedMilling'
    | 'millingNote'
  >
> = {
  'mild-steel': {
    adaptiveDocMaxRatio: 1.0,
    pocketDocMaxRatio: 0.5,
    finishAllowancePercent: 3.7,
    recommendedMilling: 'climb',
    millingNote: 'Keeps constant engagement in adaptive/trochoidal paths.',
  },
  'solid-aluminium': {
    // Cap DOC at ~0.75×D for hobby spindles / small carbide bits.
    adaptiveDocMaxRatio: 0.75,
    pocketDocMaxRatio: 0.5,
    finishAllowancePercent: 6.2,
    recommendedMilling: 'climb',
    millingNote: 'Improves chip evacuation and reduces rubbing/work hardening.',
  },
  'aluminium-composite': {
    adaptiveDocMaxRatio: 0.7,
    pocketDocMaxRatio: 0.45,
    finishAllowancePercent: 10.0,
    recommendedMilling: 'climb',
    millingNote: 'Cleaner skin finish; use sharp tooling and support sheet well.',
  },
  hardwood: {
    adaptiveDocMaxRatio: 2.0,
    pocketDocMaxRatio: 1.0,
    finishAllowancePercent: 10.0,
    recommendedMilling: 'climb',
    millingNote: 'Standard CNC router practice for most contour and adaptive cuts.',
  },
  'softwood-plywood': {
    adaptiveDocMaxRatio: 2.5,
    pocketDocMaxRatio: 1.5,
    finishAllowancePercent: 12.5,
    recommendedMilling: 'climb',
    millingNote: 'Try conventional on thin plywood if climb lifts veneer at exit.',
  },
  'plastics-acrylic': {
    adaptiveDocMaxRatio: 1.5,
    pocketDocMaxRatio: 0.8,
    finishAllowancePercent: 12.5,
    recommendedMilling: 'climb',
    millingNote: 'Reduces heat buildup and melted swarf re-welding to the part.',
  },
};

export const MATERIAL_PROFILES: MaterialProfile[] = (Object.keys(MATERIAL_DEFAULTS) as MaterialId[]).map(
  (id) => ({
    id,
    ...MATERIAL_DEFAULTS[id],
    ...MATERIAL_DOC_AND_MILLING[id],
  })
);

export function getMaterialDefaults(id: MaterialId): MaterialDefaults {
  return MATERIAL_DEFAULTS[id] ?? MATERIAL_DEFAULTS['mild-steel'];
}

import type { FeedsMaterialLibrary } from './feedsMaterialProfiles';
import { resolveMaterialProfile } from './feedsMaterialProfiles';

export function getMaterialProfile(
  id: string,
  rows?: FeedsMaterialLibrary | null
): MaterialProfile {
  return resolveMaterialProfile(id, MATERIAL_PROFILES, rows);
}

/** Cutting feedrate (mm/min) = RPM × flutes × chip load (mm/tooth). */
export function cuttingFeedrateMmMin(
  rpm: number,
  fluteCount: number,
  chipLoadMm: number
): number {
  if (rpm <= 0 || fluteCount <= 0 || chipLoadMm <= 0) return 0;
  return rpm * fluteCount * chipLoadMm;
}

/** Max chip-thinning boost — uncapped values break small bits in aluminium. */
export const CHIP_THINNING_FEED_CAP = 1.45;

/**
 * Feed multiplier to maintain chip thickness at partial radial engagement (chip thinning).
 * M = D / (2 × √(ae × (D − ae))); 1.0 at 50% engagement, >1 when stepover is smaller.
 * Capped at {@link CHIP_THINNING_FEED_CAP} so aggressive aluminium profiles stay safe.
 */
export function chipThinningFeedMultiplier(toolDiameterMm: number, stepoverMm: number): number {
  const D = Math.max(toolDiameterMm, 0.01);
  const ae = Math.min(Math.max(stepoverMm, 0.001), D * 0.999);
  if (ae >= D * 0.95) return 1;
  const denom = 2 * Math.sqrt(ae * (D - ae));
  if (denom <= 1e-9) return 1;
  return Math.min(CHIP_THINNING_FEED_CAP, D / denom);
}

export function stepoverMmFromPercent(toolDiameterMm: number, stepoverPct: number): number {
  return Math.max(toolDiameterMm, 0.01) * (Math.max(stepoverPct, 0) / 100);
}

export interface FeedsSpeedsInputs {
  materialId: string;
  toolDiameterMm: number;
  fluteCount: number;
  rpm: number;
  chipLoadMm: number;
  /** Planned radial stepover as % of tool diameter (for chip thinning). */
  stepoverPct: number;
}

export interface FeedsSpeedsResults {
  profile: MaterialProfile;
  cuttingFeedMmMin: number;
  chipThinningFactor: number;
  adjustedFeedMmMin: number;
  stepoverRangeLabel: string;
  stepoverMm: number;
  adaptiveDocLabel: string;
  pocketDocLabel: string;
  helixRampLabel: string;
  rampAngleDeg: number;
  plungeFeedLabel: string;
  plungeFeedMmMin: number;
  finishAllowancePercent: number;
  finishAllowanceMm: number;
  finishAllowanceLabel: string;
  millingDirectionLabel: string;
  millingNote?: string;
  lowRpmWarning: boolean;
}

export function calculateFeedsSpeeds(
  inputs: FeedsSpeedsInputs,
  rows?: FeedsMaterialLibrary | null
): FeedsSpeedsResults {
  const profile = getMaterialProfile(inputs.materialId, rows);
  const toolD = Math.max(inputs.toolDiameterMm, 0.01);
  const flutes = Math.max(Math.round(inputs.fluteCount), 1);
  const rpm = Math.max(inputs.rpm, 0);
  const chipLoad = Math.max(inputs.chipLoadMm, 0.001);
  const stepoverPct =
    inputs.stepoverPct > 0 ? inputs.stepoverPct : profile.stepoverPercentage;
  const stepoverMm = stepoverMmFromPercent(toolD, stepoverPct);

  const cuttingFeedMmMin = cuttingFeedrateMmMin(rpm, flutes, chipLoad);
  const chipThinningFactor = chipThinningFeedMultiplier(toolD, stepoverMm);
  const adjustedFeedMmMin = cuttingFeedMmMin * chipThinningFactor;
  const plungeFeedMmMin = cuttingFeedMmMin * profile.plungeRatio;
  const finishAllowancePercent = profile.finishAllowancePercent;
  const finishAllowanceMm = toolD * (finishAllowancePercent / 100);

  return {
    profile,
    cuttingFeedMmMin,
    chipThinningFactor,
    adjustedFeedMmMin,
    stepoverRangeLabel: `${profile.stepoverPercentage}% of tool Ø`,
    stepoverMm,
    adaptiveDocLabel: `${(profile.adaptiveDocMaxRatio * toolD).toFixed(2)} mm`,
    pocketDocLabel: `${(profile.pocketDocMaxRatio * toolD).toFixed(2)} mm`,
    helixRampLabel: `${profile.rampAngle.toFixed(1)}°`,
    rampAngleDeg: profile.rampAngle,
    plungeFeedLabel: `${Math.round(plungeFeedMmMin)} mm/min (${Math.round(profile.plungeRatio * 100)}% of cut feed)`,
    plungeFeedMmMin,
    finishAllowancePercent,
    finishAllowanceMm,
    finishAllowanceLabel: `${finishAllowanceMm.toFixed(2)} mm (${finishAllowancePercent.toFixed(1)}% of tool Ø)`,
    millingDirectionLabel:
      profile.recommendedMilling === 'climb' ? 'Climb milling' : 'Conventional milling',
    millingNote: profile.millingNote,
    lowRpmWarning: rpm > 0 && rpm < 10000,
  };
}

export function formatFeed(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return `${Math.round(value)} mm/min`;
}

export function formatFactor(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return `${value.toFixed(2)}×`;
}

/** Map calculator inputs/outputs to operation setting defaults for new operations. */
export function operationSettingsFromFeedsCalculator(
  type: OperationType,
  inputs: FeedsSpeedsInputs,
  rows?: FeedsMaterialLibrary | null
): Partial<OperationDefaults> {
  const results = calculateFeedsSpeeds(inputs, rows);
  const toolD = Math.max(inputs.toolDiameterMm, 0.01);
  const { profile } = results;

  // Store both base and chip-thinned feeds — outline UI exposes both.
  const partial: Partial<OperationDefaults> = {
    toolDiameter: toolD,
    spindleSpeed: Math.max(100, Math.round(inputs.rpm)),
    feedRate: Math.max(1, Math.round(results.cuttingFeedMmMin)),
    adjustedFeedRate: Math.max(1, Math.round(results.adjustedFeedMmMin)),
    stepover: inputs.stepoverPct,
    rampAngleDeg: results.rampAngleDeg,
    plungeRate: Math.max(1, Math.round(results.plungeFeedMmMin)),
    helixFeedRate: Math.max(1, Math.round(results.plungeFeedMmMin)),
    climbMilling: profile.recommendedMilling === 'climb',
  };

  if (type === 'pocket') {
    partial.stepDown = profile.pocketDocMaxRatio * toolD;
    partial.adaptiveMode = false;
  } else if (type === 'drill') {
    // Peck depth ≈ 1× tool Ø — not adaptive milling DOC (that over-plunges).
    partial.stepDown = toolD;
  } else if (type !== 'custom-gcode') {
    partial.stepDown = profile.adaptiveDocMaxRatio * toolD;
  }

  if (type === 'outline' || type === 'adaptive-outline') {
    partial.finishingStockPercent = results.finishAllowancePercent;
  }

  return partial;
}

/** Chip-thinned feed for partial radial engagement (adaptive clearing / finish allowance). */
export function adjustedCuttingFeedMmMin(
  baseFeedMmMin: number,
  toolDiameterMm: number,
  engagementMm: number
): number {
  const factor = chipThinningFeedMultiplier(toolDiameterMm, engagementMm);
  return Math.max(1, baseFeedMmMin * factor);
}
