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
import {
  DEFAULT_SETTINGS,
  getOperationLabel,
} from '../types/operations';
import { clampOperationSettings } from '../lib/settingLimits';
import { generateToolpaths } from '../lib/toolpaths';
import { DEFAULT_DEV_STL_NAME, DEFAULT_DEV_STL_URL } from '../lib/defaultStl';

function revokeStlUrl(url: string | null): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

interface AppState {
  stlFile: File | null;
  stlUrl: string | null;
  stlFileName: string | null;
  operations: Operation[];
  activeOperationId: string | null;
  selectionMode: boolean;
  selectionSubMode: SelectionSubMode;
  partBounds: PartBounds | null;
  toolpaths: ToolpathSegment[];
  simulationDistance: number;
  simulationPlaying: boolean;
  simulationSpeed: number;

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
  regenerateToolpaths: () => void;
  setSimulationDistance: (distance: number) => void;
  setSimulationPlaying: (playing: boolean) => void;
  setSimulationSpeed: (speed: number) => void;
  resetSimulation: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  stlFile: null,
  stlUrl: null,
  stlFileName: null,
  operations: [],
  activeOperationId: null,
  selectionMode: false,
  selectionSubMode: 'geometry',
  partBounds: null,
  toolpaths: [],
  simulationDistance: 0,
  simulationPlaying: false,
  simulationSpeed: 1,

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
      partBounds: null,
      simulationDistance: 0,
      simulationPlaying: false,
    });
  },

  loadDefaultStl: () => {
    const prev = get().stlUrl;
    revokeStlUrl(prev);
    set({
      stlFile: null,
      stlUrl: DEFAULT_DEV_STL_URL,
      stlFileName: DEFAULT_DEV_STL_NAME,
      operations: [],
      toolpaths: [],
      partBounds: null,
      simulationDistance: 0,
      simulationPlaying: false,
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
      partBounds: null,
      activeOperationId: null,
      simulationDistance: 0,
      simulationPlaying: false,
    });
  },

  addOperation: (type) => {
    const op: Operation = {
      id: uuidv4(),
      type,
      name: getOperationLabel(type),
      enabled: true,
      visible: true,
      collapsed: false,
      settings: clampOperationSettings({ ...DEFAULT_SETTINGS }),
      geometry: null,
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
              settings: clampOperationSettings({ ...DEFAULT_SETTINGS, ...o.settings, ...settings }),
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
    set({ partBounds: bounds });
    get().regenerateToolpaths();
  },

  regenerateToolpaths: () => {
    const { operations, partBounds } = get();
    const toolpaths = generateToolpaths(operations, partBounds);
    set({ toolpaths, simulationDistance: 0, simulationPlaying: false });
  },

  setSimulationDistance: (distance) =>
    set({ simulationDistance: Math.max(0, distance) }),

  setSimulationPlaying: (playing) => set({ simulationPlaying: playing }),

  setSimulationSpeed: (speed) => set({ simulationSpeed: speed }),

  resetSimulation: () => set({ simulationDistance: 0, simulationPlaying: false }),
}));
