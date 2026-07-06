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
    chipLoad: 0.03,
    stepoverPercentage: 10,
    rampAngle: 1.5,
    plungeRatio: 0.3,
  },
  'aluminium-composite': {
    name: 'Aluminum Composite Panel (ACP)',
    chipLoad: 0.06,
    stepoverPercentage: 40,
    rampAngle: 2.5,
    plungeRatio: 0.4,
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
  id: MaterialId;
  adaptiveDocMinRatio: number;
  adaptiveDocMaxRatio: number;
  pocketDocMinRatio: number;
  pocketDocMaxRatio: number;
  finishAllowancePercent: number;
  finishAllowanceNote: string;
  isHard: boolean;
  recommendedMilling: RecommendedMilling;
  millingNote?: string;
}

const MATERIAL_DOC_AND_MILLING: Record<
  MaterialId,
  Pick<
    MaterialProfile,
    | 'adaptiveDocMinRatio'
    | 'adaptiveDocMaxRatio'
    | 'pocketDocMinRatio'
    | 'pocketDocMaxRatio'
    | 'finishAllowancePercent'
    | 'finishAllowanceNote'
    | 'isHard'
    | 'recommendedMilling'
    | 'millingNote'
  >
> = {
  'mild-steel': {
    adaptiveDocMinRatio: 0.5,
    adaptiveDocMaxRatio: 1.0,
    pocketDocMinRatio: 0.25,
    pocketDocMaxRatio: 0.5,
    finishAllowancePercent: 3.7,
    finishAllowanceNote:
      'Minimizes machine deflection; stops high-frequency tool chatter.',
    isHard: true,
    recommendedMilling: 'climb',
    millingNote: 'Keeps constant engagement in adaptive/trochoidal paths.',
  },
  'solid-aluminium': {
    adaptiveDocMinRatio: 0.75,
    adaptiveDocMaxRatio: 1.5,
    pocketDocMinRatio: 0.4,
    pocketDocMaxRatio: 0.8,
    finishAllowancePercent: 6.2,
    finishAllowanceNote:
      'Gives a clean bite while remaining light enough to prevent the material from gumming the tool.',
    isHard: true,
    recommendedMilling: 'climb',
    millingNote: 'Improves chip evacuation and reduces rubbing/work hardening.',
  },
  'aluminium-composite': {
    adaptiveDocMinRatio: 0.4,
    adaptiveDocMaxRatio: 0.9,
    pocketDocMinRatio: 0.25,
    pocketDocMaxRatio: 0.55,
    finishAllowancePercent: 10.0,
    finishAllowanceNote:
      'Crucial: Needs a heavy bite so the O-flute cleanly slices both the aluminum skin and the soft plastic core without melting.',
    isHard: true,
    recommendedMilling: 'climb',
    millingNote: 'Cleaner skin finish; use sharp tooling and support sheet well.',
  },
  hardwood: {
    adaptiveDocMinRatio: 1.0,
    adaptiveDocMaxRatio: 2.0,
    pocketDocMinRatio: 0.5,
    pocketDocMaxRatio: 1.0,
    finishAllowancePercent: 10.0,
    finishAllowanceNote:
      'Deep enough to cut cleanly past the crushed fibers left behind by the heavy roughing pass.',
    isHard: false,
    recommendedMilling: 'climb',
    millingNote: 'Standard CNC router practice for most contour and adaptive cuts.',
  },
  'softwood-plywood': {
    adaptiveDocMinRatio: 1.5,
    adaptiveDocMaxRatio: 2.5,
    pocketDocMinRatio: 0.75,
    pocketDocMaxRatio: 1.5,
    finishAllowancePercent: 12.5,
    finishAllowanceNote:
      'Ensures the bit slices past any fuzzy splinters left on the profile walls.',
    isHard: false,
    recommendedMilling: 'climb',
    millingNote: 'Try conventional on thin plywood if climb lifts veneer at exit.',
  },
  'plastics-acrylic': {
    adaptiveDocMinRatio: 0.75,
    adaptiveDocMaxRatio: 1.5,
    pocketDocMinRatio: 0.4,
    pocketDocMaxRatio: 0.8,
    finishAllowancePercent: 12.5,
    finishAllowanceNote:
      'Crucial: Industry standard for routing acrylic is 0.4mm to 0.6mm. Anything less causes the tool to rub, leading to edge hazing and welding.',
    isHard: false,
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

import type { StoredMaterialProfiles } from './feedsMaterialProfiles';
import { resolveMaterialProfile } from './feedsMaterialProfiles';

export function getMaterialProfile(
  id: MaterialId,
  stored?: StoredMaterialProfiles | null
): MaterialProfile {
  return resolveMaterialProfile(id, MATERIAL_PROFILES, stored);
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

/**
 * Feed multiplier to maintain chip thickness at partial radial engagement (chip thinning).
 * M = D / (2 × √(ae × (D − ae))); 1.0 at 50% engagement, >1 when stepover is smaller.
 */
export function chipThinningFeedMultiplier(toolDiameterMm: number, stepoverMm: number): number {
  const D = Math.max(toolDiameterMm, 0.01);
  const ae = Math.min(Math.max(stepoverMm, 0.001), D * 0.999);
  if (ae >= D * 0.95) return 1;
  const denom = 2 * Math.sqrt(ae * (D - ae));
  if (denom <= 1e-9) return 1;
  return D / denom;
}

export function stepoverMmFromPercent(toolDiameterMm: number, stepoverPct: number): number {
  return Math.max(toolDiameterMm, 0.01) * (Math.max(stepoverPct, 0) / 100);
}

export interface FeedsSpeedsInputs {
  materialId: MaterialId;
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
  stored?: StoredMaterialProfiles | null
): FeedsSpeedsResults {
  const profile = getMaterialProfile(inputs.materialId, stored);
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
    adaptiveDocLabel: `${(profile.adaptiveDocMinRatio * toolD).toFixed(2)}–${(profile.adaptiveDocMaxRatio * toolD).toFixed(2)} mm`,
    pocketDocLabel: `${(profile.pocketDocMinRatio * toolD).toFixed(2)}–${(profile.pocketDocMaxRatio * toolD).toFixed(2)} mm`,
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
  stored?: StoredMaterialProfiles | null
): Partial<OperationDefaults> {
  const results = calculateFeedsSpeeds(inputs, stored);
  const toolD = Math.max(inputs.toolDiameterMm, 0.01);
  const { profile } = results;

  const partial: Partial<OperationDefaults> = {
    toolDiameter: toolD,
    spindleSpeed: Math.max(100, Math.round(inputs.rpm)),
    feedRate: Math.max(1, Math.round(results.adjustedFeedMmMin)),
    stepover: inputs.stepoverPct,
    rampAngleDeg: results.rampAngleDeg,
    plungeRate: Math.max(1, Math.round(results.plungeFeedMmMin)),
    helixFeedRate: Math.max(1, Math.round(results.plungeFeedMmMin)),
    climbMilling: profile.recommendedMilling === 'climb',
  };

  if (type === 'pocket') {
    partial.stepDown = profile.pocketDocMinRatio * toolD;
  } else if (type !== 'custom-gcode') {
    partial.stepDown = profile.adaptiveDocMinRatio * toolD;
  }

  if (type === 'outline' || type === 'adaptive-outline') {
    partial.finishingStockPercent = results.finishAllowancePercent;
  }

  return partial;
}
