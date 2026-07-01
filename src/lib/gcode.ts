import type { GcodeOutputFormat, GcodeTemplates } from '../store/useSettingsStore';
import type { ToolOrigin } from './geometryProcessing';
import { DEFAULT_WCS_Z_ABOVE_STOCK } from './cutDepth';
import {
  gcodeSafeZ,
  gcodeXY,
  gcodeZFromWorld,
} from './toolOriginProgram';
import type { Operation, ToolpathSegment } from '../types/operations';

export interface GcodeTemplateVars {
  toolNumber: number;
  toolDiameter: number;
  spindleSpeed: number;
  feedRate: number;
  plungeRate: number;
  safeHeight: number;
  operationName: string;
}

export interface GcodeExportOptions {
  operations: Operation[];
  toolpaths: ToolpathSegment[];
  templates: GcodeTemplates;
  toolOrigin?: ToolOrigin;
  stockTopWorldZ?: number;
  safeHeight?: number;
  format?: GcodeOutputFormat;
}

export function applyGcodeTemplate(
  template: string,
  vars: Partial<GcodeTemplateVars>
): string[] {
  const substituted = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key as keyof GcodeTemplateVars];
    if (value !== undefined) return String(value);
    if (key === 'clearance' && vars.safeHeight !== undefined) return String(vars.safeHeight);
    return `{${key}}`;
  });

  return substituted
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
}

export function defaultGcodeFilename(stlFileName: string | null | undefined): string {
  if (!stlFileName) return 'program.g';
  const base = stlFileName.replace(/\.[^./\\]+$/, '').trim();
  return `${base || 'program'}.g`;
}

function splitCustomGcodeBlock(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
}

const COORD_DECIMALS = 3;

function roundCoord(value: number): number {
  const factor = 10 ** COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

type MotionMode = 'G0' | 'G1';

interface ModalGcodeState {
  motion: MotionMode | null;
  x: number | null;
  y: number | null;
  z: number | null;
  f: number | null;
}

function createModalGcodeState(): ModalGcodeState {
  return { motion: null, x: null, y: null, z: null, f: null };
}

interface ModalMoveOptions {
  motion: MotionMode;
  x: number;
  y: number;
  z: number;
  feed?: number;
  comment?: string;
}

/** Emit a move line with modal X/Y/Z/F — only words that changed since the last move. */
function formatModalMove(
  state: ModalGcodeState,
  opts: ModalMoveOptions
): { line: string; state: ModalGcodeState } {
  const x = roundCoord(opts.x);
  const y = roundCoord(opts.y);
  const z = roundCoord(opts.z);
  const feed = opts.feed !== undefined ? Math.round(opts.feed) : undefined;

  const parts: string[] = [];

  if (state.motion !== opts.motion) {
    parts.push(opts.motion);
  }
  if (state.x !== x) {
    parts.push(`X${x.toFixed(COORD_DECIMALS)}`);
  }
  if (state.y !== y) {
    parts.push(`Y${y.toFixed(COORD_DECIMALS)}`);
  }
  if (state.z !== z) {
    parts.push(`Z${z.toFixed(COORD_DECIMALS)}`);
  }
  if (opts.motion === 'G1' && feed !== undefined && state.f !== feed) {
    parts.push(`F${feed.toFixed(0)}`);
  }

  const comment = opts.comment ? ` ; ${opts.comment}` : '';
  const line = parts.length > 0 ? `${parts.join(' ')}${comment}` : '';

  return {
    line,
    state: {
      motion: opts.motion,
      x,
      y,
      z,
      f: opts.motion === 'G1' && feed !== undefined ? feed : state.f,
    },
  };
}

function generateMarlinGcode(options: GcodeExportOptions): string {
  const {
    operations,
    toolpaths,
    templates,
    toolOrigin = { x: 0, y: 0, z: DEFAULT_WCS_Z_ABOVE_STOCK },
    stockTopWorldZ = 0,
    safeHeight = 10,
  } = options;

  const enabledOps = operations.filter((op) => op.enabled);
  if (enabledOps.length === 0) {
    return '; No enabled operations\n';
  }

  const lines: string[] = [
    '; Easy CAM G-code',
    '; Output format: Marlin',
    `; Generated ${new Date().toISOString()}`,
    '',
    ...applyGcodeTemplate(templates.startGcode, { safeHeight }),
    '',
  ];

  let previousToolDiameter: number | null = null;
  let toolNumber = 1;
  let wroteOriginPosition = false;
  let modal = createModalGcodeState();

  const emitMove = (opts: ModalMoveOptions) => {
    const result = formatModalMove(modal, opts);
    modal = result.state;
    if (result.line) lines.push(result.line);
  };

  for (const op of enabledOps) {
    lines.push(`; --- ${op.name} (${op.type}) ---`);

    if (op.type === 'custom-gcode') {
      const block = op.customGcode?.trim();
      if (block) {
        lines.push(...splitCustomGcodeBlock(block));
      } else {
        lines.push('; (empty custom G-code block)');
      }
      lines.push('');
      modal = createModalGcodeState();
      continue;
    }

    const path = toolpaths.find((tp) => tp.operationId === op.id);
    if (!path || path.points.length === 0) {
      lines.push('; (skipped — no toolpath)');
      lines.push('');
      continue;
    }

    if (!wroteOriginPosition) {
      emitMove({
        motion: 'G0',
        x: 0,
        y: 0,
        z: gcodeSafeZ(safeHeight, toolOrigin),
        comment: 'tool origin',
      });
      lines.push('');
      wroteOriginPosition = true;
    }

    const { settings } = op;
    const templateVars: Partial<GcodeTemplateVars> = {
      toolNumber,
      toolDiameter: settings.toolDiameter,
      spindleSpeed: settings.spindleSpeed,
      feedRate: settings.feedRate,
      plungeRate: settings.plungeRate,
      safeHeight,
      operationName: op.name,
    };

    const needsToolChange =
      previousToolDiameter !== null &&
      previousToolDiameter !== settings.toolDiameter;

    if (needsToolChange) {
      toolNumber += 1;
      templateVars.toolNumber = toolNumber;
      lines.push(`; --- Tool change before ${op.name} ---`);
      lines.push(...applyGcodeTemplate(templates.toolChangeGcode, templateVars));
      lines.push('');
      modal = createModalGcodeState();
    }

    previousToolDiameter = settings.toolDiameter;

    if (!needsToolChange) {
      lines.push(`M3 S${settings.spindleSpeed} ; spindle on`);
    }

    emitMove({
      motion: 'G0',
      x: modal.x ?? 0,
      y: modal.y ?? 0,
      z: gcodeSafeZ(safeHeight, toolOrigin),
      comment: 'safe Z',
    });

    for (const pt of path.points) {
      const { x, y } = gcodeXY(pt.x, pt.y, toolOrigin);
      const z = gcodeZFromWorld(pt.z, stockTopWorldZ, toolOrigin);
      if (pt.rapid) {
        emitMove({ motion: 'G0', x, y, z });
      } else {
        const feed = pt.feedRate ?? settings.feedRate;
        emitMove({ motion: 'G1', x, y, z, feed });
      }
    }

    emitMove({
      motion: 'G0',
      x: modal.x ?? 0,
      y: modal.y ?? 0,
      z: gcodeSafeZ(safeHeight, toolOrigin),
      comment: 'retract',
    });
    lines.push('M5 ; spindle off');
    lines.push('');
  }

  lines.push(...applyGcodeTemplate(templates.endGcode, { safeHeight }));
  return lines.join('\n');
}

export function generateGcode(options: GcodeExportOptions): string {
  const format = options.format ?? 'marlin';
  switch (format) {
    case 'marlin':
    default:
      return generateMarlinGcode(options);
  }
}

export function downloadGcode(content: string, filename = 'program.g') {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Save G-code via native file picker when available, otherwise trigger download. */
export async function saveGcodeFile(content: string, suggestedName: string): Promise<void> {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'G-code',
            accept: {
              'text/plain': ['.g', '.gcode', '.nc', '.txt'],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
    }
  }

  downloadGcode(content, suggestedName);
}
