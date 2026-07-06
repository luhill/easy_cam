import type { UiTheme } from '../lib/uiTheme';
import { useSettingsStore } from '../store/useSettingsStore';

export function AppearanceSettings() {
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const setUiTheme = useSettingsStore((s) => s.setUiTheme);

  return (
    <div className="appearance-settings">
      <h3 className="panel-title">Appearance</h3>
      <div className="theme-toggle" role="group" aria-label="Color theme">
        {(['dark', 'light'] as UiTheme[]).map((theme) => (
          <button
            key={theme}
            type="button"
            className={`theme-toggle-btn ${uiTheme === theme ? 'active' : ''}`}
            onClick={() => setUiTheme(theme)}
            aria-pressed={uiTheme === theme}
          >
            {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        ))}
      </div>
      <p className="appearance-settings-note">
        UI panels and the 3D viewport follow the selected theme.
      </p>
    </div>
  );
}
