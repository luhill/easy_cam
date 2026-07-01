import { useSettingsStore } from '../store/useSettingsStore';
import { HintTooltip } from './HintTooltip';

export function ToolOriginSettings() {
  const toolOrigin = useSettingsStore((s) => s.toolOrigin);
  const toolOriginAuto = useSettingsStore((s) => s.toolOriginAuto);
  const setToolOrigin = useSettingsStore((s) => s.setToolOrigin);
  const setToolOriginAuto = useSettingsStore((s) => s.setToolOriginAuto);

  return (
    <div className="tool-origin-settings">
      <div className="tool-origin-header">
        <span className="panel-title-row">
          <span className="panel-title">Tool Origin (WCS)</span>
          <HintTooltip text="WCS zero sits at the tool origin. XY is in world mm. Z is relative to the stock top (CAM Z=0): use −6 to place WCS at the bottom of a 6 mm tall part. Auto mode centers XY and sets Z to 10 mm above stock top." />
        </span>
        <label className="auto-toggle">
          <input
            type="checkbox"
            checked={toolOriginAuto}
            onChange={(e) => setToolOriginAuto(e.target.checked)}
          />
          Auto
        </label>
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
              disabled={toolOriginAuto}
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
