import type { OperationDefaults } from '../types/operations';
import { DEFAULT_SETTINGS } from '../types/operations';

export interface NumericLimit {
  min: number;
  max: number;
}

type ClampedSettingKey = Exclude<
  keyof OperationDefaults,
  | 'finishingPass'
  | 'climbMilling'
  | 'adaptiveMode'
  | 'outlineEntryType'
  | 'chipClearBeforeFinal'
>;

export const SETTING_LIMITS: Record<ClampedSettingKey, NumericLimit> = {
  toolDiameter: { min: 0.1, max: 25 },
  feedRate: { min: 1, max: 10000 },
  adjustedFeedRate: { min: 1, max: 10000 },
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
  finishPassCount: { min: 1, max: 5 },
  chipClearHeight: { min: 0, max: 50 },
  peckFullRetractEvery: { min: 0, max: 20 },
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
  // Legacy ops without adjustedFeedRate: derive a mild chip-thinning boost from base feed.
  if (
    settings.adjustedFeedRate === undefined &&
    Number.isFinite(merged.feedRate) &&
    merged.feedRate > 0
  ) {
    const stepoverMm = merged.toolDiameter * (merged.stepover / 100);
    const D = Math.max(merged.toolDiameter, 0.01);
    const ae = Math.min(Math.max(stepoverMm, 0.001), D * 0.999);
    let factor = 1;
    if (ae < D * 0.95) {
      const denom = 2 * Math.sqrt(ae * (D - ae));
      if (denom > 1e-9) factor = Math.min(1.45, D / denom);
    }
    merged.adjustedFeedRate = clampSettingValue(
      'adjustedFeedRate',
      Math.round(merged.feedRate * factor)
    );
  }
  merged.adaptiveMode = !!merged.adaptiveMode;
  merged.finishingPass = !!merged.finishingPass;
  merged.chipClearBeforeFinal = merged.chipClearBeforeFinal !== false;
  merged.climbMilling = merged.climbMilling !== false;
  const entryType = merged.outlineEntryType;
  merged.outlineEntryType =
    entryType === 'helix' || entryType === 'straight' ? entryType : 'linear';
  return merged as OperationDefaults;
}
