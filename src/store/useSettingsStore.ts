import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ToolOrigin } from '../lib/geometryProcessing';
import { DEFAULT_WCS_Z_ABOVE_STOCK } from '../lib/cutDepth';
import {
  DEFAULT_SAFE_HEIGHT,
  DEFAULT_TOOLPATH_RESOLUTION,
  DEFAULT_TRAVEL_FEED_RATE,
} from '../lib/toolpathConfig';

export type GcodeOutputFormat = 'marlin';

export const GCODE_OUTPUT_FORMATS: { id: GcodeOutputFormat; label: string }[] = [
  { id: 'marlin', label: 'Marlin' },
];

export interface GcodeTemplates {
  startGcode: string;
  endGcode: string;
  toolChangeGcode: string;
}

export const DEFAULT_GCODE_TEMPLATES: GcodeTemplates = {
  startGcode: `; Start G-code
G21 ; millimeters
G90 ; absolute positioning
G17 ; XY plane
G0 Z10 ; safe height
`,
  endGcode: `; End G-code
G0 Z10 ; retract to safe height
M5 ; spindle off
M30 ; program end
`,
  toolChangeGcode: `; Tool change
M5 ; spindle off
G0 Z10 ; safe height
; Insert manual tool change here
; T{toolNumber} M6
; G43 H{toolNumber}
M3 S{spindleSpeed} ; spindle on
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
      gcodeOutputFormat: 'marlin',
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
    { name: 'easy-cam-gcode-settings' }
  )
);
