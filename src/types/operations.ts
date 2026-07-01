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
  /** Offset from part bottom for final cut (mm). + = above bottom, − = below. */
  depthOffset: number;
  /** Helix: start helix ramp this far above stock top (mm); clamped to global safe height. */
  zStartOffset: number;
  /** Additional radial stock offset beyond tool radius (mm); negative allows finishing inside the line */
  radialOffset: number;
  /** Adaptive outline: slot width as % of tool diameter (125–200%) */
  slotWidthPercent: number;
  /** Adaptive outline: micro-retract / Z lift between trochoid passes (mm); 0 = no lift */
  liftAmount: number;
  /** Adaptive outline: outside bore diameter as % of tool diameter (150% ≈ former 50% helix ⌀) */
  boreDiameterPercent: number;
  /** Adaptive outline: helix ramp pitch angle (degrees) */
  helixAngleDeg: number;
  /** Adaptive outline: bore wall taper below stock top (degrees); widens toward Z=0 */
  boreTaperAngleDeg: number;
  /** Adaptive outline: feed rate for helix bore and toroidal lead-in (mm/min) */
  helixFeedRate: number;
  /** Adaptive outline: leave 0.1 mm on walls then run a final outline pass */
  finishingPass: boolean;
  /** External cuts: climb (clockwise) vs conventional (counter-clockwise) */
  climbMilling: boolean;
}

export interface LoopPoint {
  x: number;
  y: number;
  z: number;
}

export interface HoleSelection {
  center: LoopPoint;
  radius: number;
  loop?: LoopPoint[];
  holeId?: number;
}

export interface SelectedGeometry {
  faceIndices: number[];
  vertexIndices: number[];
  /** Closed boundary loops for outline-type selections */
  loops?: LoopPoint[][];
  /** Drill/helix — one or more holes */
  holes?: HoleSelection[];
  /** @deprecated use holes[] */
  holeCenter?: LoopPoint;
  /** @deprecated use holes[] */
  holeRadius?: number;
  /** @deprecated use holes[].holeId */
  holeId?: number;
  /** Adaptive: helix bore center in stock XY */
  toolStartPoint?: { x: number; y: number };
  /** Adaptive: slot join on the centerline (draggable along the orange guide) */
  slotJoinPoint?: { x: number; y: number };
  /** @deprecated Legacy bore-center override — use toolStartPoint */
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
  /** Override feed for this segment (mm/min). */
  feedRate?: number;
  /** Debug: trochoid sample classified as on-spur (adaptive outline). */
  onSpur?: boolean;
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
  toolDiameter: 4,
  feedRate: 700,
  plungeRate: 300,
  stepDown: 2,
  stepover: 7,
  spindleSpeed: 10000,
  depthOffset: 0,
  zStartOffset: 1,
  radialOffset: 0,
  slotWidthPercent: 150,
  liftAmount: 0,
  boreDiameterPercent: 150,
  helixAngleDeg: 1.5,
  boreTaperAngleDeg: 2,
  helixFeedRate: 350,
  finishingPass: false,
  climbMilling: true,
};

export type SelectionSubMode = 'geometry' | 'entry-point' | 'bottom-face';

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

export function getSelectedHoles(geometry: SelectedGeometry | null | undefined): HoleSelection[] {
  if (!geometry) return [];
  if (geometry.holes && geometry.holes.length > 0) return geometry.holes;
  if (geometry.holeCenter && geometry.holeRadius) {
    return [
      {
        center: geometry.holeCenter,
        radius: geometry.holeRadius,
        loop: geometry.loops?.[0],
        holeId: geometry.holeId,
      },
    ];
  }
  return [];
}

export function holesMatch(a: HoleSelection, b: HoleSelection, epsilon = 0.5): boolean {
  if (a.holeId !== undefined && b.holeId !== undefined && a.holeId === b.holeId) return true;
  return Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) < epsilon;
}
