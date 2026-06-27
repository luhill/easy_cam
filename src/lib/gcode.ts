import type { Operation, ToolpathSegment } from '../types/operations';

export function generateGcode(
  operations: Operation[],
  toolpaths: ToolpathSegment[]
): string {
  const enabledOps = operations.filter((op) => op.enabled);
  if (enabledOps.length === 0) {
    return '; No enabled operations\n';
  }

  const lines: string[] = [
    '; Easy CAM G-code',
    `; Generated ${new Date().toISOString()}`,
    'G21 ; mm',
    'G90 ; absolute',
    'G17 ; XY plane',
    '',
  ];

  for (const op of enabledOps) {
    const path = toolpaths.find((tp) => tp.operationId === op.id);
    if (!path || path.points.length === 0) continue;

    const { settings } = op;
    lines.push(`; --- ${op.name} (${op.type}) ---`);
    lines.push(`M3 S${settings.spindleSpeed} ; spindle on`);
    lines.push(`G0 Z${settings.clearance.toFixed(3)} ; safe Z`);

    for (const pt of path.points) {
      if (pt.rapid) {
        lines.push(
          `G0 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} Z${pt.z.toFixed(3)}`
        );
      } else {
        const isPlunge = pt.z < 0;
        const feed = isPlunge ? settings.plungeRate : settings.feedRate;
        lines.push(
          `G1 X${pt.x.toFixed(3)} Y${pt.y.toFixed(3)} Z${pt.z.toFixed(3)} F${feed}`
        );
      }
    }

    lines.push(`G0 Z${settings.clearance.toFixed(3)} ; retract`);
    lines.push('M5 ; spindle off');
    lines.push('');
  }

  lines.push('M30 ; program end');
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
