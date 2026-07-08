import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  Operation,
  OperationType,
  SelectedGeometry,
  SelectionSubMode,
  ToolpathSegment,
} from '../types/operations';
import type { PartBounds } from '../lib/geometryProcessing';
import { partBoundsEqual, normalizeRotationDegrees, rotateSelectedGeometry } from '../lib/geometryProcessing';
import { getPartTransformBridge } from '../lib/partTransformBridge';
import {
  defaultSettingsForOperation,
  getOperationLabel,
} from '../types/operations';
import { operationSettingsFromFeedsCalculator } from '../lib/feedsSpeedsCalculator';
import { clampOperationSettings } from '../lib/settingLimits';
import { generateToolpaths } from '../lib/toolpaths';
import type { ToolpathColorMode, ToolpathTypeVisibility } from '../lib/toolpathColors';
import { DEFAULT_TOOLPATH_TYPE_VISIBILITY } from '../lib/toolpathColors';
import { DEFAULT_DEV_STL_NAME, getDefaultDevStlUrl } from '../lib/defaultStl';
import { clearStlGeometryCache } from '../lib/stlLoader';
import { useSettingsStore } from './useSettingsStore';

function revokeStlUrl(url: string | null): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

const devDefaultStl = import.meta.env.DEV
  ? { stlUrl: getDefaultDevStlUrl('dev'), stlFileName: DEFAULT_DEV_STL_NAME }
  : { stlUrl: null as string | null, stlFileName: null as string | null };

interface AppState {
  stlFile: File | null;
  stlUrl: string | null;
  stlFileName: string | null;
  operations: Operation[];
  activeOperationId: string | null;
  selectionMode: boolean;
  selectionSubMode: SelectionSubMode;
  partBounds: PartBounds | null;
  /** Part rotation around Z (degrees). */
  partRotationZ: number;
  toolpaths: ToolpathSegment[];
  toolpathWarnings: string[];
  simulationDistance: number;
  simulationPlaying: boolean;
  simulationSpeed: number;
  /** Preview window as fraction of total path length [0, 1]. */
  simulationWindowStart: number;
  simulationWindowEnd: number;
  simulationShowTool: boolean;
  toolpathColorMode: ToolpathColorMode;
  toolpathTypeVisibility: ToolpathTypeVisibility;

  setStlFile: (file: File) => void;
  loadDefaultStl: () => void;
  clearStl: () => void;
  addOperation: (type: OperationType) => void;
  removeOperation: (id: string) => void;
  updateOperation: (id: string, updates: Partial<Operation>) => void;
  updateOperationSettings: (
    id: string,
    settings: Partial<Operation['settings']>
  ) => void;
  reorderOperations: (fromIndex: number, toIndex: number) => void;
  setActiveOperation: (id: string | null) => void;
  setSelectionMode: (enabled: boolean, subMode?: SelectionSubMode) => void;
  setSelectionSubMode: (mode: SelectionSubMode) => void;
  setOperationGeometry: (id: string, geometry: SelectedGeometry | null) => void;
  toggleOperationEnabled: (id: string) => void;
  toggleOperationVisible: (id: string) => void;
  toggleOperationCollapsed: (id: string) => void;
  setPartBounds: (bounds: PartBounds | null) => void;
  setPartRotationZ: (degrees: number) => void;
  regenerateToolpaths: () => void;
  setSimulationDistance: (distance: number) => void;
  setSimulationPlaying: (playing: boolean) => void;
  setSimulationSpeed: (speed: number) => void;
  setSimulationWindow: (start: number, end: number) => void;
  setSimulationShowTool: (show: boolean) => void;
  setToolpathColorMode: (mode: ToolpathColorMode) => void;
  setToolpathTypeVisible: (kind: keyof ToolpathTypeVisibility, visible: boolean) => void;
  toggleToolpathTypeVisible: (kind: keyof ToolpathTypeVisibility) => void;
  resetSimulation: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  stlFile: null,
  stlUrl: devDefaultStl.stlUrl,
  stlFileName: devDefaultStl.stlFileName,
  operations: [],
  activeOperationId: null,
  selectionMode: false,
  selectionSubMode: 'geometry',
  partBounds: null,
  partRotationZ: 0,
  toolpaths: [],
  toolpathWarnings: [],
  simulationDistance: 0,
  simulationPlaying: false,
  simulationSpeed: 1,
  simulationWindowStart: 0,
  simulationWindowEnd: 1,
  simulationShowTool: true,
  toolpathColorMode: 'type',
  toolpathTypeVisibility: { ...DEFAULT_TOOLPATH_TYPE_VISIBILITY },

  setStlFile: (file) => {
    const prev = get().stlUrl;
    revokeStlUrl(prev);
    const url = URL.createObjectURL(file);
    set({
      stlFile: file,
      stlUrl: url,
      stlFileName: file.name,
      operations: [],
      toolpaths: [],
      toolpathWarnings: [],
      partBounds: null,
      partRotationZ: 0,
      simulationDistance: 0,
      simulationPlaying: false,
      simulationWindowStart: 0,
      simulationWindowEnd: 1,
    });
  },

  loadDefaultStl: () => {
    const prev = get().stlUrl;
    revokeStlUrl(prev);
    clearStlGeometryCache();
    const nextUrl = getDefaultDevStlUrl(Date.now());
    set({
      stlFile: null,
      stlUrl: nextUrl,
      stlFileName: DEFAULT_DEV_STL_NAME,
      operations: [],
      toolpaths: [],
      toolpathWarnings: [],
      partBounds: null,
      partRotationZ: 0,
      simulationDistance: 0,
      simulationPlaying: false,
      simulationWindowStart: 0,
      simulationWindowEnd: 1,
    });
  },

  clearStl: () => {
    const prev = get().stlUrl;
    revokeStlUrl(prev);
    set({
      stlFile: null,
      stlUrl: null,
      stlFileName: null,
      operations: [],
      toolpaths: [],
      toolpathWarnings: [],
      partBounds: null,
      partRotationZ: 0,
      activeOperationId: null,
      simulationDistance: 0,
      simulationPlaying: false,
      simulationWindowStart: 0,
      simulationWindowEnd: 1,
    });
  },

  addOperation: (type) => {
    const feedsCalculator = useSettingsStore.getState().feedsCalculator;
    const feedsMaterialRows = useSettingsStore.getState().feedsMaterialRows;
    const op: Operation = {
      id: uuidv4(),
      type,
      name: getOperationLabel(type),
      enabled: true,
      visible: true,
      collapsed: false,
      settings: clampOperationSettings({
        ...defaultSettingsForOperation(type),
        ...operationSettingsFromFeedsCalculator(type, feedsCalculator, feedsMaterialRows),
      }),
      geometry: null,
      ...(type === 'custom-gcode'
        ? { customGcode: '; Custom G-code\n; Insert Marlin commands below\n' }
        : {}),
    };
    set((state) => ({
      operations: [
        ...state.operations.map((o) => ({ ...o, collapsed: true })),
        op,
      ],
      activeOperationId: op.id,
    }));
    get().regenerateToolpaths();
  },

  removeOperation: (id) => {
    set((state) => ({
      operations: state.operations.filter((o) => o.id !== id),
      activeOperationId:
        state.activeOperationId === id ? null : state.activeOperationId,
    }));
    get().regenerateToolpaths();
  },

  updateOperation: (id, updates) => {
    set((state) => ({
      operations: state.operations.map((o) =>
        o.id === id ? { ...o, ...updates } : o
      ),
    }));
    get().regenerateToolpaths();
  },

  updateOperationSettings: (id, settings) => {
    set((state) => ({
      operations: state.operations.map((o) =>
        o.id === id
          ? {
              ...o,
              settings: clampOperationSettings({
                ...defaultSettingsForOperation(o.type),
                ...o.settings,
                ...settings,
              }),
            }
          : o
      ),
    }));
    get().regenerateToolpaths();
  },

  reorderOperations: (fromIndex, toIndex) => {
    set((state) => {
      const ops = [...state.operations];
      const [moved] = ops.splice(fromIndex, 1);
      ops.splice(toIndex, 0, moved);
      return { operations: ops };
    });
    get().regenerateToolpaths();
  },

  setActiveOperation: (id) => set({ activeOperationId: id }),

  setSelectionMode: (enabled, subMode) =>
    set((state) => ({
      selectionMode: enabled,
      selectionSubMode: enabled
        ? (subMode ?? state.selectionSubMode)
        : 'geometry',
    })),

  setSelectionSubMode: (mode) => set({ selectionSubMode: mode }),

  setOperationGeometry: (id, geometry) => {
    set((state) => ({
      operations: state.operations.map((o) =>
        o.id === id ? { ...o, geometry } : o
      ),
    }));
    get().regenerateToolpaths();
  },

  toggleOperationEnabled: (id) => {
    set((state) => ({
      operations: state.operations.map((o) =>
        o.id === id ? { ...o, enabled: !o.enabled } : o
      ),
    }));
    get().regenerateToolpaths();
  },

  toggleOperationVisible: (id) => {
    set((state) => ({
      operations: state.operations.map((o) =>
        o.id === id ? { ...o, visible: !o.visible } : o
      ),
    }));
  },

  toggleOperationCollapsed: (id) => {
    set((state) => {
      const target = state.operations.find((o) => o.id === id);
      if (!target) return state;
      const willExpand = target.collapsed;
      return {
        operations: state.operations.map((o) => {
          if (o.id === id) return { ...o, collapsed: !o.collapsed };
          if (willExpand) return { ...o, collapsed: true };
          return o;
        }),
      };
    });
  },

  setPartBounds: (bounds) => {
    if (partBoundsEqual(get().partBounds, bounds)) return;
    set({ partBounds: bounds });
    get().regenerateToolpaths();
  },

  setPartRotationZ: (degrees) => {
    const next = normalizeRotationDegrees(degrees);
    const prev = get().partRotationZ;
    let delta = next - prev;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    if (Math.abs(delta) < 1e-6 && next === prev) return;

    const bridge = getPartTransformBridge();
    if (!bridge) return;

    set((state) => ({
      partRotationZ: next,
      operations: state.operations.map((op) =>
        op.geometry ? { ...op, geometry: rotateSelectedGeometry(op.geometry, delta) } : op
      ),
    }));

    bridge.applyRotationZ(next);
    get().regenerateToolpaths();
  },

  regenerateToolpaths: () => {
    const { operations, partBounds } = get();
    const { safeHeight, toolpathResolution, travelFeedRate, toolOrigin } = useSettingsStore.getState();
    const { segments, warnings } = generateToolpaths(operations, partBounds, {
      safeHeight,
      resolution: toolpathResolution,
      travelFeedRate,
      toolOrigin,
    });
    set({ toolpaths: segments, toolpathWarnings: warnings, simulationDistance: 0, simulationPlaying: false, simulationWindowStart: 0, simulationWindowEnd: 1 });
  },

  setSimulationDistance: (distance) =>
    set({ simulationDistance: Math.max(0, distance) }),

  setSimulationPlaying: (playing) => set({ simulationPlaying: playing }),

  setSimulationSpeed: (speed) => set({ simulationSpeed: speed }),

  setSimulationWindow: (start, end) => {
    const s = Math.max(0, Math.min(1, start));
    const e = Math.max(0, Math.min(1, end));
    if (e - s < 0.02) return;
    set({ simulationWindowStart: s, simulationWindowEnd: e });
  },

  setSimulationShowTool: (show) => set({ simulationShowTool: show }),

  setToolpathColorMode: (mode) => set({ toolpathColorMode: mode }),

  setToolpathTypeVisible: (kind, visible) =>
    set((state) => ({
      toolpathTypeVisibility: { ...state.toolpathTypeVisibility, [kind]: visible },
    })),

  toggleToolpathTypeVisible: (kind) =>
    set((state) => ({
      toolpathTypeVisibility: {
        ...state.toolpathTypeVisibility,
        [kind]: !state.toolpathTypeVisibility[kind],
      },
    })),

  resetSimulation: () =>
    set({
      simulationDistance: 0,
      simulationPlaying: false,
      simulationWindowStart: 0,
      simulationWindowEnd: 1,
    }),
}));
