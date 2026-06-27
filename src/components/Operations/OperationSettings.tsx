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
  { key: 'stepDown', label: 'Step Down', unit: 'mm', step: 0.5, min: 0.1 },
  { key: 'stepover', label: 'Stepover', unit: '%', step: 5, min: 1 },
  { key: 'spindleSpeed', label: 'Spindle Speed', unit: 'RPM', step: 500, min: 100 },
  { key: 'clearance', label: 'Clearance', unit: 'mm', step: 1, min: 0 },
  { key: 'depth', label: 'Cut Depth', unit: 'mm', step: 0.5, min: 0.1 },
];

const ADAPTIVE_FIELDS: typeof BASE_FIELDS = [
  { key: 'channelClearance', label: 'Channel Clearance', unit: 'mm', step: 0.5, min: 0 },
  { key: 'trochoidRadius', label: 'Trochoid Radius', unit: 'mm', step: 0.5, min: 0 },
  { key: 'helixRadius', label: 'Helix Radius', unit: 'mm', step: 0.5, min: 0 },
  { key: 'helixPitch', label: 'Helix Pitch', unit: 'mm', step: 0.5, min: 0.1 },
];

export function OperationSettings({ operation }: OperationSettingsProps) {
  const updateOperationSettings = useAppStore((s) => s.updateOperationSettings);
  const updateOperation = useAppStore((s) => s.updateOperation);

  const fields =
    operation.type === 'adaptive-outline'
      ? [...BASE_FIELDS, ...ADAPTIVE_FIELDS]
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
                  [key]: parseFloat(e.target.value) || 0,
                })
              }
            />
          </div>
        ))}
      </div>
      {(operation.type === 'adaptive-outline' ||
        operation.settings.trochoidRadius === 0 ||
        operation.settings.helixRadius === 0) && (
        <p className="settings-hint">
          {operation.type === 'adaptive-outline' &&
            'Helix/trochoid radius 0 = auto from tool diameter. Entry point is set separately in stock.'}
        </p>
      )}
    </div>
  );
}
