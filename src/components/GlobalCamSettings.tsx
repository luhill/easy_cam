import { useAppStore } from '../store/useAppStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { DEFAULT_SAFE_HEIGHT, DEFAULT_TOOLPATH_RESOLUTION } from '../lib/toolpathConfig';
import { MAX_TOOLPATH_POINTS } from '../lib/toolpaths';

export function GlobalCamSettings() {
  const safeHeight = useSettingsStore((s) => s.safeHeight);
  const toolpathResolution = useSettingsStore((s) => s.toolpathResolution);
  const setSafeHeight = useSettingsStore((s) => s.setSafeHeight);
  const setToolpathResolution = useSettingsStore((s) => s.setToolpathResolution);
  const regenerateToolpaths = useAppStore((s) => s.regenerateToolpaths);
  const toolpaths = useAppStore((s) => s.toolpaths);
  const totalPoints = toolpaths.reduce((sum, seg) => sum + seg.points.length, 0);

  return (
    <div className="global-cam-settings">
      <h3 className="panel-title">Global CAM</h3>
      <div className="settings-grid">
        <div className="setting-row">
          <label>
            Safe Height <span className="unit">(mm)</span>
          </label>
          <input
            type="number"
            value={safeHeight}
            min={0}
            max={100}
            step={1}
            onChange={(e) => {
              setSafeHeight(parseFloat(e.target.value) || DEFAULT_SAFE_HEIGHT);
              regenerateToolpaths();
            }}
          />
        </div>
        <div className="setting-row">
          <label>
            Toolpath Resolution <span className="unit">(×)</span>
          </label>
          <input
            type="number"
            value={toolpathResolution}
            min={0.5}
            max={8}
            step={0.5}
            onChange={(e) => {
              setToolpathResolution(parseFloat(e.target.value) || DEFAULT_TOOLPATH_RESOLUTION);
              regenerateToolpaths();
            }}
          />
        </div>
      </div>
      <p className="settings-hint toolpath-point-count">
        Toolpath points: {totalPoints.toLocaleString()} / {MAX_TOOLPATH_POINTS.toLocaleString()}
      </p>
      <p className="settings-hint">
        Safe height is used at the start and end of every operation. Resolution 1× is finest; 2×
        (default) uses half as many points. Values below 1× are allowed but increase point count
        sharply — raise resolution if toolpaths look jagged or hit the point limit.
      </p>
    </div>
  );
}
