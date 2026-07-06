import { useSettingsStore } from '../store/useSettingsStore';
import { LabelWithHint } from './HintTooltip';

export function ViewportSettings() {
  const isometricProjection = useSettingsStore((s) => s.isometricProjection);
  const setIsometricProjection = useSettingsStore((s) => s.setIsometricProjection);

  return (
    <div className="viewport-settings">
      <h3 className="panel-title">Viewport</h3>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={isometricProjection}
          onChange={(e) => setIsometricProjection(e.target.checked)}
        />
        <LabelWithHint hint="Use parallel (isometric) projection instead of perspective. Removes foreshortening for easier measurement.">
          Isometric projection
        </LabelWithHint>
      </label>
    </div>
  );
}
