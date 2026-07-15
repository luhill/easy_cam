import { clampOperationSettings } from '../lib/settingLimits';

export type OperationType =
  | 'outline'
  | 'adaptive-outline'
  | 'drill'
  | 'helix'
  | 'pocket'
  | 'contour'
  | 'custom-gcode';

export interface OperationDefaults {
  toolDiameter: number;
  /** Full-engagement cutting feed (standard outline / pocket contour). */
  feedRate: number;
  /** Chip-thinned feed for adaptive clearing, chip-clear, and final outline passes. */
  adjustedFeedRate: number;
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
  /** Outline: trochoidal adaptive slot clearing around the contour */
  adaptiveMode: boolean;
  /** Standard outline layer entry strategy */
  outlineEntryType: 'linear' | 'helix' | 'straight';
  /** Linear outline ramp length as multiples of tool diameter */
  rampLengthToolDiameters: number;
  /** Slot width as % of tool diameter (125–200%) — adaptive mode only */
  slotWidthPercent: number;
  /** Micro-retract / Z lift between trochoid passes (mm); 0 = no lift — adaptive mode only */
  liftAmount: number;
  /** Outside bore diameter as % of tool diameter — adaptive mode only */
  boreDiameterPercent: number;
  /** Helical (adaptive) or linear (standard outline) entry ramp angle (degrees) */
  rampAngleDeg: number;
  /** Bore wall taper below stock top (degrees) — adaptive mode only */
  boreTaperAngleDeg: number;
  /** Feed rate for helix bore and toroidal lead-in (mm/min) — adaptive mode only */
  helixFeedRate: number;
  /** Leave stock on walls then run a final outline pass */
  finishingPass: boolean;
  /** Finishing stock left on walls as % of tool diameter */
  finishingStockPercent: number;
  /** Number of final-outline passes at the same wall offset (spring passes). */
  finishPassCount: number;
  /** Extra full perimeter at roughing offset (bottom Z) at adjusted feed before the final outline. */
  chipClearBeforeFinal: boolean;
  /** External cuts: climb (clockwise) vs conventional (counter-clockwise) */
  climbMilling: boolean;
  /** Drill: retract height above hole top between pecks (mm); 0 = retract to safe Z each peck */
  chipClearHeight: number;
  /** Drill: full safe-Z retract every N pecks (0 = never; always use chip-clear height) */
  peckFullRetractEvery: number;
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
  /** Opening Z (world) — used for drill chip-clear retract */
  topZ?: number;
  /** Hole floor Z (world) — used for drill depth; falls back to stock bottom */
  bottomZ?: number;
}

/** Closed vertical wall loop for outline — top rim defines offset path and Z extent. */
export interface EdgeLoopSelection {
  loop: LoopPoint[];
  faceIndices: number[];
  topZ: number;
  bottomZ: number;
  edgeLoopId?: number;
  /** +1 / −1 — tool path offsets away from selected wall faces */
  offsetSign?: number;
  wallSide?: 'exterior' | 'interior';
}

export interface SelectedGeometry {
  faceIndices: number[];
  vertexIndices: number[];
  /** Closed boundary loops for outline-type selections */
  loops?: LoopPoint[][];
  /** Outline — one or more vertical edge loops */
  edgeLoops?: EdgeLoopSelection[];
  /** Drill/helix — one or more holes */
  holes?: HoleSelection[];
  /**
   * Contour — sparse surface samples (x,y,z) from selected upward faces for Z-following.
   * Kept coarse so toolpath regen stays cheap.
   */
  surfaceSamples?: LoopPoint[];
  /** @deprecated use holes[] */
  holeCenter?: LoopPoint;
  /** @deprecated use holes[] */
  holeRadius?: number;
  /** @deprecated use holes[].holeId */
  holeId?: number;
  /** Adaptive: helix bore center in stock XY */
  toolStartPoint?: { x: number; y: number };
  /** Adaptive: slot join on the centerline (draggable along the yellow reference guide) */
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
  /** Raw G-code block inserted verbatim when this operation runs. */
  customGcode?: string;
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
    description: '2D contour with optional adaptive trochoidal clearing',
    icon: '◻',
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
    description: '2D pocket clearing with optional adaptive concentric passes',
    icon: '▣',
  },
  {
    type: 'contour',
    label: 'Contour',
    description: '3D contour on upward faces — XY path with Z following surface texture/slopes',
    icon: '〜',
  },
  {
    type: 'custom-gcode',
    label: 'Custom G-code',
    description: 'Insert custom G-code into the program',
    icon: '⌨',
  },
];

export const DEFAULT_SETTINGS: OperationDefaults = {
  toolDiameter: 4,
  feedRate: 700,
  adjustedFeedRate: 1000,
  plungeRate: 300,
  stepDown: 2,
  stepover: 7,
  spindleSpeed: 10000,
  depthOffset: 0,
  zStartOffset: 1,
  radialOffset: 0,
  adaptiveMode: false,
  outlineEntryType: 'linear',
  rampLengthToolDiameters: 5,
  slotWidthPercent: 150,
  liftAmount: 0,
  boreDiameterPercent: 150,
  rampAngleDeg: 1.5,
  boreTaperAngleDeg: 2,
  helixFeedRate: 350,
  finishingPass: false,
  finishingStockPercent: 7,
  finishPassCount: 1,
  chipClearBeforeFinal: true,
  climbMilling: true,
  chipClearHeight: 2,
  peckFullRetractEvery: 0,
};

const HELIX_DEFAULT_OVERRIDES: Partial<OperationDefaults> = {
  plungeRate: 120,
  stepover: 5,
};

export function defaultSettingsForOperation(type: OperationType): OperationDefaults {
  if (type === 'helix') {
    return { ...DEFAULT_SETTINGS, ...HELIX_DEFAULT_OVERRIDES };
  }
  if (type === 'drill') {
    return {
      ...DEFAULT_SETTINGS,
      // Conservative peck: 1× tool diameter (DEFAULT tool is 4 mm).
      stepDown: DEFAULT_SETTINGS.toolDiameter,
      chipClearHeight: 2,
    };
  }
  if (type === 'adaptive-outline') {
    return {
      ...DEFAULT_SETTINGS,
      adaptiveMode: true,
      feedRate: 500,
      adjustedFeedRate: 750,
      stepDown: 6,
      stepover: 5,
      plungeRate: 120,
      liftAmount: 0.5,
      finishingPass: true,
    };
  }
  return { ...DEFAULT_SETTINGS };
}

export type SelectionSubMode = 'geometry' | 'entry-point' | 'bottom-face';

export const OPERATION_COLORS: Record<OperationType, string> = {
  outline: '#3b82f6',
  'adaptive-outline': '#8b5cf6',
  drill: '#ef4444',
  helix: '#f59e0b',
  pocket: '#10b981',
  contour: '#06b6d4',
  'custom-gcode': '#64748b',
};

export function isOutlineOperation(op: Pick<Operation, 'type' | 'settings'>): boolean {
  return op.type === 'outline' || op.type === 'adaptive-outline';
}

export function isAdaptiveOutlineOperation(op: Pick<Operation, 'type' | 'settings'>): boolean {
  return (
    (op.type === 'outline' && op.settings.adaptiveMode) || op.type === 'adaptive-outline'
  );
}

/** Adaptive mode or standard outline with helix entry — uses bore start / join editing. */
export function isOutlineHelixEntryOperation(op: Pick<Operation, 'type' | 'settings'>): boolean {
  if (isAdaptiveOutlineOperation(op)) return true;
  return (
    isOutlineOperation(op) &&
    !op.settings.adaptiveMode &&
    (op.settings.outlineEntryType ?? 'linear') === 'helix'
  );
}

/** Standard outline (non-adaptive) — draggable entry start on the tool centerline. */
export function isStandardOutlineEntryEditable(op: Pick<Operation, 'type' | 'settings'>): boolean {
  return isOutlineOperation(op) && !isAdaptiveOutlineOperation(op);
}

/** Migrate legacy adaptive-outline ops to unified outline + adaptiveMode. */
export function normalizeOperation(op: Operation): Operation {
  if (op.type !== 'adaptive-outline') return op;
  return {
    ...op,
    type: 'outline',
    settings: clampOperationSettings({ ...op.settings, adaptiveMode: true }),
  };
}

export function getSelectionStrategy(type: OperationType): SelectionStrategy {
  switch (type) {
    case 'outline':
    case 'adaptive-outline':
      return 'point';
    case 'drill':
    case 'helix':
      return 'point';
    case 'custom-gcode':
      return 'region';
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

export function getSelectedEdgeLoops(
  geometry: SelectedGeometry | null | undefined
): EdgeLoopSelection[] {
  if (!geometry) return [];
  if (geometry.edgeLoops && geometry.edgeLoops.length > 0) return geometry.edgeLoops;
  return [];
}

export function edgeLoopsMatch(a: EdgeLoopSelection, b: EdgeLoopSelection): boolean {
  if (a.edgeLoopId !== undefined && b.edgeLoopId !== undefined && a.edgeLoopId === b.edgeLoopId) {
    return true;
  }
  if (a.faceIndices.length > 0 && b.faceIndices.length > 0) {
    const bSet = new Set(b.faceIndices);
    const shared = a.faceIndices.filter((f) => bSet.has(f)).length;
    if (shared >= Math.min(a.faceIndices.length, b.faceIndices.length) * 0.5) return true;
  }
  return false;
}

export function isEdgeLoopInSelection(
  edgeLoops: EdgeLoopSelection[],
  candidate: EdgeLoopSelection
): boolean {
  return edgeLoops.some((el) => edgeLoopsMatch(el, candidate));
}
