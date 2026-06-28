import type { OperationDefaults } from '../types/operations';

export interface NumericLimit {
  min: number;
  max: number;
}

export const SETTING_LIMITS: Record<keyof OperationDefaults, NumericLimit> = {
  toolDiameter: { min: 0.1, max: 25 },
  feedRate: { min: 1, max: 10000 },
  plungeRate: { min: 1, max: 5000 },
  stepDown: { min: 0.05, max: 50 },
  stepover: { min: 1, max: 100 },
  spindleSpeed: { min: 100, max: 30000 },
  clearance: { min: 0, max: 100 },
  depth: { min: 0.1, max: 500 },
  radialOffset: { min: -50, max: 50 },
  slotWidthPercent: { min: 125, max: 200 },
  liftAmount: { min: 0, max: 20 },
  helixDiameterPercent: { min: 50, max: 400 },
  helixAngleDeg: { min: 0.5, max: 45 },
  helixFeedRate: { min: 1, max: 5000 },
};

export function clampSettingValue(key: keyof OperationDefaults, value: number): number {
  if (!Number.isFinite(value)) {
    return SETTING_LIMITS[key].min;
  }
  const { min, max } = SETTING_LIMITS[key];
  return Math.min(max, Math.max(min, value));
}

export function clampOperationSettings(settings: OperationDefaults): OperationDefaults {
  const result = { ...settings };
  for (const key of Object.keys(SETTING_LIMITS) as (keyof OperationDefaults)[]) {
    result[key] = clampSettingValue(key, result[key]);
  }
  return result;
}
