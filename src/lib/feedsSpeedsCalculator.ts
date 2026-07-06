export type MaterialId =
  | 'mild-steel'
  | 'hardwood'
  | 'softwood-plywood'
  | 'plastics-acrylic';

export interface MaterialProfile {
  id: MaterialId;
  label: string;
  /** Target chip load per tooth (mm). */
  defaultChipLoadMm: number;
  stepoverMinPct: number;
  stepoverMaxPct: number;
  adaptiveDocMinRatio: number;
  adaptiveDocMaxRatio: number;
  pocketDocMinRatio: number;
  pocketDocMaxRatio: number;
  helixRampMinDeg: number;
  helixRampMaxDeg: number;
  plungeFeedMinPct: number;
  plungeFeedMaxPct: number;
  isHard: boolean;
}

export const MATERIAL_PROFILES: MaterialProfile[] = [
  {
    id: 'mild-steel',
    label: 'Mild Steel',
    defaultChipLoadMm: 0.018,
    stepoverMinPct: 5,
    stepoverMaxPct: 10,
    adaptiveDocMinRatio: 0.5,
    adaptiveDocMaxRatio: 1.0,
    pocketDocMinRatio: 0.25,
    pocketDocMaxRatio: 0.5,
    helixRampMinDeg: 1,
    helixRampMaxDeg: 1.5,
    plungeFeedMinPct: 20,
    plungeFeedMaxPct: 30,
    isHard: true,
  },
  {
    id: 'hardwood',
    label: 'Hardwood',
    defaultChipLoadMm: 0.055,
    stepoverMinPct: 40,
    stepoverMaxPct: 50,
    adaptiveDocMinRatio: 1.0,
    adaptiveDocMaxRatio: 2.0,
    pocketDocMinRatio: 0.5,
    pocketDocMaxRatio: 1.0,
    helixRampMinDeg: 2,
    helixRampMaxDeg: 3,
    plungeFeedMinPct: 40,
    plungeFeedMaxPct: 50,
    isHard: false,
  },
  {
    id: 'softwood-plywood',
    label: 'Softwood / Plywood',
    defaultChipLoadMm: 0.09,
    stepoverMinPct: 40,
    stepoverMaxPct: 50,
    adaptiveDocMinRatio: 1.5,
    adaptiveDocMaxRatio: 2.5,
    pocketDocMinRatio: 0.75,
    pocketDocMaxRatio: 1.5,
    helixRampMinDeg: 2,
    helixRampMaxDeg: 3,
    plungeFeedMinPct: 40,
    plungeFeedMaxPct: 50,
    isHard: false,
  },
  {
    id: 'plastics-acrylic',
    label: 'Plastics / Acrylic',
    defaultChipLoadMm: 0.06,
    stepoverMinPct: 40,
    stepoverMaxPct: 50,
    adaptiveDocMinRatio: 0.75,
    adaptiveDocMaxRatio: 1.5,
    pocketDocMinRatio: 0.4,
    pocketDocMaxRatio: 0.8,
    helixRampMinDeg: 2,
    helixRampMaxDeg: 2.5,
    plungeFeedMinPct: 30,
    plungeFeedMaxPct: 40,
    isHard: false,
  },
];

export function getMaterialProfile(id: MaterialId): MaterialProfile {
  return MATERIAL_PROFILES.find((m) => m.id === id) ?? MATERIAL_PROFILES[0];
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

export function recommendedStepoverMidPct(profile: MaterialProfile): number {
  return (profile.stepoverMinPct + profile.stepoverMaxPct) / 2;
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
  plungeFeedLabel: string;
  plungeFeedMin: number;
  plungeFeedMax: number;
  lowRpmWarning: boolean;
}

export function calculateFeedsSpeeds(inputs: FeedsSpeedsInputs): FeedsSpeedsResults {
  const profile = getMaterialProfile(inputs.materialId);
  const toolD = Math.max(inputs.toolDiameterMm, 0.01);
  const flutes = Math.max(Math.round(inputs.fluteCount), 1);
  const rpm = Math.max(inputs.rpm, 0);
  const chipLoad = Math.max(inputs.chipLoadMm, 0.001);
  const stepoverPct =
    inputs.stepoverPct > 0 ? inputs.stepoverPct : recommendedStepoverMidPct(profile);
  const stepoverMm = stepoverMmFromPercent(toolD, stepoverPct);

  const cuttingFeedMmMin = cuttingFeedrateMmMin(rpm, flutes, chipLoad);
  const chipThinningFactor = chipThinningFeedMultiplier(toolD, stepoverMm);
  const adjustedFeedMmMin = cuttingFeedMmMin * chipThinningFactor;

  const plungeMin = cuttingFeedMmMin * (profile.plungeFeedMinPct / 100);
  const plungeMax = cuttingFeedMmMin * (profile.plungeFeedMaxPct / 100);

  return {
    profile,
    cuttingFeedMmMin,
    chipThinningFactor,
    adjustedFeedMmMin,
    stepoverRangeLabel: `${profile.stepoverMinPct}–${profile.stepoverMaxPct}% of tool Ø`,
    stepoverMm,
    adaptiveDocLabel: `${(profile.adaptiveDocMinRatio * toolD).toFixed(2)}–${(profile.adaptiveDocMaxRatio * toolD).toFixed(2)} mm`,
    pocketDocLabel: `${(profile.pocketDocMinRatio * toolD).toFixed(2)}–${(profile.pocketDocMaxRatio * toolD).toFixed(2)} mm`,
    helixRampLabel: `${profile.helixRampMinDeg}°–${profile.helixRampMaxDeg}°`,
    plungeFeedLabel: `${Math.round(plungeMin)}–${Math.round(plungeMax)} mm/min`,
    plungeFeedMin: plungeMin,
    plungeFeedMax: plungeMax,
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
