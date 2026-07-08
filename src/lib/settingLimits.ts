import type { OperationDefaults } from '../types/operations';
import { DEFAULT_SETTINGS } from '../types/operations';

export interface NumericLimit {
  min: number;
  max: number;
}

type ClampedSettingKey = Exclude<
  keyof OperationDefaults,
  'finishingPass' | 'climbMilling' | 'adaptiveMode' | 'outlineEntryType'
>;

export const SETTING_LIMITS: Record<ClampedSettingKey, NumericLimit> = {
  toolDiameter: { min: 0.1, max: 25 },
  feedRate: { min: 1, max: 10000 },
  plungeRate: { min: 1, max: 5000 },
  stepDown: { min: 0.05, max: 50 },
  stepover: { min: 1, max: 100 },
  spindleSpeed: { min: 100, max: 30000 },
  depthOffset: { min: -50, max: 50 },
  zStartOffset: { min: 0, max: 50 },
  radialOffset: { min: -50, max: 50 },
  slotWidthPercent: { min: 125, max: 200 },
  liftAmount: { min: 0, max: 20 },
  boreDiameterPercent: { min: 100, max: 400 },
  rampAngleDeg: { min: 0.5, max: 45 },
  rampLengthToolDiameters: { min: 0.5, max: 50 },
  boreTaperAngleDeg: { min: 0, max: 15 },
  helixFeedRate: { min: 1, max: 5000 },
  finishingStockPercent: { min: 0.5, max: 50 },
};

export function clampSettingValue(key: ClampedSettingKey, value: number): number {
  if (!Number.isFinite(value)) {
    return SETTING_LIMITS[key].min;
  }
  const { min, max } = SETTING_LIMITS[key];
  return Math.min(max, Math.max(min, value));
}

export function clampOperationSettings(
  settings: Partial<OperationDefaults> & {
    depth?: number;
    clearance?: number;
    helixDiameterPercent?: number;
    helixAngleDeg?: number;
  }
): OperationDefaults {
  const { depth: _legacyDepth, clearance: _legacyClearance, helixDiameterPercent, helixAngleDeg, ...rest } =
    settings;
  const merged = { ...DEFAULT_SETTINGS, ...rest } as OperationDefaults & {
    helixDiameterPercent?: number;
    helixAngleDeg?: number;
  };
  if (helixAngleDeg !== undefined && rest.rampAngleDeg === undefined) {
    merged.rampAngleDeg = helixAngleDeg;
  }
  if (
    helixDiameterPercent !== undefined &&
    rest.boreDiameterPercent === undefined
  ) {
    merged.boreDiameterPercent = helixDiameterPercent * 3;
  }
  for (const key of Object.keys(SETTING_LIMITS) as (keyof typeof SETTING_LIMITS)[]) {
    merged[key] = clampSettingValue(key, merged[key]);
  }
  merged.adaptiveMode = !!merged.adaptiveMode;
  merged.finishingPass = !!merged.finishingPass;
  merged.climbMilling = merged.climbMilling !== false;
  const entryType = merged.outlineEntryType;
  merged.outlineEntryType =
    entryType === 'helix' || entryType === 'straight' ? entryType : 'linear';
  return merged as OperationDefaults;
}
