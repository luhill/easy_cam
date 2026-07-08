import type { MaterialProfile, RecommendedMilling } from './feedsSpeedsCalculator';
import { MATERIAL_PROFILES } from './feedsSpeedsCalculator';

/** User-editable feeds/speeds values for one material row. */
export interface StoredMaterialProfile {
  chipLoad: number;
  stepoverPercentage: number;
  rampAngle: number;
  plungeRatio: number;
  adaptiveDocMaxRatio: number;
  pocketDocMaxRatio: number;
  finishAllowancePercent: number;
  recommendedMilling: RecommendedMilling;
  millingNote: string;
}

/** @deprecated Legacy stored profiles may still include min DOC ratios. */
type LegacyStoredMaterialProfile = StoredMaterialProfile & {
  adaptiveDocMinRatio?: number;
  pocketDocMinRatio?: number;
};

export interface FeedsMaterialRow {
  id: string;
  name: string;
  profile: StoredMaterialProfile;
}

export type FeedsMaterialLibrary = FeedsMaterialRow[];

export function materialProfileToStored(profile: MaterialProfile): StoredMaterialProfile {
  return {
    chipLoad: profile.chipLoad,
    stepoverPercentage: profile.stepoverPercentage,
    rampAngle: profile.rampAngle,
    plungeRatio: profile.plungeRatio,
    adaptiveDocMaxRatio: profile.adaptiveDocMaxRatio,
    pocketDocMaxRatio: profile.pocketDocMaxRatio,
    finishAllowancePercent: profile.finishAllowancePercent,
    recommendedMilling: profile.recommendedMilling,
    millingNote: profile.millingNote ?? '',
  };
}

export function defaultFeedsMaterialRows(baseProfiles: MaterialProfile[] = MATERIAL_PROFILES): FeedsMaterialLibrary {
  return baseProfiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    profile: materialProfileToStored(profile),
  }));
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value as number));
}

function resolveMaxDocRatio(
  maxValue: unknown,
  minValue: unknown,
  fallback: number
): number {
  const candidates = [maxValue, minValue].filter((v) => Number.isFinite(v)) as number[];
  const preferred = candidates.length > 0 ? Math.max(...candidates) : fallback;
  return clampNum(preferred, 0.05, 10, fallback);
}

export function normalizeStoredMaterialProfile(
  value: Partial<LegacyStoredMaterialProfile> | undefined,
  fallback: StoredMaterialProfile
): StoredMaterialProfile {
  if (!value) return fallback;
  return {
    chipLoad: clampNum(value.chipLoad, 0.001, 0.5, fallback.chipLoad),
    stepoverPercentage: clampNum(value.stepoverPercentage, 1, 100, fallback.stepoverPercentage),
    rampAngle: clampNum(value.rampAngle, 0.1, 45, fallback.rampAngle),
    plungeRatio: clampNum(value.plungeRatio, 0.05, 1, fallback.plungeRatio),
    adaptiveDocMaxRatio: resolveMaxDocRatio(
      value.adaptiveDocMaxRatio,
      value.adaptiveDocMinRatio,
      fallback.adaptiveDocMaxRatio
    ),
    pocketDocMaxRatio: resolveMaxDocRatio(
      value.pocketDocMaxRatio,
      value.pocketDocMinRatio,
      fallback.pocketDocMaxRatio
    ),
    finishAllowancePercent: clampNum(value.finishAllowancePercent, 0.5, 50, fallback.finishAllowancePercent),
    recommendedMilling:
      value.recommendedMilling === 'conventional' ? 'conventional' : 'climb',
    millingNote: typeof value.millingNote === 'string' ? value.millingNote : fallback.millingNote,
  };
}

function slugifyMaterialId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'material';
}

function uniqueMaterialId(name: string, rows: FeedsMaterialLibrary, excludeId?: string): string {
  const base = slugifyMaterialId(name);
  let candidate = base;
  let n = 2;
  while (rows.some((row) => row.id === candidate && row.id !== excludeId)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

export function normalizeFeedsMaterialRow(
  row: Partial<FeedsMaterialRow> | undefined,
  fallback: FeedsMaterialRow,
  allRows: FeedsMaterialLibrary
): FeedsMaterialRow {
  const name = typeof row?.name === 'string' && row.name.trim() ? row.name.trim() : fallback.name;
  const requestedId =
    typeof row?.id === 'string' && row.id.trim() ? row.id.trim() : fallback.id;
  const idTaken = allRows.some((entry) => entry.id === requestedId);
  const id = idTaken ? uniqueMaterialId(name, allRows, requestedId) : requestedId;
  return {
    id,
    name,
    profile: normalizeStoredMaterialProfile(row?.profile, fallback.profile),
  };
}

export function normalizeFeedsMaterialRows(
  value: FeedsMaterialLibrary | Record<string, StoredMaterialProfile> | undefined,
  baseProfiles: MaterialProfile[] = MATERIAL_PROFILES
): FeedsMaterialLibrary {
  const defaults = defaultFeedsMaterialRows(baseProfiles);
  if (!value) return defaults;

  if (Array.isArray(value)) {
    if (value.length === 0) return defaults;
    const normalized: FeedsMaterialLibrary = [];
    value.forEach((row, index) => {
      const fallback = defaults[index] ?? defaults[0];
      const next = normalizeFeedsMaterialRow(row, fallback, normalized);
      normalized.push(next);
    });
    return normalized;
  }

  const legacy = value as Record<string, LegacyStoredMaterialProfile>;
  return defaults.map((fallback) => {
    const legacyProfile = legacy[fallback.id];
    return {
      id: fallback.id,
      name: fallback.name,
      profile: normalizeStoredMaterialProfile(legacyProfile, fallback.profile),
    };
  });
}

export function createFeedsMaterialRow(
  rows: FeedsMaterialLibrary,
  template?: FeedsMaterialRow
): FeedsMaterialRow {
  const source = template ?? rows[0] ?? defaultFeedsMaterialRows()[0];
  const name = 'New material';
  return {
    id: uniqueMaterialId(name, rows),
    name,
    profile: { ...source.profile },
  };
}

export function resolveMaterialProfile(
  id: string,
  baseProfiles: MaterialProfile[],
  rows?: FeedsMaterialLibrary | null
): MaterialProfile {
  const library = rows ?? defaultFeedsMaterialRows(baseProfiles);
  const row = library.find((entry) => entry.id === id) ?? library[0];
  const builtin = baseProfiles.find((m) => m.id === row.id);
  const profile = row.profile;

  if (builtin) {
    return {
      ...builtin,
      ...profile,
      id: builtin.id,
      name: row.name,
    };
  }

  return {
    id: row.id,
    name: row.name,
    chipLoad: profile.chipLoad,
    stepoverPercentage: profile.stepoverPercentage,
    rampAngle: profile.rampAngle,
    plungeRatio: profile.plungeRatio,
    adaptiveDocMaxRatio: profile.adaptiveDocMaxRatio,
    pocketDocMaxRatio: profile.pocketDocMaxRatio,
    finishAllowancePercent: profile.finishAllowancePercent,
    recommendedMilling: profile.recommendedMilling,
    millingNote: profile.millingNote,
  };
}
