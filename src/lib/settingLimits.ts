import type { OperationDefaults } from '../types/operations';
import { DEFAULT_SETTINGS } from '../types/operations';

export interface NumericLimit {
  min: number;
  max: number;
}

export const SETTING_LIMITS: Record<
  Exclude<keyof OperationDefaults, 'finishingPass' | 'climbMilling'>,
  NumericLimit
> = {
  toolDiameter: { min: 0.1, max: 25 },
  feedRate: { min: 1, max: 10000 },
  plungeRate: { min: 1, max: 5000 },
  stepDown: { min: 0.05, max: 50 },
  stepover: { min: 1, max: 100 },
  spindleSpeed: { min: 100, max: 30000 },
  depthOffset: { min: -50, max: 50 },
  radialOffset: { min: -50, max: 50 },
  slotWidthPercent: { min: 125, max: 200 },
  liftAmount: { min: 0, max: 20 },
  boreDiameterPercent: { min: 100, max: 400 },
  helixAngleDeg: { min: 0.5, max: 45 },
  boreTaperAngleDeg: { min: 0, max: 15 },
  helixFeedRate: { min: 1, max: 5000 },
};

export function clampSettingValue(
  key: Exclude<keyof OperationDefaults, 'finishingPass' | 'climbMilling'>,
  value: number
): number {
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
  }
): OperationDefaults {
  const { depth: _legacyDepth, clearance: _legacyClearance, helixDiameterPercent, ...rest } =
    settings;
  const merged = { ...DEFAULT_SETTINGS, ...rest } as OperationDefaults & {
    helixDiameterPercent?: number;
  };
  if (
    helixDiameterPercent !== undefined &&
    rest.boreDiameterPercent === undefined
  ) {
    merged.boreDiameterPercent = helixDiameterPercent * 3;
  }
  for (const key of Object.keys(SETTING_LIMITS) as (keyof typeof SETTING_LIMITS)[]) {
    merged[key] = clampSettingValue(key, merged[key]);
  }
  return merged as OperationDefaults;
}
