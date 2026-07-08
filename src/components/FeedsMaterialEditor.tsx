import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MATERIAL_PROFILES } from '../lib/feedsSpeedsCalculator';
import {
  createFeedsMaterialRow,
  normalizeFeedsMaterialRows,
  type FeedsMaterialLibrary,
  type FeedsMaterialRow,
  type StoredMaterialProfile,
} from '../lib/feedsMaterialProfiles';

interface FeedsMaterialEditorProps {
  open: boolean;
  materialRows: FeedsMaterialLibrary;
  onSave: (rows: FeedsMaterialLibrary) => void;
  onCancel: () => void;
}

type NumericField = Exclude<keyof StoredMaterialProfile, 'millingNote' | 'recommendedMilling'>;

const COLUMNS: {
  key: NumericField | 'recommendedMilling' | 'millingNote';
  label: string;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  type: 'number' | 'select' | 'note';
}[] = [
  { key: 'chipLoad', label: 'Chip load', unit: 'mm/tooth', step: 0.001, min: 0.001, type: 'number' },
  { key: 'stepoverPercentage', label: 'Stepover', unit: '%', step: 1, min: 1, max: 100, type: 'number' },
  { key: 'rampAngle', label: 'Ramp angle', unit: '°', step: 0.1, min: 0.1, type: 'number' },
  { key: 'plungeRatio', label: 'Plunge ratio', unit: '× cut', step: 0.05, min: 0.05, max: 1, type: 'number' },
  { key: 'adaptiveDocMaxRatio', label: 'Adaptive max DOC', unit: '× Ø', step: 0.05, type: 'number' },
  { key: 'pocketDocMaxRatio', label: 'Pocket max DOC', unit: '× Ø', step: 0.05, type: 'number' },
  {
    key: 'finishAllowancePercent',
    label: 'Finish allowance',
    unit: '% Ø',
    step: 0.1,
    min: 0.5,
    max: 50,
    type: 'number',
  },
  { key: 'recommendedMilling', label: 'Cut direction', type: 'select' },
  { key: 'millingNote', label: 'Milling note', type: 'note' },
];

function updateDraftRow(
  draft: FeedsMaterialLibrary,
  rowId: string,
  patch: Partial<Pick<FeedsMaterialRow, 'name'>> | { profile: Partial<StoredMaterialProfile> }
): FeedsMaterialLibrary {
  return draft.map((row) => {
    if (row.id !== rowId) return row;
    if ('profile' in patch) {
      return { ...row, profile: { ...row.profile, ...patch.profile } };
    }
    return { ...row, ...patch };
  });
}

interface NotePopoutState {
  rowId: string;
  materialName: string;
}

export function FeedsMaterialEditor({
  open,
  materialRows,
  onSave,
  onCancel,
}: FeedsMaterialEditorProps) {
  const [draft, setDraft] = useState<FeedsMaterialLibrary>(materialRows);
  const [notePopout, setNotePopout] = useState<NotePopoutState | null>(null);
  const [notePopoutDraft, setNotePopoutDraft] = useState('');

  useEffect(() => {
    if (open) {
      setDraft(materialRows);
      setNotePopout(null);
    }
  }, [open, materialRows]);

  if (!open) return null;

  const handleSave = () => {
    onSave(normalizeFeedsMaterialRows(draft, MATERIAL_PROFILES));
  };

  const handleAddRow = () => {
    setDraft((prev) => [...prev, createFeedsMaterialRow(prev)]);
  };

  const handleDeleteRow = (rowId: string) => {
    setDraft((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((row) => row.id !== rowId);
    });
  };

  const openNotePopout = (row: FeedsMaterialRow) => {
    setNotePopout({ rowId: row.id, materialName: row.name });
    setNotePopoutDraft(row.profile.millingNote);
  };

  const saveNotePopout = () => {
    if (!notePopout) return;
    setDraft((prev) =>
      updateDraftRow(prev, notePopout.rowId, { profile: { millingNote: notePopoutDraft } })
    );
    setNotePopout(null);
  };

  return createPortal(
    <div className="feeds-material-editor-overlay" role="presentation" onClick={onCancel}>
      <div
        className="feeds-material-editor-dialog feeds-material-editor-dialog--spreadsheet"
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
          <div className="feeds-material-editor-table-wrap">
            <table className="feeds-material-editor-table">
              <thead>
                <tr>
                  <th className="feeds-material-editor-th feeds-material-editor-th--sticky-col">Material</th>
                  {COLUMNS.map((col) => (
                    <th key={col.key} className="feeds-material-editor-th">
                      <span className="feeds-material-editor-th-label">{col.label}</span>
                      {col.unit ? (
                        <span className="feeds-material-editor-th-unit">({col.unit})</span>
                      ) : null}
                    </th>
                  ))}
                  <th className="feeds-material-editor-th feeds-material-editor-th--actions" aria-label="Row actions" />
                </tr>
              </thead>
              <tbody>
                {draft.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="feeds-material-editor-row-label feeds-material-editor-th--sticky-col">
                      <input
                        type="text"
                        className="feeds-material-editor-name-input"
                        value={row.name}
                        onChange={(e) =>
                          setDraft((prev) => updateDraftRow(prev, row.id, { name: e.target.value }))
                        }
                        aria-label={`Material name for ${row.name}`}
                      />
                    </th>
                    {COLUMNS.map((col) => {
                      if (col.type === 'select' && col.key === 'recommendedMilling') {
                        return (
                          <td key={col.key} className="feeds-material-editor-td">
                            <select
                              value={row.profile.recommendedMilling}
                              onChange={(e) =>
                                setDraft((prev) =>
                                  updateDraftRow(prev, row.id, {
                                    profile: {
                                      recommendedMilling: e.target.value as StoredMaterialProfile['recommendedMilling'],
                                    },
                                  })
                                )
                              }
                            >
                              <option value="climb">Climb</option>
                              <option value="conventional">Conventional</option>
                            </select>
                          </td>
                        );
                      }

                      if (col.type === 'note' && col.key === 'millingNote') {
                        return (
                          <td key={col.key} className="feeds-material-editor-td">
                            <div className="feeds-material-editor-note-cell">
                              <span
                                className="feeds-material-editor-note-preview"
                                title={row.profile.millingNote || undefined}
                              >
                                {row.profile.millingNote || '—'}
                              </span>
                              <button
                                type="button"
                                className="btn btn-small btn-secondary feeds-material-editor-note-edit-btn"
                                onClick={() => openNotePopout(row)}
                                aria-label={`Edit milling note for ${row.name}`}
                              >
                                Edit
                              </button>
                            </div>
                          </td>
                        );
                      }

                      const numericKey = col.key as NumericField;
                      const numericValue = row.profile[numericKey] as number;
                      return (
                        <td key={col.key} className="feeds-material-editor-td">
                          <input
                            type="number"
                            value={numericValue}
                            min={col.min}
                            max={col.max}
                            step={col.step}
                            onChange={(e) =>
                              setDraft((prev) =>
                                updateDraftRow(prev, row.id, {
                                  profile: {
                                    [numericKey]: parseFloat(e.target.value) || numericValue,
                                  },
                                })
                              )
                            }
                          />
                        </td>
                      );
                    })}
                    <td className="feeds-material-editor-td feeds-material-editor-td--actions">
                      <button
                        type="button"
                        className="btn btn-small btn-secondary feeds-material-editor-delete-btn"
                        onClick={() => handleDeleteRow(row.id)}
                        disabled={draft.length <= 1}
                        aria-label={`Delete ${row.name}`}
                        title={draft.length <= 1 ? 'At least one material is required' : `Delete ${row.name}`}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {notePopout ? (
          <div
            className="feeds-material-editor-note-popout-overlay"
            role="presentation"
            onClick={() => setNotePopout(null)}
          >
            <div
              className="feeds-material-editor-note-popout"
              role="dialog"
              aria-modal="true"
              aria-labelledby="feeds-material-note-popout-title"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="feeds-material-editor-note-popout-header">
                <h3 id="feeds-material-note-popout-title">
                  Milling note — {notePopout.materialName}
                </h3>
              </header>
              <textarea
                className="feeds-material-editor-note-popout-textarea"
                rows={8}
                value={notePopoutDraft}
                onChange={(e) => setNotePopoutDraft(e.target.value)}
                autoFocus
              />
              <footer className="feeds-material-editor-note-popout-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setNotePopout(null)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={saveNotePopout}>
                  Done
                </button>
              </footer>
            </div>
          </div>
        ) : null}

        <footer className="feeds-material-editor-footer">
          <button type="button" className="btn btn-secondary" onClick={handleAddRow}>
            Add material
          </button>
          <div className="feeds-material-editor-footer-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave}>
              Save changes
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
