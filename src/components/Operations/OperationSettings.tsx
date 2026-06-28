import type { Operation } from '../../types/operations';
import { useAppStore } from '../../store/useAppStore';
import { SETTING_LIMITS, clampSettingValue } from '../../lib/settingLimits';

interface OperationSettingsProps {
  operation: Operation;
}

type NumericSettingKey = Exclude<
  keyof Operation['settings'],
  'finishingPass' | 'climbMilling'
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
  { key: 'clearance', label: 'Clearance', unit: 'mm', step: 1 },
  { key: 'depth', label: 'Cut Depth', unit: 'mm', step: 0.5 },
];

const OUTLINE_FIELDS: typeof BASE_FIELDS = [
  { key: 'radialOffset', label: 'Additional Offset', unit: 'mm', step: 0.1 },
];

const ADAPTIVE_FIELDS: typeof BASE_FIELDS = [
  { key: 'radialOffset', label: 'Additional Offset', unit: 'mm', step: 0.1 },
  { key: 'slotWidthPercent', label: 'Slot Width', unit: '% of tool ⌀', step: 5 },
  { key: 'liftAmount', label: 'Pass Lift', unit: 'mm', step: 0.1 },
  { key: 'helixDiameterPercent', label: 'Helix Diameter', unit: '% of tool ⌀', step: 5 },
  { key: 'helixAngleDeg', label: 'Helix Angle', unit: '°', step: 0.1 },
  { key: 'helixFeedRate', label: 'Helix Feed Rate', unit: 'mm/min', step: 25 },
];

function fieldLabel(operation: Operation, key: NumericSettingKey, fallback: string): string {
  if (operation.type === 'adaptive-outline' && key === 'stepover') {
    return 'Pass Advance (Stepover)';
  }
  return fallback;
}

export function OperationSettings({ operation }: OperationSettingsProps) {
  const updateOperationSettings = useAppStore((s) => s.updateOperationSettings);
  const updateOperation = useAppStore((s) => s.updateOperation);

  const fields =
    operation.type === 'adaptive-outline'
      ? [...BASE_FIELDS, ...ADAPTIVE_FIELDS]
      : operation.type === 'outline'
        ? [...BASE_FIELDS, ...OUTLINE_FIELDS]
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

      {(operation.type === 'outline' || operation.type === 'adaptive-outline') && (
        <div className="settings-checkboxes">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={operation.settings.climbMilling}
              onChange={(e) =>
                updateOperationSettings(operation.id, { climbMilling: e.target.checked })
              }
            />
            Climb milling (clockwise on external cuts)
          </label>
          {operation.type === 'adaptive-outline' && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={operation.settings.finishingPass}
                onChange={(e) =>
                  updateOperationSettings(operation.id, { finishingPass: e.target.checked })
                }
              />
              Final outline finishing pass (0.1 mm roughing stock)
            </label>
          )}
        </div>
      )}

      <div className="settings-grid">
        {fields.map(({ key, label, unit, step }) => {
          const limits = SETTING_LIMITS[key];
          return (
            <div className="setting-row" key={key}>
              <label>
                {fieldLabel(operation, key, label)} <span className="unit">({unit})</span>
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
      {(operation.type === 'outline' || operation.type === 'adaptive-outline') && (
        <p className="settings-hint">
          {operation.type === 'adaptive-outline'
            ? 'Helix bores at entry, then trochoid loops carve a connector slot to the outline before the full adaptive loop. Finishing pass uses your additional offset only (no 0.1 mm stock).'
            : 'Toolpath runs at tool radius + additional offset from the part outline.'}
        </p>
      )}
      {(operation.type === 'drill' || operation.type === 'helix') && (
        <p className="settings-hint">
          Click holes to add/remove. Multiple holes are drilled in selection order with rapid moves
          between them.
        </p>
      )}
    </div>
  );
}
