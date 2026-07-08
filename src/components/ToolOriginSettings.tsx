import { useAppStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  toolOriginXYForAlignTarget,
  type ToolOriginAlignTarget,
} from '../lib/toolOriginAlign';
import { LabelWithHint } from './HintTooltip';

const ALIGN_BUTTONS: { target: ToolOriginAlignTarget; label: string; title: string; className: string }[] = [
  { target: 'up', label: '↑', title: 'Align to top edge center', className: 'tool-origin-align-up' },
  { target: 'left', label: '←', title: 'Align to left edge center', className: 'tool-origin-align-left' },
  { target: 'center', label: '◎', title: 'Align to bounding box center', className: 'tool-origin-align-center' },
  { target: 'right', label: '→', title: 'Align to right edge center', className: 'tool-origin-align-right' },
  { target: 'down', label: '↓', title: 'Align to bottom edge center', className: 'tool-origin-align-down' },
];

export function ToolOriginSettings() {
  const toolOrigin = useSettingsStore((s) => s.toolOrigin);
  const setToolOrigin = useSettingsStore((s) => s.setToolOrigin);
  const regenerateToolpaths = useAppStore((s) => s.regenerateToolpaths);
  const partBounds = useAppStore((s) => s.partBounds);

  const alignOrigin = (target: ToolOriginAlignTarget) => {
    if (!partBounds) return;
    const xy = toolOriginXYForAlignTarget(partBounds, target);
    setToolOrigin(xy);
    regenerateToolpaths();
  };

  return (
    <div className="tool-origin-settings">
      <div className="tool-origin-header">
        <span className="panel-title-row">
          <LabelWithHint hint="WCS zero offset from the stock coordinate system. Exported G-code X/Y are relative to this XY position (0,0 at program start). Z is relative to stock top (CAM Z=0) minus this Z offset.">
            <span className="panel-title">Tool Origin Offset</span>
          </LabelWithHint>
        </span>
      </div>
      <div className="settings-grid">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <div className="setting-row" key={axis}>
            <label>
              {axis.toUpperCase()} <span className="unit">(mm)</span>
            </label>
            <input
              type="number"
              value={toolOrigin[axis]}
              step={0.1}
              onChange={(e) => {
                setToolOrigin({ [axis]: parseFloat(e.target.value) || 0 });
                regenerateToolpaths();
              }}
            />
          </div>
        ))}
      </div>
      <div className="tool-origin-align-section">
        <span className="tool-origin-align-label">Align XY to part bounds</span>
        <div className="tool-origin-align-pad" role="group" aria-label="Align tool origin to part bounding box">
          {ALIGN_BUTTONS.map(({ target, label, title, className }) => (
            <button
              key={target}
              type="button"
              className={`btn btn-small tool-origin-align-btn ${className}`}
              title={title}
              disabled={!partBounds}
              onClick={() => alignOrigin(target)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
