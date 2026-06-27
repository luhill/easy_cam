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
import { generateToolpaths } from '../lib/toolpaths';

interface AppState {
  stlFile: File | null;
  stlUrl: string | null;
  operations: Operation[];
  activeOperationId: string | null;
  selectionMode: boolean;
  selectionSubMode: SelectionSubMode;
  partBounds: PartBounds | null;
  toolpaths: ToolpathSegment[];

  setStlFile: (file: File) => void;
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
  setSelectionMode: (enabled: boolean) => void;
  setSelectionSubMode: (mode: SelectionSubMode) => void;
  setOperationGeometry: (id: string, geometry: SelectedGeometry | null) => void;
  toggleOperationEnabled: (id: string) => void;
  toggleOperationVisible: (id: string) => void;
  toggleOperationCollapsed: (id: string) => void;
  setPartBounds: (bounds: PartBounds | null) => void;
  regenerateToolpaths: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  stlFile: null,
  stlUrl: null,
  operations: [],
  activeOperationId: null,
  selectionMode: false,
  selectionSubMode: 'geometry',
  partBounds: null,
  toolpaths: [],

  setStlFile: (file) => {
    const prev = get().stlUrl;
    if (prev) URL.revokeObjectURL(prev);
    const url = URL.createObjectURL(file);
    set({ stlFile: file, stlUrl: url, operations: [], toolpaths: [], partBounds: null });
  },

  clearStl: () => {
    const prev = get().stlUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      stlFile: null,
      stlUrl: null,
      operations: [],
      toolpaths: [],
      partBounds: null,
      activeOperationId: null,
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
      settings: { ...DEFAULT_SETTINGS },
      geometry: null,
    };
    set((state) => ({
      operations: [...state.operations, op],
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
        o.id === id ? { ...o, settings: { ...o.settings, ...settings } } : o
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

  setSelectionMode: (enabled) =>
    set({ selectionMode: enabled, selectionSubMode: 'geometry' }),

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
    set((state) => ({
      operations: state.operations.map((o) =>
        o.id === id ? { ...o, collapsed: !o.collapsed } : o
      ),
    }));
  },

  setPartBounds: (bounds) => set({ partBounds: bounds }),

  regenerateToolpaths: () => {
    const { operations, partBounds } = get();
    const toolpaths = generateToolpaths(operations, partBounds);
    set({ toolpaths });
  },
}));
