import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MATERIAL_PROFILES, type MaterialId } from '../lib/feedsSpeedsCalculator';
import {
  MATERIAL_IDS,
  normalizeStoredMaterialProfiles,
  type StoredMaterialProfile,
  type StoredMaterialProfiles,
} from '../lib/feedsMaterialProfiles';

interface FeedsMaterialEditorProps {
  open: boolean;
  storedProfiles: StoredMaterialProfiles;
  onSave: (profiles: StoredMaterialProfiles) => void;
  onCancel: () => void;
}

type NumericField = Exclude<keyof StoredMaterialProfile, 'finishAllowanceNote' | 'millingNote' | 'recommendedMilling' | 'isHard'>;

const NUMERIC_FIELDS: { key: NumericField; label: string; unit: string; step: number; min?: number; max?: number }[] = [
  { key: 'chipLoad', label: 'Chip load', unit: 'mm/tooth', step: 0.001, min: 0.001 },
  { key: 'stepoverPercentage', label: 'Stepover', unit: '%', step: 1, min: 1, max: 100 },
  { key: 'rampAngle', label: 'Ramp angle', unit: '°', step: 0.1, min: 0.1 },
  { key: 'plungeRatio', label: 'Plunge ratio', unit: '× cut feed', step: 0.05, min: 0.05, max: 1 },
  { key: 'adaptiveDocMinRatio', label: 'Adaptive DOC min', unit: '× tool Ø', step: 0.05 },
  { key: 'adaptiveDocMaxRatio', label: 'Adaptive DOC max', unit: '× tool Ø', step: 0.05 },
  { key: 'pocketDocMinRatio', label: 'Pocket DOC min', unit: '× tool Ø', step: 0.05 },
  { key: 'pocketDocMaxRatio', label: 'Pocket DOC max', unit: '× tool Ø', step: 0.05 },
  { key: 'finishAllowancePercent', label: 'Finish allowance', unit: '% of tool Ø', step: 0.1, min: 0.5, max: 50 },
];

function updateDraftProfile(
  draft: StoredMaterialProfiles,
  id: MaterialId,
  patch: Partial<StoredMaterialProfile>
): StoredMaterialProfiles {
  return {
    ...draft,
    [id]: { ...draft[id], ...patch },
  };
}

export function FeedsMaterialEditor({
  open,
  storedProfiles,
  onSave,
  onCancel,
}: FeedsMaterialEditorProps) {
  const [draft, setDraft] = useState<StoredMaterialProfiles>(storedProfiles);

  useEffect(() => {
    if (open) {
      setDraft(storedProfiles);
    }
  }, [open, storedProfiles]);

  if (!open) return null;

  const handleSave = () => {
    onSave(normalizeStoredMaterialProfiles(draft, MATERIAL_PROFILES));
  };

  return createPortal(
    <div className="feeds-material-editor-overlay" role="presentation" onClick={onCancel}>
      <div
        className="feeds-material-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feeds-material-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="feeds-material-editor-header">
          <div>
            <h2 id="feeds-material-editor-title">Edit material profiles</h2>
            <p className="feeds-material-editor-subtitle">
              Stored values feed the calculator outputs and new operation defaults.
            </p>
          </div>
          <button type="button" className="btn-icon" onClick={onCancel} aria-label="Close editor">
            ✕
          </button>
        </header>

        <div className="feeds-material-editor-body">
          {MATERIAL_IDS.map((id) => {
            const material = MATERIAL_PROFILES.find((m) => m.id === id);
            const row = draft[id];
            if (!material || !row) return null;

            return (
              <section className="feeds-material-editor-card" key={id}>
                <h3 className="feeds-material-editor-card-title">{material.name}</h3>
                <div className="feeds-material-editor-grid">
                  {NUMERIC_FIELDS.map(({ key, label, unit, step, min, max }) => (
                    <div className="setting-row" key={key}>
                      <label>
                        {label} <span className="unit">({unit})</span>
                      </label>
                      <input
                        type="number"
                        value={row[key]}
                        min={min}
                        max={max}
                        step={step}
                        onChange={(e) =>
                          setDraft((prev) =>
                            updateDraftProfile(prev, id, {
                              [key]: parseFloat(e.target.value) || row[key],
                            })
                          )
                        }
                      />
                    </div>
                  ))}
                  <div className="setting-row feeds-material-editor-row--full">
                    <label>Cut direction</label>
                    <select
                      value={row.recommendedMilling}
                      onChange={(e) =>
                        setDraft((prev) =>
                          updateDraftProfile(prev, id, {
                            recommendedMilling: e.target.value as StoredMaterialProfile['recommendedMilling'],
                          })
                        )
                      }
                    >
                      <option value="climb">Climb milling</option>
                      <option value="conventional">Conventional milling</option>
                    </select>
                  </div>
                  <div className="setting-row feeds-material-editor-row--full">
                    <label>Finish allowance note</label>
                    <textarea
                      className="feeds-material-editor-textarea"
                      rows={2}
                      value={row.finishAllowanceNote}
                      onChange={(e) =>
                        setDraft((prev) =>
                          updateDraftProfile(prev, id, { finishAllowanceNote: e.target.value })
                        )
                      }
                    />
                  </div>
                  <div className="setting-row feeds-material-editor-row--full">
                    <label>Milling note</label>
                    <textarea
                      className="feeds-material-editor-textarea"
                      rows={2}
                      value={row.millingNote}
                      onChange={(e) =>
                        setDraft((prev) =>
                          updateDraftProfile(prev, id, { millingNote: e.target.value })
                        )
                      }
                    />
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <footer className="feeds-material-editor-footer">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            Save changes
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
