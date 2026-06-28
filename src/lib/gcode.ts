import type { GcodeTemplates } from '../store/useSettingsStore';
import type { ToolOrigin } from './geometryProcessing';
import { DEFAULT_WCS_Z_ABOVE_STOCK, worldZToCamZ } from './cutDepth';
import type { Operation, ToolpathSegment } from '../types/operations';

export interface GcodeTemplateVars {
  toolNumber: number;
  toolDiameter: number;
  spindleSpeed: number;
  feedRate: number;
  plungeRate: number;
  clearance: number;
  operationName: string;
}

export function applyGcodeTemplate(
  template: string,
  vars: Partial<GcodeTemplateVars>
): string[] {
  const substituted = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key as keyof GcodeTemplateVars];
    return value !== undefined ? String(value) : `{${key}}`;
  });

  return substituted
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1);
}

export function generateGcode(
  operations: Operation[],
  toolpaths: ToolpathSegment[],
  templates: GcodeTemplates,
  toolOrigin: ToolOrigin = { x: 0, y: 0, z: DEFAULT_WCS_Z_ABOVE_STOCK },
  stockTopWorldZ = 0
): string {
  const enabledOps = operations.filter((op) => op.enabled);
  if (enabledOps.length === 0) {
    return '; No enabled operations\n';
  }

  const lines: string[] = [
    '; Easy CAM G-code',
    `; Generated ${new Date().toISOString()}`,
    '',
    ...applyGcodeTemplate(templates.startGcode, {}),
    '',
  ];

  let previousToolDiameter: number | null = null;
  let toolNumber = 1;

  for (const op of enabledOps) {
    const path = toolpaths.find((tp) => tp.operationId === op.id);
    if (!path || path.points.length === 0) continue;

    const { settings } = op;
    const templateVars: Partial<GcodeTemplateVars> = {
      toolNumber,
      toolDiameter: settings.toolDiameter,
      spindleSpeed: settings.spindleSpeed,
      feedRate: settings.feedRate,
      plungeRate: settings.plungeRate,
      clearance: settings.clearance,
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

    lines.push(`; --- ${op.name} (${op.type}) ---`);

    if (!needsToolChange) {
      lines.push(`M3 S${settings.spindleSpeed} ; spindle on`);
    }

    lines.push(`G0 Z${settings.clearance.toFixed(3)} ; safe Z`);

    for (const pt of path.points) {
      const x = pt.x - toolOrigin.x;
      const y = pt.y - toolOrigin.y;
      const camZ = worldZToCamZ(pt.z, stockTopWorldZ);
      const z = camZ - toolOrigin.z;
      if (pt.rapid) {
        lines.push(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)}`);
      } else {
        const feed = pt.feedRate ?? settings.feedRate;
        lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} Z${z.toFixed(3)} F${feed}`);
      }
    }

    lines.push(`G0 Z${settings.clearance.toFixed(3)} ; retract`);
    lines.push('M5 ; spindle off');
    lines.push('');
  }

  lines.push(...applyGcodeTemplate(templates.endGcode, {}));
  return lines.join('\n');
}

export function downloadGcode(content: string, filename = 'program.nc') {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
