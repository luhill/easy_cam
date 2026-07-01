import type { Operation } from '../../types/operations';
import { useAppStore } from '../../store/useAppStore';
import { SETTING_LIMITS, clampSettingValue } from '../../lib/settingLimits';
import { HintTooltip, LabelWithHint } from '../HintTooltip';

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
  { key: 'depthOffset', label: 'Depth Offset', unit: 'mm', step: 0.1 },
];

const HELIX_BASE_FIELDS: typeof BASE_FIELDS = [
  { key: 'toolDiameter', label: 'Tool Diameter', unit: 'mm', step: 0.1 },
  { key: 'plungeRate', label: 'Plunge Rate', unit: 'mm/min', step: 25 },
  { key: 'stepDown', label: 'Step Down', unit: 'mm', step: 0.1 },
  { key: 'stepover', label: 'Stepover', unit: '%', step: 1 },
  { key: 'spindleSpeed', label: 'Spindle Speed', unit: 'RPM', step: 500 },
  { key: 'depthOffset', label: 'Z Offset', unit: 'mm', step: 0.1 },
];

const OUTLINE_FIELDS: typeof BASE_FIELDS = [
  { key: 'radialOffset', label: 'Additional Offset', unit: 'mm', step: 0.1 },
];

const HELIX_FIELDS: typeof BASE_FIELDS = [
  { key: 'radialOffset', label: 'XY Offset', unit: 'mm', step: 0.1 },
  { key: 'helixAngleDeg', label: 'Helix Pitch Angle', unit: '°', step: 0.1 },
  { key: 'boreTaperAngleDeg', label: 'Taper', unit: '°', step: 0.5 },
];

const ADAPTIVE_FIELDS: typeof BASE_FIELDS = [
  { key: 'radialOffset', label: 'Additional Offset', unit: 'mm', step: 0.1 },
  { key: 'slotWidthPercent', label: 'Slot Width', unit: '% of tool ⌀', step: 5 },
  { key: 'liftAmount', label: 'Pass Lift', unit: 'mm', step: 0.1 },
  { key: 'boreDiameterPercent', label: 'Bore Diameter', unit: '% of tool ⌀', step: 5 },
  { key: 'helixAngleDeg', label: 'Helix Pitch Angle', unit: '°', step: 0.1 },
  { key: 'boreTaperAngleDeg', label: 'Bore Taper', unit: '°', step: 0.5 },
];

const DEPTH_HINT =
  'Z=0 at stock top; cuts are negative Z. Z offset is measured from the part bottom (+ stops short). Step down sets the maximum per-pass depth; passes are spaced evenly to the target.';

function fieldLabel(operation: Operation, key: NumericSettingKey, fallback: string): string {
  if (operation.type === 'adaptive-outline' && key === 'stepover') {
    return 'Pass Advance (Stepover)';
  }
  if (operation.type === 'helix' && key === 'stepover') {
    return 'Bottom Widen Stepover';
  }
  return fallback;
}

export function OperationSettings({ operation }: OperationSettingsProps) {
  const updateOperationSettings = useAppStore((s) => s.updateOperationSettings);
  const updateOperation = useAppStore((s) => s.updateOperation);

  const fields =
    operation.type === 'adaptive-outline'
      ? [...BASE_FIELDS, ...ADAPTIVE_FIELDS]
      : operation.type === 'helix'
        ? [...HELIX_BASE_FIELDS, ...HELIX_FIELDS]
        : operation.type === 'outline'
          ? [...BASE_FIELDS, ...OUTLINE_FIELDS]
          : BASE_FIELDS;

  const showDepthHint =
    operation.type === 'outline' ||
    operation.type === 'adaptive-outline' ||
    operation.type === 'helix';

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

      {(operation.type === 'outline' ||
        operation.type === 'adaptive-outline' ||
        operation.type === 'helix') && (
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
          {operation.type === 'adaptive-outline' && (
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
          )}
        </div>
      )}

      <div className="settings-grid">
        {fields.map(({ key, label, unit, step }) => {
          const limits = SETTING_LIMITS[key];
          const hint =
            key === 'depthOffset' && showDepthHint
              ? DEPTH_HINT
              : key === 'stepDown' && showDepthHint
                ? DEPTH_HINT
                : key === 'boreTaperAngleDeg' && operation.type === 'helix'
                  ? 'Set to 0 to disable. At each pass bottom the tool spirals outward to full diameter using stepover.'
                  : undefined;
          return (
            <div className="setting-row" key={key}>
              <label>
                {hint ? (
                  <LabelWithHint hint={hint}>
                    {fieldLabel(operation, key, label)}
                  </LabelWithHint>
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
      {operation.type === 'adaptive-outline' && (
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
          <HintTooltip text="Click holes to add/remove. Each hole is helixed in selection order. Hover highlights cylindrical walls; selected holes show wall tint plus top loop." />
        </div>
      )}
    </div>
  );
}
