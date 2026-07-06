import type { MaterialId, MaterialProfile, RecommendedMilling } from './feedsSpeedsCalculator';

export const MATERIAL_IDS: MaterialId[] = [
  'mild-steel',
  'solid-aluminium',
  'aluminium-composite',
  'hardwood',
  'softwood-plywood',
  'plastics-acrylic',
];

/** User-editable feeds/speeds values stored per material. */
export interface StoredMaterialProfile {
  chipLoad: number;
  stepoverPercentage: number;
  rampAngle: number;
  plungeRatio: number;
  adaptiveDocMinRatio: number;
  adaptiveDocMaxRatio: number;
  pocketDocMinRatio: number;
  pocketDocMaxRatio: number;
  finishAllowancePercent: number;
  finishAllowanceNote: string;
  recommendedMilling: RecommendedMilling;
  millingNote: string;
  isHard: boolean;
}

export type StoredMaterialProfiles = Record<MaterialId, StoredMaterialProfile>;

export function materialProfileToStored(profile: MaterialProfile): StoredMaterialProfile {
  return {
    chipLoad: profile.chipLoad,
    stepoverPercentage: profile.stepoverPercentage,
    rampAngle: profile.rampAngle,
    plungeRatio: profile.plungeRatio,
    adaptiveDocMinRatio: profile.adaptiveDocMinRatio,
    adaptiveDocMaxRatio: profile.adaptiveDocMaxRatio,
    pocketDocMinRatio: profile.pocketDocMinRatio,
    pocketDocMaxRatio: profile.pocketDocMaxRatio,
    finishAllowancePercent: profile.finishAllowancePercent,
    finishAllowanceNote: profile.finishAllowanceNote,
    recommendedMilling: profile.recommendedMilling,
    millingNote: profile.millingNote ?? '',
    isHard: profile.isHard,
  };
}

export function defaultStoredMaterialProfiles(
  baseProfiles: MaterialProfile[]
): StoredMaterialProfiles {
  return MATERIAL_IDS.reduce((acc, id) => {
    const profile = baseProfiles.find((m) => m.id === id) ?? baseProfiles[0];
    acc[id] = materialProfileToStored(profile);
    return acc;
  }, {} as StoredMaterialProfiles);
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value as number));
}

export function normalizeStoredMaterialProfile(
  value: Partial<StoredMaterialProfile> | undefined,
  fallback: StoredMaterialProfile
): StoredMaterialProfile {
  if (!value) return fallback;
  return {
    chipLoad: clampNum(value.chipLoad, 0.001, 0.5, fallback.chipLoad),
    stepoverPercentage: clampNum(value.stepoverPercentage, 1, 100, fallback.stepoverPercentage),
    rampAngle: clampNum(value.rampAngle, 0.1, 45, fallback.rampAngle),
    plungeRatio: clampNum(value.plungeRatio, 0.05, 1, fallback.plungeRatio),
    adaptiveDocMinRatio: clampNum(value.adaptiveDocMinRatio, 0.05, 10, fallback.adaptiveDocMinRatio),
    adaptiveDocMaxRatio: clampNum(
      value.adaptiveDocMaxRatio,
      0.05,
      10,
      Math.max(fallback.adaptiveDocMaxRatio, fallback.adaptiveDocMinRatio)
    ),
    pocketDocMinRatio: clampNum(value.pocketDocMinRatio, 0.05, 10, fallback.pocketDocMinRatio),
    pocketDocMaxRatio: clampNum(
      value.pocketDocMaxRatio,
      0.05,
      10,
      Math.max(fallback.pocketDocMaxRatio, fallback.pocketDocMinRatio)
    ),
    finishAllowancePercent: clampNum(value.finishAllowancePercent, 0.5, 50, fallback.finishAllowancePercent),
    finishAllowanceNote:
      typeof value.finishAllowanceNote === 'string' ? value.finishAllowanceNote : fallback.finishAllowanceNote,
    recommendedMilling:
      value.recommendedMilling === 'conventional' ? 'conventional' : 'climb',
    millingNote: typeof value.millingNote === 'string' ? value.millingNote : fallback.millingNote,
    isHard: value.isHard === false ? false : fallback.isHard,
  };
}

export function normalizeStoredMaterialProfiles(
  value: Partial<StoredMaterialProfiles> | undefined,
  baseProfiles: MaterialProfile[]
): StoredMaterialProfiles {
  const defaults = defaultStoredMaterialProfiles(baseProfiles);
  if (!value) return defaults;
  return MATERIAL_IDS.reduce((acc, id) => {
    acc[id] = normalizeStoredMaterialProfile(value[id], defaults[id]);
    return acc;
  }, {} as StoredMaterialProfiles);
}

export function resolveMaterialProfile(
  id: MaterialId,
  baseProfiles: MaterialProfile[],
  stored?: StoredMaterialProfiles | null
): MaterialProfile {
  const base = baseProfiles.find((m) => m.id === id) ?? baseProfiles[0];
  const override = stored?.[id];
  if (!override) return base;
  return {
    ...base,
    ...override,
    id: base.id,
    name: base.name,
    adaptiveDocMaxRatio: Math.max(override.adaptiveDocMinRatio, override.adaptiveDocMaxRatio),
    pocketDocMaxRatio: Math.max(override.pocketDocMinRatio, override.pocketDocMaxRatio),
  };
}
