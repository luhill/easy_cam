import type { Operation } from '../../types/operations';
import {
  isAdaptiveOutlineOperation,
  isOutlineOperation,
  type OperationDefaults,
} from '../../types/operations';
import { useAppStore } from '../../store/useAppStore';
import { SETTING_LIMITS, clampSettingValue } from '../../lib/settingLimits';
import { HintTooltip, LabelWithHint } from '../HintTooltip';
import type { ReactNode } from 'react';

interface OperationSettingsProps {
  operation: Operation;
}

type NumericSettingKey = Exclude<
  keyof Operation['settings'],
  | 'finishingPass'
  | 'climbMilling'
  | 'adaptiveMode'
  | 'outlineEntryType'
  | 'chipClearBeforeFinal'
>;

type FieldDef = {
  key: NumericSettingKey;
  label: string;
  unit: string;
  step: number;
};

const BASE_FIELDS: FieldDef[] = [
  { key: 'toolDiameter', label: 'Tool Diameter', unit: 'mm', step: 0.1 },
  { key: 'feedRate', label: 'Feed Rate', unit: 'mm/min', step: 50 },
  { key: 'plungeRate', label: 'Plunge Rate', unit: 'mm/min', step: 25 },
  { key: 'stepDown', label: 'Step Down', unit: 'mm', step: 0.1 },
  { key: 'stepover', label: 'Stepover', unit: '%', step: 1 },
  { key: 'spindleSpeed', label: 'Spindle Speed', unit: 'RPM', step: 500 },
  { key: 'depthOffset', label: 'Depth Offset', unit: 'mm', step: 0.1 },
];

const OUTLINE_FEED_FIELDS: FieldDef[] = [
  { key: 'feedRate', label: 'Feed Rate', unit: 'mm/min', step: 50 },
  { key: 'adjustedFeedRate', label: 'Adjusted Feed', unit: 'mm/min', step: 50 },
];

const OUTLINE_BASE_FIELDS: FieldDef[] = [
  { key: 'toolDiameter', label: 'Tool Diameter', unit: 'mm', step: 0.1 },
  { key: 'plungeRate', label: 'Plunge Rate', unit: 'mm/min', step: 25 },
  { key: 'stepDown', label: 'Step Down', unit: 'mm', step: 0.1 },
  { key: 'stepover', label: 'Stepover', unit: '%', step: 1 },
  { key: 'spindleSpeed', label: 'Spindle Speed', unit: 'RPM', step: 500 },
  { key: 'depthOffset', label: 'Depth Offset', unit: 'mm', step: 0.1 },
];

const DRILL_FIELDS: FieldDef[] = [
  { key: 'toolDiameter', label: 'Tool Diameter', unit: 'mm', step: 0.1 },
  { key: 'plungeRate', label: 'Plunge Rate', unit: 'mm/min', step: 25 },
  { key: 'stepDown', label: 'Peck Depth', unit: 'mm', step: 0.1 },
  { key: 'spindleSpeed', label: 'Spindle Speed', unit: 'RPM', step: 500 },
  { key: 'depthOffset', label: 'Depth Offset', unit: 'mm', step: 0.1 },
  { key: 'chipClearHeight', label: 'Chip Clear Height', unit: 'mm above hole', step: 0.5 },
  { key: 'peckFullRetractEvery', label: 'Full Retract Every', unit: 'pecks (0=off)', step: 1 },
];

const POCKET_FIELDS: FieldDef[] = [
  { key: 'radialOffset', label: 'Additional Offset', unit: 'mm', step: 0.1 },
];

const HELIX_BASE_FIELDS: FieldDef[] = [
  { key: 'toolDiameter', label: 'Tool Diameter', unit: 'mm', step: 0.1 },
  { key: 'plungeRate', label: 'Plunge Rate', unit: 'mm/min', step: 25 },
  { key: 'stepover', label: 'Stepover', unit: '%', step: 1 },
  { key: 'spindleSpeed', label: 'Spindle Speed', unit: 'RPM', step: 500 },
  { key: 'depthOffset', label: 'Z Offset', unit: 'mm', step: 0.1 },
];

const OUTLINE_COMMON_FIELDS: FieldDef[] = [
  { key: 'radialOffset', label: 'Additional Offset', unit: 'mm', step: 0.1 },
  { key: 'zStartOffset', label: 'Z Start Offset', unit: 'mm', step: 0.1 },
];

const LINEAR_ENTRY_FIELDS: FieldDef[] = [
  { key: 'rampAngleDeg', label: 'Ramp Angle', unit: '°', step: 0.1 },
  { key: 'rampLengthToolDiameters', label: 'Ramp Length', unit: '× tool ⌀', step: 0.5 },
];

const HELIX_ENTRY_FIELDS: FieldDef[] = [
  { key: 'rampAngleDeg', label: 'Ramp Angle', unit: '°', step: 0.1 },
  { key: 'boreDiameterPercent', label: 'Bore Diameter', unit: '% of tool ⌀', step: 5 },
  { key: 'boreTaperAngleDeg', label: 'Bore Taper', unit: '°', step: 0.5 },
  { key: 'helixFeedRate', label: 'Helix Feed Rate', unit: 'mm/min', step: 25 },
];

const ADAPTIVE_FIELDS: FieldDef[] = [
  { key: 'slotWidthPercent', label: 'Slot Width', unit: '% of tool ⌀', step: 5 },
  { key: 'liftAmount', label: 'Pass Lift', unit: 'mm', step: 0.1 },
  { key: 'boreDiameterPercent', label: 'Bore Diameter', unit: '% of tool ⌀', step: 5 },
  { key: 'rampAngleDeg', label: 'Ramp Angle', unit: '°', step: 0.1 },
  { key: 'boreTaperAngleDeg', label: 'Bore Taper', unit: '°', step: 0.5 },
  { key: 'helixFeedRate', label: 'Helix Feed Rate', unit: 'mm/min', step: 25 },
];

const FINISHING_FIELDS: FieldDef[] = [
  {
    key: 'finishingStockPercent',
    label: 'Finish Allowance',
    unit: '% of tool ⌀',
    step: 0.5,
  },
  {
    key: 'finishPassCount',
    label: 'Finish Passes',
    unit: 'count',
    step: 1,
  },
];

const HELIX_OP_FIELDS: FieldDef[] = [
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
  if (operation.type === 'pocket' && key === 'stepover') {
    return operation.settings.adaptiveMode ? 'Concentric Stepover' : fallback;
  }
  return fallback;
}

function fieldHint(operation: Operation, key: NumericSettingKey): string | undefined {
  if (key === 'depthOffset' || key === 'stepDown') {
    if (isOutlineOperation(operation)) {
      return 'Passes run from the selected edge-loop top down. Depth offset is measured from the loop bottom (+ stops short of it).';
    }
    if (operation.type === 'helix') {
      return DEPTH_HINT;
    }
    if (operation.type === 'drill') {
      if (key === 'depthOffset') {
        return 'Depth offset from the hole floor (+ stops short of the floor). Hole depth comes from the selected feature when available.';
      }
      return 'Maximum peck depth per plunge before chip clearing.';
    }
  }
  if (key === 'chipClearHeight') {
    return 'Retract this far above the hole opening between pecks to clear chips. Set 0 to retract fully to safe height each peck.';
  }
  if (key === 'peckFullRetractEvery') {
    return 'Every N pecks, retract all the way to safe height. 0 disables periodic full retracts.';
  }
  if (key === 'finishPassCount') {
    return 'Number of final outline passes at the same wall offset (spring passes).';
  }
  if (key === 'feedRate' && isOutlineOperation(operation)) {
    return 'Standard cutting feed for full-engagement outline / roughing contour loops.';
  }
  if (key === 'adjustedFeedRate') {
    return 'Used for adaptive trochoidal clearing, the chip-clear pass, and final outline pass(es).';
  }
  if (key === 'rampAngleDeg' && isOutlineOperation(operation)) {
    if (operation.settings.adaptiveMode) {
      return 'Helical bore entry pitch angle for adaptive clearing.';
    }
    if (operation.settings.outlineEntryType === 'helix') {
      return 'Helical bore pitch for entry and inter-layer bores.';
    }
    return 'Linear ramp angle along the outline; forward and backward passes reach each layer depth.';
  }
  if (key === 'rampLengthToolDiameters') {
    return 'Horizontal distance per forward/backward ramp leg along the outline (each leg × tan(angle) of Z drop).';
  }
  if (key === 'finishingStockPercent') {
    return 'Radial finish allowance left on walls during roughing before the final finish pass.';
  }
  if (key === 'boreTaperAngleDeg' && operation.type === 'helix') {
    return 'Set to 0 to disable. At each pass bottom the tool spirals outward to full diameter using stepover.';
  }
  if (key === 'zStartOffset' && isOutlineOperation(operation)) {
    return 'Entry ramp, helix bore, or straight plunge begins at min(global safe height, this offset above the edge-loop top).';
  }
  if (key === 'zStartOffset' && operation.type === 'helix') {
    return 'Helix ramp begins at the lower of this offset above stock top or the global safe height.';
  }
  return undefined;
}

function SettingFields({
  operation,
  fields,
}: {
  operation: Operation;
  fields: FieldDef[];
}) {
  const updateOperationSettings = useAppStore((s) => s.updateOperationSettings);

  return (
    <>
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
    </>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-group">
      <div className="settings-group-title">{title}</div>
      <div className="settings-grid settings-group-grid">{children}</div>
    </div>
  );
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
  const entryType = operation.settings.outlineEntryType ?? 'linear';

  const entryTypeLabel: Record<OperationDefaults['outlineEntryType'], string> = {
    linear: 'Linear',
    helix: 'Helix',
    straight: 'Straight',
  };

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

      {operation.type === 'helix' ? (
        <>
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
          <div className="settings-grid">
            <SettingFields operation={operation} fields={[...HELIX_BASE_FIELDS, ...HELIX_OP_FIELDS]} />
          </div>
        </>
      ) : operation.type === 'drill' ? (
        <div className="settings-grid">
          <SettingFields operation={operation} fields={DRILL_FIELDS} />
        </div>
      ) : operation.type === 'pocket' ? (
        <>
          <div className="settings-grid">
            <SettingFields operation={operation} fields={[...BASE_FIELDS, ...POCKET_FIELDS]} />
          </div>
          <div className="settings-checkboxes">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={operation.settings.adaptiveMode}
                onChange={(e) =>
                  updateOperationSettings(operation.id, { adaptiveMode: e.target.checked })
                }
              />
              Adaptive pocket (concentric)
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
              Final wall finishing pass
            </label>
          </div>
          {operation.settings.finishingPass && (
            <SettingsGroup title="Finishing pass">
              <SettingFields operation={operation} fields={FINISHING_FIELDS} />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={operation.settings.chipClearBeforeFinal === true}
                  onChange={(e) =>
                    updateOperationSettings(operation.id, {
                      chipClearBeforeFinal: e.target.checked,
                    })
                  }
                />
                Chip clear pass before final (repeat at rough offset)
              </label>
            </SettingsGroup>
          )}
        </>
      ) : isOutlineOperation(operation) ? (
        <>
          <div className="settings-grid">
            <SettingFields
              operation={operation}
              fields={[...OUTLINE_FEED_FIELDS, ...OUTLINE_BASE_FIELDS, ...OUTLINE_COMMON_FIELDS]}
            />
          </div>

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

          {!adaptiveMode && (
            <div className="setting-row entry-type-row">
              <label>Entry type</label>
              <select
                value={entryType}
                onChange={(e) =>
                  updateOperationSettings(operation.id, {
                    outlineEntryType: e.target.value as OperationDefaults['outlineEntryType'],
                  })
                }
              >
                {(Object.keys(entryTypeLabel) as OperationDefaults['outlineEntryType'][]).map(
                  (value) => (
                    <option key={value} value={value}>
                      {entryTypeLabel[value]}
                    </option>
                  )
                )}
              </select>
            </div>
          )}

          {adaptiveMode && (
            <SettingsGroup title="Adaptive clearing">
              <SettingFields operation={operation} fields={ADAPTIVE_FIELDS} />
            </SettingsGroup>
          )}

          {!adaptiveMode && entryType === 'linear' && (
            <SettingsGroup title="Linear entry">
              <SettingFields operation={operation} fields={LINEAR_ENTRY_FIELDS} />
            </SettingsGroup>
          )}

          {!adaptiveMode && entryType === 'helix' && (
            <SettingsGroup title="Helix entry">
              <SettingFields operation={operation} fields={HELIX_ENTRY_FIELDS} />
            </SettingsGroup>
          )}

          {!adaptiveMode && entryType === 'straight' && (
            <SettingsGroup title="Straight entry">
              <p className="settings-group-note">
                Plunges vertically at the outline start for the first entry and between each layer.
              </p>
            </SettingsGroup>
          )}

          {operation.settings.finishingPass && (
            <SettingsGroup title="Finishing pass">
              <SettingFields operation={operation} fields={FINISHING_FIELDS} />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={operation.settings.chipClearBeforeFinal === true}
                  onChange={(e) =>
                    updateOperationSettings(operation.id, {
                      chipClearBeforeFinal: e.target.checked,
                    })
                  }
                />
                Chip clear pass before final (repeat at rough offset)
              </label>
            </SettingsGroup>
          )}
        </>
      ) : (
        <div className="settings-grid">
          <SettingFields operation={operation} fields={BASE_FIELDS} />
        </div>
      )}

      {adaptiveMode && (
        <div className="operation-settings-footer">
          <HintTooltip
            placement="top"
            text="Viewer: yellow reference = slot centerline guide; green trochoid loops = samples classified as on-spur (scaled radius). Toggle line types in the viewer overlay."
          />
        </div>
      )}
      {operation.type === 'drill' && (
        <div className="operation-settings-footer">
          <HintTooltip
            placement="top"
            text="Click holes to add/remove. Depth follows the hole floor when known. Cutting and approach moves use plunge feed; only retracts are rapid."
          />
        </div>
      )}
      {operation.type === 'helix' && (
        <div className="operation-settings-footer">
          <HintTooltip
            placement="top"
            text="Click holes to add/remove. Invalid holes (red) are skipped: hole diameter must exceed tool diameter, and taper must not collapse the helix radius before final depth."
          />
        </div>
      )}
      {operation.type === 'pocket' && (
        <div className="operation-settings-footer">
          <HintTooltip
            placement="top"
            text="Select a top face. Standard mode uses zigzag clearing; adaptive uses concentric offsets. Enable finishing for a final wall pass."
          />
        </div>
      )}
      {operation.type === 'contour' && (
        <div className="operation-settings-footer">
          <HintTooltip
            placement="top"
            text="Select an upward-facing surface. The path scans in XY while Z follows surface texture and slopes."
          />
        </div>
      )}
    </div>
  );
}
