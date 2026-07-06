import { useSettingsStore } from '../store/useSettingsStore';
import { LabelWithHint } from './HintTooltip';

export function ToolOriginSettings() {
  const toolOrigin = useSettingsStore((s) => s.toolOrigin);
  const setToolOrigin = useSettingsStore((s) => s.setToolOrigin);

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
              onChange={(e) =>
                setToolOrigin({ [axis]: parseFloat(e.target.value) || 0 })
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
