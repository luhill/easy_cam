import type { Operation } from '../../types/operations';
import { useAppStore } from '../../store/useAppStore';

interface OperationSettingsProps {
  operation: Operation;
}

const BASE_FIELDS: {
  key: keyof Operation['settings'];
  label: string;
  unit: string;
  step: number;
  min: number;
}[] = [
  { key: 'toolDiameter', label: 'Tool Diameter', unit: 'mm', step: 0.1, min: 0.1 },
  { key: 'feedRate', label: 'Feed Rate', unit: 'mm/min', step: 50, min: 1 },
  { key: 'plungeRate', label: 'Plunge Rate', unit: 'mm/min', step: 25, min: 1 },
  { key: 'stepDown', label: 'Step Down', unit: 'mm', step: 0.1, min: 0.05 },
  { key: 'stepover', label: 'Stepover', unit: '%', step: 5, min: 1 },
  { key: 'spindleSpeed', label: 'Spindle Speed', unit: 'RPM', step: 500, min: 100 },
  { key: 'clearance', label: 'Clearance', unit: 'mm', step: 1, min: 0 },
  { key: 'depth', label: 'Cut Depth', unit: 'mm', step: 0.5, min: 0.1 },
];

const OUTLINE_FIELDS: typeof BASE_FIELDS = [
  { key: 'radialOffset', label: 'Additional Offset', unit: 'mm', step: 0.1, min: 0 },
];

const ADAPTIVE_FIELDS: typeof BASE_FIELDS = [
  { key: 'radialOffset', label: 'Additional Offset', unit: 'mm', step: 0.1, min: 0 },
  { key: 'channelWidthMultiple', label: 'Channel Width', unit: '× tool ⌀', step: 0.25, min: 1.25 },
  { key: 'trochoidRadius', label: 'Trochoid Radius', unit: 'mm', step: 0.5, min: 0 },
  { key: 'helixRadius', label: 'Helix Radius', unit: 'mm', step: 0.5, min: 0 },
  { key: 'helixPitch', label: 'Helix Pitch', unit: 'mm', step: 0.5, min: 0.1 },
];

function clampSetting(key: keyof Operation['settings'], value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (key === 'stepDown') return Math.max(value, 0.05);
  if (key === 'channelWidthMultiple') return Math.max(value, 1.25);
  if (key === 'toolDiameter') return Math.max(value, 0.1);
  return Math.max(value, 0);
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
      <div className="settings-grid">
        {fields.map(({ key, label, unit, step, min }) => (
          <div className="setting-row" key={key}>
            <label>
              {label} <span className="unit">({unit})</span>
            </label>
            <input
              type="number"
              value={operation.settings[key]}
              min={min}
              step={step}
              onChange={(e) =>
                updateOperationSettings(operation.id, {
                  [key]: clampSetting(key, parseFloat(e.target.value)),
                })
              }
            />
          </div>
        ))}
      </div>
      {(operation.type === 'outline' || operation.type === 'adaptive-outline') && (
        <p className="settings-hint">
          Toolpath runs at tool radius + additional offset from the part outline
          {operation.type === 'adaptive-outline' &&
            '. Channel width is a multiple of tool diameter (min 1.25×). Trochoidal path advances around the outline with circular loops clearing the slot.'}
        </p>
      )}
          {operation.type === 'adaptive-outline' &&
            (operation.settings.trochoidRadius === 0 || operation.settings.helixRadius === 0) && (
              <p className="settings-hint">
                Helix/trochoid radius 0 = auto from tool diameter and channel width. Entry point is
                set separately in stock.
              </p>
            )}
          {(operation.type === 'drill' || operation.type === 'helix') && (
            <p className="settings-hint">
              Click holes to add/remove. Multiple holes are drilled in selection order with rapid
              moves between them.
            </p>
          )}
    </div>
  );
}
