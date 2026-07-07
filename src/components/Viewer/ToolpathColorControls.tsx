import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { buildVisiblePreviewToolpaths } from '../../lib/toolpaths';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  TOOLPATH_MOVE_COLORS,
  TOOLPATH_MOVE_KINDS,
  TOOLPATH_MOVE_LABELS,
  computeToolpathFeedRange,
  type ToolpathColorMode,
} from '../../lib/toolpathColors';

const COLOR_MODES: { id: ToolpathColorMode; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'speed', label: 'Speed' },
];

export function ToolpathColorControls() {
  const stlUrl = useAppStore((s) => s.stlUrl);
  const toolpaths = useAppStore((s) => s.toolpaths);
  const operations = useAppStore((s) => s.operations);
  const colorMode = useAppStore((s) => s.toolpathColorMode);
  const setToolpathColorMode = useAppStore((s) => s.setToolpathColorMode);
  const typeVisibility = useAppStore((s) => s.toolpathTypeVisibility);
  const toggleToolpathTypeVisible = useAppStore((s) => s.toggleToolpathTypeVisible);
  const travelFeedRate = useSettingsStore((s) => s.travelFeedRate);
  const toolOrigin = useSettingsStore((s) => s.toolOrigin);
  const safeHeight = useSettingsStore((s) => s.safeHeight);
  const partBounds = useAppStore((s) => s.partBounds);

  const visiblePaths = useMemo(
    () =>
      buildVisiblePreviewToolpaths(
        toolpaths,
        operations,
        toolOrigin,
        partBounds?.maxZ ?? 0,
        safeHeight
      ),
    [toolpaths, operations, toolOrigin, partBounds?.maxZ, safeHeight]
  );

  const feedRange = useMemo(
    () => computeToolpathFeedRange(visiblePaths, operations, travelFeedRate),
    [visiblePaths, operations, travelFeedRate]
  );

  const hasToolpaths = visiblePaths.length > 0;
  const hasAdaptiveOp = operations.some((op) => op.settings.adaptiveMode && op.visible);

  if (!stlUrl || (!hasToolpaths && !hasAdaptiveOp)) return null;

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

      <div className="toolpath-color-mode-label toolpath-color-show-label">Show types</div>
      <div className="toolpath-color-legend toolpath-color-legend--type">
        {TOOLPATH_MOVE_KINDS.map((kind) => (
          <label key={kind} className="toolpath-color-legend-item toolpath-color-toggle">
            <input
              type="checkbox"
              checked={typeVisibility[kind]}
              onChange={() => toggleToolpathTypeVisible(kind)}
            />
            <span
              className="toolpath-color-swatch"
              style={{ background: TOOLPATH_MOVE_COLORS[kind] }}
            />
            {TOOLPATH_MOVE_LABELS[kind]}
          </label>
        ))}
      </div>

      {colorMode === 'speed' && hasToolpaths && (
        <div className="toolpath-color-legend toolpath-color-legend--speed">
          <div className="toolpath-speed-gradient" aria-hidden />
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
