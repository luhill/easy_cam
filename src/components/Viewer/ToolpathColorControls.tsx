import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  TOOLPATH_MOVE_COLORS,
  TOOLPATH_MOVE_LABELS,
  computeToolpathFeedRange,
  type ToolpathColorMode,
  type ToolpathMoveKind,
} from '../../lib/toolpathColors';

const COLOR_MODES: { id: ToolpathColorMode; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'speed', label: 'Speed' },
];

const TYPE_LEGEND_ORDER: ToolpathMoveKind[] = ['cut', 'plunge', 'travel', 'rapid', 'spur'];

export function ToolpathColorControls() {
  const stlUrl = useAppStore((s) => s.stlUrl);
  const toolpaths = useAppStore((s) => s.toolpaths);
  const operations = useAppStore((s) => s.operations);
  const colorMode = useAppStore((s) => s.toolpathColorMode);
  const setToolpathColorMode = useAppStore((s) => s.setToolpathColorMode);
  const travelFeedRate = useSettingsStore((s) => s.travelFeedRate);

  const visiblePaths = useMemo(() => {
    const visibleIds = new Set(operations.filter((o) => o.visible).map((o) => o.id));
    return toolpaths.filter((tp) => visibleIds.has(tp.operationId));
  }, [toolpaths, operations]);

  const feedRange = useMemo(
    () => computeToolpathFeedRange(visiblePaths, operations, travelFeedRate),
    [visiblePaths, operations, travelFeedRate]
  );

  if (!stlUrl || visiblePaths.length === 0) return null;

  return (
    <div className="toolpath-color-controls">
      <label className="toolpath-color-mode">
        <span className="toolpath-color-mode-label">Line color</span>
        <select
          value={colorMode}
          onChange={(e) => setToolpathColorMode(e.target.value as ToolpathColorMode)}
        >
          {COLOR_MODES.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {colorMode === 'type' ? (
        <div className="toolpath-color-legend toolpath-color-legend--type">
          {TYPE_LEGEND_ORDER.map((kind) => (
            <span key={kind} className="toolpath-color-legend-item">
              <span
                className="toolpath-color-swatch"
                style={{ background: TOOLPATH_MOVE_COLORS[kind] }}
              />
              {TOOLPATH_MOVE_LABELS[kind]}
            </span>
          ))}
        </div>
      ) : (
        <div className="toolpath-color-legend toolpath-color-legend--speed">
          <div
            className="toolpath-speed-gradient"
            aria-hidden
          />
          <div className="toolpath-speed-labels">
            <span>{Math.round(feedRange.min)}</span>
            <span>mm/min</span>
            <span>{Math.round(feedRange.max)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
