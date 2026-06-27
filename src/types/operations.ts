export type OperationType =
  | 'outline'
  | 'adaptive-outline'
  | 'drill'
  | 'helix'
  | 'pocket'
  | 'contour';

export interface OperationDefaults {
  toolDiameter: number;
  feedRate: number;
  plungeRate: number;
  stepDown: number;
  stepover: number;
  spindleSpeed: number;
  clearance: number;
  depth: number;
  /** Adaptive outline: clearance from part to channel wall (mm) */
  channelClearance: number;
  /** Adaptive outline: trochoidal arc radius (mm), 0 = auto */
  trochoidRadius: number;
  /** Adaptive outline: helix bore radius (mm), 0 = tool radius */
  helixRadius: number;
  /** Adaptive outline: helix pitch per revolution (mm) */
  helixPitch: number;
}

export interface LoopPoint {
  x: number;
  y: number;
  z: number;
}

export interface SelectedGeometry {
  faceIndices: number[];
  vertexIndices: number[];
  /** Closed boundary loops for outline-type selections */
  loops?: LoopPoint[][];
  /** Drill/helix hole center */
  holeCenter?: LoopPoint;
  holeRadius?: number;
  holeId?: number;
  /** Adaptive outline helix entry in stock (XY at top of part, Z=0) */
  entryPoint?: { x: number; y: number };
}

export interface Operation {
  id: string;
  type: OperationType;
  name: string;
  enabled: boolean;
  visible: boolean;
  collapsed: boolean;
  settings: OperationDefaults;
  geometry: SelectedGeometry | null;
}

export interface OperationTemplate {
  type: OperationType;
  label: string;
  description: string;
  icon: string;
}

export interface ToolpathPoint {
  x: number;
  y: number;
  z: number;
  rapid?: boolean;
}

export interface ToolpathSegment {
  operationId: string;
  points: ToolpathPoint[];
  color: string;
}

export const OPERATION_TEMPLATES: OperationTemplate[] = [
  {
    type: 'outline',
    label: 'Outline',
    description: '2D contour around selected geometry',
    icon: '◻',
  },
  {
    type: 'adaptive-outline',
    label: 'Adaptive Outline',
    description: 'Helix bore entry then trochoidal channel around outline',
    icon: '◎',
  },
  {
    type: 'drill',
    label: 'Drill',
    description: 'Peck drilling at selected points',
    icon: '⊕',
  },
  {
    type: 'helix',
    label: 'Helix',
    description: 'Helical ramping entry',
    icon: '↻',
  },
  {
    type: 'pocket',
    label: 'Pocket',
    description: '2D pocket clearing',
    icon: '▣',
  },
  {
    type: 'contour',
    label: 'Contour',
    description: '3D contour following surface',
    icon: '〜',
  },
];

export const DEFAULT_SETTINGS: OperationDefaults = {
  toolDiameter: 6.35,
  feedRate: 1200,
  plungeRate: 300,
  stepDown: 2,
  stepover: 40,
  spindleSpeed: 12000,
  clearance: 5,
  depth: 10,
  channelClearance: 3,
  trochoidRadius: 0,
  helixRadius: 0,
  helixPitch: 2,
};

export type SelectionSubMode = 'geometry' | 'entry-point';

export const OPERATION_COLORS: Record<OperationType, string> = {
  outline: '#3b82f6',
  'adaptive-outline': '#8b5cf6',
  drill: '#ef4444',
  helix: '#f59e0b',
  pocket: '#10b981',
  contour: '#06b6d4',
};

export function getSelectionStrategy(type: OperationType): SelectionStrategy {
  switch (type) {
    case 'outline':
    case 'adaptive-outline':
      return 'outline-loop';
    case 'drill':
    case 'helix':
      return 'point';
    default:
      return 'region';
  }
}

export type SelectionStrategy = 'region' | 'outline-loop' | 'point';

export function getOperationLabel(type: OperationType): string {
  return OPERATION_TEMPLATES.find((t) => t.type === type)?.label ?? type;
}
