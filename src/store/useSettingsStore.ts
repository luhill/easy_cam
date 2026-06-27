import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  setGcodeTemplate: (key: keyof GcodeTemplates, value: string) => void;
  resetGcodeTemplates: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      gcodeTemplates: DEFAULT_GCODE_TEMPLATES,
      setGcodeTemplate: (key, value) =>
        set((state) => ({
          gcodeTemplates: { ...state.gcodeTemplates, [key]: value },
        })),
      resetGcodeTemplates: () =>
        set({ gcodeTemplates: { ...DEFAULT_GCODE_TEMPLATES } }),
    }),
    { name: 'easy-cam-gcode-settings' }
  )
);
