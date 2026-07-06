import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ToolOrigin } from '../lib/geometryProcessing';
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

interface SettingsState {
  gcodeTemplates: GcodeTemplates;
  gcodeOutputFormat: GcodeOutputFormat;
  toolOrigin: ToolOrigin;
  safeHeight: number;
  toolpathResolution: number;
  travelFeedRate: number;
  isometricProjection: boolean;
  setGcodeTemplate: (key: keyof GcodeTemplates, value: string) => void;
  setGcodeOutputFormat: (format: GcodeOutputFormat) => void;
  resetGcodeTemplates: () => void;
  setToolOrigin: (origin: Partial<ToolOrigin>) => void;
  setSafeHeight: (mm: number) => void;
  setToolpathResolution: (factor: number) => void;
  setTravelFeedRate: (mmPerMin: number) => void;
  setIsometricProjection: (enabled: boolean) => void;
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
    }),
    { name: 'easy-cam-gcode-settings', version: 1, migrate: (persisted) => {
      const state = persisted as Record<string, unknown>;
      if (state.gcodeOutputFormat === 'marlin') {
        state.gcodeOutputFormat = 'fluidnc';
      }
      return state;
    } }
  )
);
