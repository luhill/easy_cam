import type { Operation } from '../../types/operations';
import { isAdaptiveOutlineOperation, isOutlineOperation } from '../../types/operations';
import { useAppStore } from '../../store/useAppStore';
import { SETTING_LIMITS, clampSettingValue } from '../../lib/settingLimits';
import { HintTooltip, LabelWithHint } from '../HintTooltip';

interface OperationSettingsProps {
  operation: Operation;
}

type NumericSettingKey = Exclude<
  keyof Operation['settings'],
  'finishingPass' | 'climbMilling' | 'adaptiveMode'
>;

const BASE_FIELDS: {
  key: NumericSettingKey;
  label: string;
  unit: string;
  step: number;
}[] = [
  { key: 'toolDiameter', label: 'Tool Diameter', unit: 'mm', step: 0.1 },
  { key: 'feedRate', label: 'Feed Rate', unit: 'mm/min', step: 50 },
  { key: 'plungeRate', label: 'Plunge Rate', unit: 'mm/min', step: 25 },
  { key: 'stepDown', label: 'Step Down', unit: 'mm', step: 0.1 },
  { key: 'stepover', label: 'Stepover', unit: '%', step: 1 },
  { key: 'spindleSpeed', label: 'Spindle Speed', unit: 'RPM', step: 500 },
  { key: 'depthOffset', label: 'Depth Offset', unit: 'mm', step: 0.1 },
];

const HELIX_BASE_FIELDS: typeof BASE_FIELDS = [
  { key: 'toolDiameter', label: 'Tool Diameter', unit: 'mm', step: 0.1 },
  { key: 'plungeRate', label: 'Plunge Rate', unit: 'mm/min', step: 25 },
  { key: 'stepover', label: 'Stepover', unit: '%', step: 1 },
  { key: 'spindleSpeed', label: 'Spindle Speed', unit: 'RPM', step: 500 },
  { key: 'depthOffset', label: 'Z Offset', unit: 'mm', step: 0.1 },
];

const OUTLINE_SHARED_FIELDS: typeof BASE_FIELDS = [
  { key: 'radialOffset', label: 'Additional Offset', unit: 'mm', step: 0.1 },
  { key: 'rampAngleDeg', label: 'Ramp Angle', unit: '°', step: 0.1 },
];

const ADAPTIVE_ONLY_FIELDS: typeof BASE_FIELDS = [
  { key: 'slotWidthPercent', label: 'Slot Width', unit: '% of tool ⌀', step: 5 },
  { key: 'liftAmount', label: 'Pass Lift', unit: 'mm', step: 0.1 },
  { key: 'boreDiameterPercent', label: 'Bore Diameter', unit: '% of tool ⌀', step: 5 },
  { key: 'boreTaperAngleDeg', label: 'Bore Taper', unit: '°', step: 0.5 },
  { key: 'helixFeedRate', label: 'Helix Feed Rate', unit: 'mm/min', step: 25 },
];

const FINISHING_FIELDS: typeof BASE_FIELDS = [
  {
    key: 'finishingStockPercent',
    label: 'Finish Stock',
    unit: '% of tool ⌀',
    step: 0.5,
  },
];

const HELIX_FIELDS: typeof BASE_FIELDS = [
  { key: 'radialOffset', label: 'XY Offset', unit: 'mm', step: 0.1 },
  { key: 'zStartOffset', label: 'Z Start Offset', unit: 'mm', step: 0.1 },
  { key: 'rampAngleDeg', label: 'Helix Pitch Angle', unit: '°', step: 0.1 },
  { key: 'boreTaperAngleDeg', label: 'Taper', unit: '°', step: 0.5 },
];

const DEPTH_HINT =
  'Z=0 at stock top; cuts are negative Z. Z offset is measured from the part bottom (+ stops short). Step down sets the maximum per-pass depth; passes are spaced evenly to the target.';

function fieldLabel(operation: Operation, key: NumericSettingKey, fallback: string): string {
  if (isOutlineOperation(operation) && key === 'stepover') {
    return operation.settings.adaptiveMode ? 'Pass Advance (Stepover)' : fallback;
  }
  if (operation.type === 'helix' && key === 'stepover') {
    return 'Bottom Widen Stepover';
  }
  return fallback;
}

function fieldHint(operation: Operation, key: NumericSettingKey): string | undefined {
  if (key === 'depthOffset' || key === 'stepDown') {
    if (
      isOutlineOperation(operation) ||
      operation.type === 'helix'
    ) {
      return DEPTH_HINT;
    }
  }
  if (key === 'rampAngleDeg' && isOutlineOperation(operation)) {
    return operation.settings.adaptiveMode
      ? 'Helical bore entry pitch angle for adaptive clearing.'
      : 'Linear entry ramp angle; each layer ramps in, cuts one full loop, then ramps to the next depth.';
  }
  if (key === 'finishingStockPercent') {
    return 'Radial stock left on walls during roughing before the final finish pass.';
  }
  if (key === 'boreTaperAngleDeg' && operation.type === 'helix') {
    return 'Set to 0 to disable. At each pass bottom the tool spirals outward to full diameter using stepover.';
  }
  if (key === 'zStartOffset' && operation.type === 'helix') {
    return 'Helix ramp begins at the lower of this offset above stock top or the global safe height.';
  }
  return undefined;
}

export function OperationSettings({ operation }: OperationSettingsProps) {
  const updateOperationSettings = useAppStore((s) => s.updateOperationSettings);
  const updateOperation = useAppStore((s) => s.updateOperation);

  if (operation.type === 'custom-gcode') {
    return (
      <div className="operation-settings">
        <div className="setting-row">
          <label>Name</label>
          <input
            type="text"
            value={operation.name}
            onChange={(e) => updateOperation(operation.id, { name: e.target.value })}
          />
        </div>
        <div className="gcode-template-field custom-gcode-field">
          <label htmlFor={`custom-gcode-${operation.id}`}>
            <LabelWithHint hint="Marlin G-code inserted verbatim at this step in the exported program. One command per line.">
              G-code
            </LabelWithHint>
          </label>
          <textarea
            id={`custom-gcode-${operation.id}`}
            className="custom-gcode-textarea"
            value={operation.customGcode ?? ''}
            onChange={(e) =>
              updateOperation(operation.id, { customGcode: e.target.value })
            }
            rows={12}
            spellCheck={false}
          />
        </div>
      </div>
    );
  }

  const adaptiveMode = isAdaptiveOutlineOperation(operation);

  const fields =
    operation.type === 'helix'
      ? [...HELIX_BASE_FIELDS, ...HELIX_FIELDS]
      : isOutlineOperation(operation)
        ? [
            ...BASE_FIELDS,
            ...OUTLINE_SHARED_FIELDS,
            ...(adaptiveMode ? ADAPTIVE_ONLY_FIELDS : []),
            ...(operation.settings.finishingPass ? FINISHING_FIELDS : []),
          ]
        : BASE_FIELDS;

  return (
    <div className="operation-settings">
      <div className="setting-row">
        <label>Name</label>
        <input
          type="text"
          value={operation.name}
          onChange={(e) => updateOperation(operation.id, { name: e.target.value })}
        />
      </div>

      {isOutlineOperation(operation) && (
        <div className="settings-checkboxes">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={operation.settings.adaptiveMode}
              onChange={(e) =>
                updateOperationSettings(operation.id, { adaptiveMode: e.target.checked })
              }
            />
            Adaptive mode
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={operation.settings.climbMilling}
              onChange={(e) =>
                updateOperationSettings(operation.id, { climbMilling: e.target.checked })
              }
            />
            Climb milling
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={operation.settings.finishingPass}
              onChange={(e) =>
                updateOperationSettings(operation.id, { finishingPass: e.target.checked })
              }
            />
            Final outline finishing pass
          </label>
        </div>
      )}

      {operation.type === 'helix' && (
        <div className="settings-checkboxes">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={operation.settings.climbMilling}
              onChange={(e) =>
                updateOperationSettings(operation.id, { climbMilling: e.target.checked })
              }
            />
            Climb milling
          </label>
        </div>
      )}

      <div className="settings-grid">
        {fields.map(({ key, label, unit, step }) => {
          const limits = SETTING_LIMITS[key];
          const hint = fieldHint(operation, key);
          return (
            <div className="setting-row" key={key}>
              <label>
                {hint ? (
                  <LabelWithHint hint={hint}>{fieldLabel(operation, key, label)}</LabelWithHint>
                ) : (
                  fieldLabel(operation, key, label)
                )}{' '}
                <span className="unit">({unit})</span>
              </label>
              <input
                type="number"
                value={operation.settings[key]}
                min={limits.min}
                max={limits.max}
                step={step}
                onChange={(e) =>
                  updateOperationSettings(operation.id, {
                    [key]: clampSettingValue(key, parseFloat(e.target.value)),
                  })
                }
              />
            </div>
          );
        })}
      </div>
      {adaptiveMode && (
        <div className="operation-settings-footer">
          <HintTooltip text="Viewer debug: orange = slot centerline guide; green trochoid loops = samples classified as on-spur (scaled radius)." />
        </div>
      )}
      {operation.type === 'drill' && (
        <div className="operation-settings-footer">
          <HintTooltip text="Click holes to add/remove. Multiple holes are drilled in selection order with rapid moves between them." />
        </div>
      )}
      {operation.type === 'helix' && (
        <div className="operation-settings-footer">
          <HintTooltip text="Click holes to add/remove. Invalid holes (red) are skipped: hole diameter must exceed tool diameter, and taper must not collapse the helix radius before final depth." />
        </div>
      )}
    </div>
  );
}
