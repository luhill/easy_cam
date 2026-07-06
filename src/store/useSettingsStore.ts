import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ToolOrigin } from '../lib/geometryProcessing';
import type { UiTheme } from '../lib/uiTheme';
import { getMaterialProfile, MATERIAL_PROFILES } from '../lib/feedsSpeedsCalculator';
import {
  defaultFeedsMaterialRows,
  normalizeFeedsMaterialRows,
  type FeedsMaterialLibrary,
} from '../lib/feedsMaterialProfiles';
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
  materialId: string;
  toolDiameterMm: number;
  fluteCount: number;
  rpm: number;
  chipLoadMm: number;
  stepoverPct: number;
}

function defaultFeedsCalculatorInputs(rows: FeedsMaterialLibrary): FeedsCalculatorInputs {
  const materialId = rows.find((row) => row.id === 'hardwood')?.id ?? rows[0]?.id ?? 'hardwood';
  const profile = getMaterialProfile(materialId, rows);
  return {
    materialId,
    toolDiameterMm: 6,
    fluteCount: 2,
    rpm: 10000,
    chipLoadMm: profile.chipLoad,
    stepoverPct: profile.stepoverPercentage,
  };
}

function normalizeFeedsCalculatorInputs(
  value: Partial<FeedsCalculatorInputs> | undefined,
  rows: FeedsMaterialLibrary
): FeedsCalculatorInputs {
  const defaults = defaultFeedsCalculatorInputs(rows);
  if (!value) return defaults;
  const materialId = rows.some((row) => row.id === value.materialId)
    ? (value.materialId as string)
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
  feedsMaterialRows: FeedsMaterialLibrary;
  setGcodeTemplate: (key: keyof GcodeTemplates, value: string) => void;
  setGcodeOutputFormat: (format: GcodeOutputFormat) => void;
  resetGcodeTemplates: () => void;
  setToolOrigin: (origin: Partial<ToolOrigin>) => void;
  setSafeHeight: (mm: number) => void;
  setToolpathResolution: (factor: number) => void;
  setTravelFeedRate: (mmPerMin: number) => void;
  setIsometricProjection: (enabled: boolean) => void;
  setUiTheme: (theme: UiTheme) => void;
  setFeedsCalculatorMaterial: (materialId: string) => void;
  updateFeedsCalculator: (patch: Partial<FeedsCalculatorInputs>) => void;
  setFeedsMaterialRows: (rows: FeedsMaterialLibrary) => void;
}

const defaultRows = defaultFeedsMaterialRows(MATERIAL_PROFILES);

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
      feedsCalculator: defaultFeedsCalculatorInputs(defaultRows),
      feedsMaterialRows: defaultRows,
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
          const profile = getMaterialProfile(materialId, state.feedsMaterialRows);
          return {
            feedsCalculator: {
              ...state.feedsCalculator,
              materialId,
              chipLoadMm: profile.chipLoad,
              stepoverPct: profile.stepoverPercentage,
            },
          };
        }),
      updateFeedsCalculator: (patch) =>
        set((state) => ({
          feedsCalculator: normalizeFeedsCalculatorInputs(
            {
              ...state.feedsCalculator,
              ...patch,
            },
            state.feedsMaterialRows
          ),
        })),
      setFeedsMaterialRows: (rows) =>
        set((state) => {
          const feedsMaterialRows = normalizeFeedsMaterialRows(rows, MATERIAL_PROFILES);
          const materialStillExists = feedsMaterialRows.some(
            (row) => row.id === state.feedsCalculator.materialId
          );
          const nextMaterialId = materialStillExists
            ? state.feedsCalculator.materialId
            : (feedsMaterialRows[0]?.id ?? state.feedsCalculator.materialId);
          const profile = getMaterialProfile(nextMaterialId, feedsMaterialRows);
          return {
            feedsMaterialRows,
            feedsCalculator: materialStillExists
              ? state.feedsCalculator
              : {
                  ...state.feedsCalculator,
                  materialId: nextMaterialId,
                  chipLoadMm: profile.chipLoad,
                  stepoverPct: profile.stepoverPercentage,
                },
          };
        }),
    }),
    {
      name: 'easy-cam-gcode-settings',
      version: 5,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (state.gcodeOutputFormat === 'marlin') {
          state.gcodeOutputFormat = 'fluidnc';
        }
        if (version < 2 && state.uiTheme !== 'light' && state.uiTheme !== 'dark') {
          state.uiTheme = 'dark';
        }

        let rows = defaultFeedsMaterialRows(MATERIAL_PROFILES);
        if (version >= 4 && state.feedsMaterialRows) {
          rows = normalizeFeedsMaterialRows(
            state.feedsMaterialRows as FeedsMaterialLibrary,
            MATERIAL_PROFILES
          );
        } else if (version >= 4 && state.feedsMaterialProfiles) {
          rows = normalizeFeedsMaterialRows(
            state.feedsMaterialProfiles as FeedsMaterialLibrary,
            MATERIAL_PROFILES
          );
        } else if (state.feedsMaterialProfiles) {
          rows = normalizeFeedsMaterialRows(
            state.feedsMaterialProfiles as FeedsMaterialLibrary,
            MATERIAL_PROFILES
          );
        }
        state.feedsMaterialRows = rows;
        delete state.feedsMaterialProfiles;

        if (version < 3) {
          state.feedsCalculator = normalizeFeedsCalculatorInputs(
            state.feedsCalculator as Partial<FeedsCalculatorInputs> | undefined,
            rows
          );
        } else {
          state.feedsCalculator = normalizeFeedsCalculatorInputs(
            state.feedsCalculator as Partial<FeedsCalculatorInputs> | undefined,
            rows
          );
        }
        return state;
      },
    }
  )
);
