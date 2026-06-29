import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PartBounds, ToolOrigin } from '../lib/geometryProcessing';
import { DEFAULT_WCS_Z_ABOVE_STOCK } from '../lib/cutDepth';

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
  toolOrigin: ToolOrigin;
  toolOriginAuto: boolean;
  setGcodeTemplate: (key: keyof GcodeTemplates, value: string) => void;
  resetGcodeTemplates: () => void;
  setToolOrigin: (origin: Partial<ToolOrigin>) => void;
  setToolOriginFromBounds: (bounds: PartBounds) => void;
  setToolOriginAuto: (auto: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gcodeTemplates: DEFAULT_GCODE_TEMPLATES,
      toolOrigin: { x: 0, y: 0, z: DEFAULT_WCS_Z_ABOVE_STOCK },
      toolOriginAuto: true,
      setGcodeTemplate: (key, value) =>
        set((state) => ({
          gcodeTemplates: { ...state.gcodeTemplates, [key]: value },
        })),
      resetGcodeTemplates: () =>
        set({ gcodeTemplates: { ...DEFAULT_GCODE_TEMPLATES } }),
      setToolOrigin: (origin) =>
        set((state) => ({
          toolOrigin: { ...state.toolOrigin, ...origin },
          toolOriginAuto: false,
        })),
      setToolOriginFromBounds: (bounds) =>
        set((state) => {
          if (!state.toolOriginAuto) return state;
          const next = {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
            z: DEFAULT_WCS_Z_ABOVE_STOCK,
          };
          const cur = state.toolOrigin;
          if (cur.x === next.x && cur.y === next.y && cur.z === next.z) return state;
          return { toolOrigin: next };
        }),
      setToolOriginAuto: (auto) => set({ toolOriginAuto: auto }),
    }),
    { name: 'easy-cam-gcode-settings' }
  )
);
