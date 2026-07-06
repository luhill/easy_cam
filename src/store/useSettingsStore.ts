import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ToolOrigin } from '../lib/geometryProcessing';
import type { UiTheme } from '../lib/uiTheme';
import { getMaterialDefaults, type MaterialId } from '../lib/feedsSpeedsCalculator';
import { DEFAULT_WCS_Z_ABOVE_STOCK } from '../lib/cutDepth';
import {
  DEFAULT_SAFE_HEIGHT,
  DEFAULT_TOOLPATH_RESOLUTION,
  DEFAULT_TRAVEL_FEED_RATE,
} from '../lib/toolpathConfig';

export type GcodeOutputFormat = 'fluidnc';

export const GCODE_OUTPUT_FORMATS: { id: GcodeOutputFormat; label: string }[] = [
  { id: 'fluidnc', label: 'FluidNC' },
];

export interface GcodeTemplates {
  startGcode: string;
  endGcode: string;
  toolChangeGcode: string;
}

export const DEFAULT_GCODE_TEMPLATES: GcodeTemplates = {
  startGcode: `; Start gcode
G90 ; Absolute positioning mode
G21 ; Set units to millimeters
G10 L20 P1 X0 Y0 Z0 ; Work Zero (G54)
;M3 S10000 ; Turn on spindle/router
;G4 P2 ; Pause 2 seconds for spindle spin-up
`,
  endGcode: `; End G-code
M5 ; spindle off
G90 ; ensure absolute
G0 Z0 ; retract to safe height
G0 X0 Y0; back to start
M2 ; end of program
`,
  toolChangeGcode: `; Tool Change gcode
M6; make sure M6 macro is setup in your machine
`,
};

export interface FeedsCalculatorInputs {
  materialId: MaterialId;
  toolDiameterMm: number;
  fluteCount: number;
  rpm: number;
  chipLoadMm: number;
  stepoverPct: number;
}

function defaultFeedsCalculatorInputs(): FeedsCalculatorInputs {
  const materialId: MaterialId = 'hardwood';
  const defaults = getMaterialDefaults(materialId);
  return {
    materialId,
    toolDiameterMm: 6,
    fluteCount: 2,
    rpm: 10000,
    chipLoadMm: defaults.chipLoad,
    stepoverPct: defaults.stepoverPercentage,
  };
}

const MATERIAL_IDS: MaterialId[] = [
  'mild-steel',
  'solid-aluminium',
  'aluminium-composite',
  'hardwood',
  'softwood-plywood',
  'plastics-acrylic',
];

function normalizeFeedsCalculatorInputs(
  value: Partial<FeedsCalculatorInputs> | undefined
): FeedsCalculatorInputs {
  const defaults = defaultFeedsCalculatorInputs();
  if (!value) return defaults;
  const materialId = MATERIAL_IDS.includes(value.materialId as MaterialId)
    ? (value.materialId as MaterialId)
    : defaults.materialId;
  return {
    materialId,
    toolDiameterMm:
      Number.isFinite(value.toolDiameterMm) && (value.toolDiameterMm ?? 0) > 0
        ? (value.toolDiameterMm as number)
        : defaults.toolDiameterMm,
    fluteCount:
      Number.isFinite(value.fluteCount) && (value.fluteCount ?? 0) >= 1
        ? Math.min(8, Math.max(1, Math.round(value.fluteCount as number)))
        : defaults.fluteCount,
    rpm:
      Number.isFinite(value.rpm) && (value.rpm ?? 0) >= 0
        ? Math.max(0, value.rpm as number)
        : defaults.rpm,
    chipLoadMm:
      Number.isFinite(value.chipLoadMm) && (value.chipLoadMm ?? 0) > 0
        ? (value.chipLoadMm as number)
        : defaults.chipLoadMm,
    stepoverPct:
      Number.isFinite(value.stepoverPct) && (value.stepoverPct ?? 0) > 0
        ? Math.min(100, Math.max(1, value.stepoverPct as number))
        : defaults.stepoverPct,
  };
}

interface SettingsState {
  gcodeTemplates: GcodeTemplates;
  gcodeOutputFormat: GcodeOutputFormat;
  toolOrigin: ToolOrigin;
  safeHeight: number;
  toolpathResolution: number;
  travelFeedRate: number;
  isometricProjection: boolean;
  uiTheme: UiTheme;
  feedsCalculator: FeedsCalculatorInputs;
  setGcodeTemplate: (key: keyof GcodeTemplates, value: string) => void;
  setGcodeOutputFormat: (format: GcodeOutputFormat) => void;
  resetGcodeTemplates: () => void;
  setToolOrigin: (origin: Partial<ToolOrigin>) => void;
  setSafeHeight: (mm: number) => void;
  setToolpathResolution: (factor: number) => void;
  setTravelFeedRate: (mmPerMin: number) => void;
  setIsometricProjection: (enabled: boolean) => void;
  setUiTheme: (theme: UiTheme) => void;
  setFeedsCalculatorMaterial: (materialId: MaterialId) => void;
  updateFeedsCalculator: (patch: Partial<FeedsCalculatorInputs>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gcodeTemplates: DEFAULT_GCODE_TEMPLATES,
      gcodeOutputFormat: 'fluidnc',
      toolOrigin: { x: 0, y: 0, z: DEFAULT_WCS_Z_ABOVE_STOCK },
      safeHeight: DEFAULT_SAFE_HEIGHT,
      toolpathResolution: DEFAULT_TOOLPATH_RESOLUTION,
      travelFeedRate: DEFAULT_TRAVEL_FEED_RATE,
      isometricProjection: false,
      uiTheme: 'dark',
      feedsCalculator: defaultFeedsCalculatorInputs(),
      setGcodeTemplate: (key, value) =>
        set((state) => ({
          gcodeTemplates: { ...state.gcodeTemplates, [key]: value },
        })),
      setGcodeOutputFormat: (format) => set({ gcodeOutputFormat: format }),
      resetGcodeTemplates: () =>
        set({ gcodeTemplates: { ...DEFAULT_GCODE_TEMPLATES } }),
      setToolOrigin: (origin) =>
        set((state) => ({
          toolOrigin: { ...state.toolOrigin, ...origin },
        })),
      setSafeHeight: (mm) =>
        set({ safeHeight: Math.max(0, Number.isFinite(mm) ? mm : DEFAULT_SAFE_HEIGHT) }),
      setToolpathResolution: (factor) =>
        set({
          toolpathResolution: Math.min(
            8,
            Math.max(0.5, Number.isFinite(factor) ? factor : DEFAULT_TOOLPATH_RESOLUTION)
          ),
        }),
      setTravelFeedRate: (mmPerMin) =>
        set({
          travelFeedRate: Math.min(
            10000,
            Math.max(1, Number.isFinite(mmPerMin) ? mmPerMin : DEFAULT_TRAVEL_FEED_RATE)
          ),
        }),
      setIsometricProjection: (enabled) => set({ isometricProjection: !!enabled }),
      setUiTheme: (theme) => set({ uiTheme: theme === 'light' ? 'light' : 'dark' }),
      setFeedsCalculatorMaterial: (materialId) =>
        set((state) => {
          const defaults = getMaterialDefaults(materialId);
          return {
            feedsCalculator: {
              ...state.feedsCalculator,
              materialId,
              chipLoadMm: defaults.chipLoad,
              stepoverPct: defaults.stepoverPercentage,
            },
          };
        }),
      updateFeedsCalculator: (patch) =>
        set((state) => ({
          feedsCalculator: normalizeFeedsCalculatorInputs({
            ...state.feedsCalculator,
            ...patch,
          }),
        })),
    }),
    {
      name: 'easy-cam-gcode-settings',
      version: 3,
      migrate: (persisted, version) => {
      const state = persisted as Record<string, unknown>;
      if (state.gcodeOutputFormat === 'marlin') {
        state.gcodeOutputFormat = 'fluidnc';
      }
      if (version < 2 && state.uiTheme !== 'light' && state.uiTheme !== 'dark') {
        state.uiTheme = 'dark';
      }
      if (version < 3) {
        state.feedsCalculator = normalizeFeedsCalculatorInputs(
          state.feedsCalculator as Partial<FeedsCalculatorInputs> | undefined
        );
      }
      return state;
    },
    }
  )
);
