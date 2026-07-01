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
      continue;
    }

    const path = toolpaths.find((tp) => tp.operationId === op.id);
    if (!path || path.points.length === 0) {
      lines.push('; (skipped — no toolpath)');
      lines.push('');
      continue;
    }

    if (!wroteOriginPosition) {
      lines.push(`G0 X0.000 Y0.000 Z${gcodeSafeZ(safeHeight, toolOrigin).toFixed(3)} ; tool origin`);
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
    }

    previousToolDiameter = settings.toolDiameter;

    if (!needsToolChange) {
      lines.push(`M3 S${settings.spindleSpeed} ; spindle on`);
    }

    lines.push(`G0 Z${gcodeSafeZ(safeHeight, toolOrigin).toFixed(3)} ; safe Z`);

    for (const pt of path.points) {
      const { x, y } = gcodeXY(pt.x, pt.y, toolOrigin);
      const z = gcodeZFromWorld(pt.z, stockTopWorldZ, toolOrigin);
      if (pt.rapid) {
        lines.push(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)}`);
      } else {
        const feed = pt.feedRate ?? settings.feedRate;
        lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)} F${feed.toFixed(0)}`);
      }
    }

    lines.push(`G0 Z${gcodeSafeZ(safeHeight, toolOrigin).toFixed(3)} ; retract`);
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
