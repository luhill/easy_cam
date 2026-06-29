import { useState } from 'react';
import {
  useSettingsStore,
  type GcodeTemplates,
} from '../store/useSettingsStore';

const TEMPLATE_FIELDS: {
  key: keyof GcodeTemplates;
  label: string;
  description: string;
  rows: number;
}[] = [
  {
    key: 'startGcode',
    label: 'Start G-code',
    description: 'Inserted at the beginning of every exported program.',
    rows: 6,
  },
  {
    key: 'toolChangeGcode',
    label: 'Tool Change G-code',
    description:
      'Inserted when the tool diameter changes between operations. Variables: {toolNumber}, {toolDiameter}, {spindleSpeed}, {feedRate}, {plungeRate}, {safeHeight}, {operationName}',
    rows: 8,
  },
  {
    key: 'endGcode',
    label: 'End G-code',
    description: 'Appended after all operations complete.',
    rows: 5,
  },
];

export function GcodeSettings() {
  const [collapsed, setCollapsed] = useState(false);
  const gcodeTemplates = useSettingsStore((s) => s.gcodeTemplates);
  const setGcodeTemplate = useSettingsStore((s) => s.setGcodeTemplate);
  const resetGcodeTemplates = useSettingsStore((s) => s.resetGcodeTemplates);

  return (
    <div className="gcode-settings">
      <button
        className="gcode-settings-header"
        onClick={() => setCollapsed((c) => !c)}
        type="button"
      >
        <span className="collapse-arrow">{collapsed ? '▶' : '▼'}</span>
        <span className="gcode-settings-title">Machine G-code</span>
        <span className="gcode-settings-badge">Saved locally</span>
      </button>

      {!collapsed && (
        <div className="gcode-settings-body">
          {TEMPLATE_FIELDS.map(({ key, label, description, rows }) => (
            <div className="gcode-template-field" key={key}>
              <label htmlFor={`gcode-${key}`}>{label}</label>
              <p className="gcode-template-desc">{description}</p>
              <textarea
                id={`gcode-${key}`}
                value={gcodeTemplates[key]}
                onChange={(e) => setGcodeTemplate(key, e.target.value)}
                rows={rows}
                spellCheck={false}
              />
            </div>
          ))}

          <button
            className="btn btn-small btn-secondary gcode-reset-btn"
            onClick={resetGcodeTemplates}
            type="button"
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
