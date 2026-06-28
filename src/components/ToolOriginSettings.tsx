import { useSettingsStore } from '../store/useSettingsStore';

export function ToolOriginSettings() {
  const toolOrigin = useSettingsStore((s) => s.toolOrigin);
  const toolOriginAuto = useSettingsStore((s) => s.toolOriginAuto);
  const setToolOrigin = useSettingsStore((s) => s.setToolOrigin);
  const setToolOriginAuto = useSettingsStore((s) => s.setToolOriginAuto);

  return (
    <div className="tool-origin-settings">
      <div className="tool-origin-header">
        <span className="panel-title">Tool Origin (WCS)</span>
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
      <p className="settings-hint" style={{ marginTop: '0.5rem' }}>
        WCS zero sits at the tool origin. Auto mode places XY at the part center and Z at 10 mm
        above stock top (CAM Z=0 is the top surface).
      </p>
    </div>
  );
}
