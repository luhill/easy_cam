import {
  useSettingsStore,
  type GcodeTemplates,
} from '../store/useSettingsStore';
import { LabelWithHint } from './HintTooltip';

const TEMPLATE_FIELDS: {
  key: keyof GcodeTemplates;
  label: string;
  hint: string;
  rows: number;
}[] = [
  {
    key: 'startGcode',
    label: 'Start G-code',
    hint: 'Inserted at the beginning of every exported program.',
    rows: 6,
  },
  {
    key: 'toolChangeGcode',
    label: 'Tool Change G-code',
    hint: 'Inserted when the tool diameter changes between operations. Variables: {toolNumber}, {toolDiameter}, {spindleSpeed}, {feedRate}, {plungeRate}, {safeHeight}, {operationName}',
    rows: 8,
  },
  {
    key: 'endGcode',
    label: 'End G-code',
    hint: 'Appended after all operations complete.',
    rows: 5,
  },
];

export function GcodeSettings() {
  const gcodeTemplates = useSettingsStore((s) => s.gcodeTemplates);
  const setGcodeTemplate = useSettingsStore((s) => s.setGcodeTemplate);
  const resetGcodeTemplates = useSettingsStore((s) => s.resetGcodeTemplates);

  return (
    <div className="gcode-settings">
      <div className="gcode-settings-header">
        <span className="gcode-settings-title">Machine G-code</span>
        <span className="gcode-settings-badge">Saved locally</span>
      </div>

      <div className="gcode-settings-body">
        {TEMPLATE_FIELDS.map(({ key, label, hint, rows }) => (
          <div className="gcode-template-field" key={key}>
            <label htmlFor={`gcode-${key}`}>
              <LabelWithHint hint={hint}>{label}</LabelWithHint>
            </label>
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
    </div>
  );
}
