import { useMemo, useState } from 'react';
import {
  calculateFeedsSpeeds,
  formatFactor,
  formatFeed,
  getMaterialProfile,
} from '../lib/feedsSpeedsCalculator';
import { useSettingsStore } from '../store/useSettingsStore';
import { FeedsMaterialEditor } from './FeedsMaterialEditor';

interface FeedsCalculatorSidebarProps {
  open: boolean;
  onToggle: () => void;
}

function CalculatorIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8" />
      <path d="M8 10h2" />
      <path d="M12 10h2" />
      <path d="M16 10h0" />
      <path d="M8 14h2" />
      <path d="M12 14h4" />
      <path d="M8 18h8" />
    </svg>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={collapsed ? 'feeds-calc-chevron feeds-calc-chevron--collapsed' : 'feeds-calc-chevron'}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function FeedsCalculatorSidebar({ open, onToggle }: FeedsCalculatorSidebarProps) {
  const feedsCalculator = useSettingsStore((s) => s.feedsCalculator);
  const feedsMaterialRows = useSettingsStore((s) => s.feedsMaterialRows);
  const setFeedsCalculatorMaterial = useSettingsStore((s) => s.setFeedsCalculatorMaterial);
  const updateFeedsCalculator = useSettingsStore((s) => s.updateFeedsCalculator);
  const setFeedsMaterialRows = useSettingsStore((s) => s.setFeedsMaterialRows);
  const [materialEditorOpen, setMaterialEditorOpen] = useState(false);

  const { materialId, toolDiameterMm, fluteCount, rpm, chipLoadMm, stepoverPct } = feedsCalculator;
  const profile = getMaterialProfile(materialId, feedsMaterialRows);

  const results = useMemo(
    () =>
      calculateFeedsSpeeds(
        {
          materialId,
          toolDiameterMm,
          fluteCount,
          rpm,
          chipLoadMm,
          stepoverPct,
        },
        feedsMaterialRows
      ),
    [materialId, toolDiameterMm, fluteCount, rpm, chipLoadMm, stepoverPct, feedsMaterialRows]
  );

  return (
    <aside
      className={`feeds-calculator-sidebar ${open ? 'feeds-calculator-sidebar--open' : 'feeds-calculator-sidebar--collapsed'}`}
      aria-label="CNC feeds and speeds calculator"
    >
      <button
        type="button"
        className="feeds-calculator-toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="feeds-calculator-panel"
        title={open ? 'Collapse feeds & speeds calculator' : 'Open feeds & speeds calculator'}
      >
        <CalculatorIcon />
        <span className="feeds-calculator-toggle-label">F&amp;S</span>
        <ChevronIcon collapsed={open} />
      </button>

      <div
        id="feeds-calculator-panel"
        className="feeds-calculator-panel"
        aria-hidden={!open}
      >
        <header className="feeds-calculator-header">
          <div className="feeds-calculator-header-copy">
            <h2 className="feeds-calculator-title">Feeds &amp; Speeds</h2>
            <p className="feeds-calculator-subtitle">Reference calculator — verify on scrap first.</p>
          </div>
          <button
            type="button"
            className="btn btn-small btn-secondary feeds-calculator-edit-btn"
            onClick={() => setMaterialEditorOpen(true)}
            title="Edit stored material profiles"
          >
            Edit
          </button>
        </header>

        <div className="feeds-calculator-body">
          <section className="feeds-calculator-section">
            <h3 className="feeds-calculator-section-title">Inputs</h3>
            <div className="feeds-calculator-grid">
              <div className="setting-row feeds-calculator-row--full">
                <label htmlFor="fsc-material">Material</label>
                <select
                  id="fsc-material"
                  value={materialId}
                  onChange={(e) => setFeedsCalculatorMaterial(e.target.value)}
                >
                  {feedsMaterialRows.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="setting-row">
                <label htmlFor="fsc-tool-d">
                  Tool Ø <span className="unit">(mm)</span>
                </label>
                <input
                  id="fsc-tool-d"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={toolDiameterMm}
                  onChange={(e) =>
                    updateFeedsCalculator({ toolDiameterMm: parseFloat(e.target.value) || 0.1 })
                  }
                />
              </div>

              <div className="setting-row">
                <label htmlFor="fsc-flutes">Flutes</label>
                <input
                  id="fsc-flutes"
                  type="number"
                  min={1}
                  max={8}
                  step={1}
                  value={fluteCount}
                  onChange={(e) =>
                    updateFeedsCalculator({
                      fluteCount: Math.max(1, parseInt(e.target.value, 10) || 1),
                    })
                  }
                />
              </div>

              <div className="setting-row">
                <label htmlFor="fsc-rpm">Spindle RPM</label>
                <input
                  id="fsc-rpm"
                  type="number"
                  min={0}
                  step={500}
                  value={rpm}
                  onChange={(e) => updateFeedsCalculator({ rpm: Math.max(0, parseFloat(e.target.value) || 0) })}
                />
              </div>

              <div className="setting-row">
                <label htmlFor="fsc-chip">
                  Chip load <span className="unit">(mm/tooth)</span>
                </label>
                <input
                  id="fsc-chip"
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={chipLoadMm}
                  onChange={(e) =>
                    updateFeedsCalculator({ chipLoadMm: parseFloat(e.target.value) || profile.chipLoad })
                  }
                />
              </div>

              <div className="setting-row feeds-calculator-row--full">
                <label htmlFor="fsc-stepover">
                  Planned stepover <span className="unit">(% of tool Ø)</span>
                </label>
                <input
                  id="fsc-stepover"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={stepoverPct}
                  onChange={(e) =>
                    updateFeedsCalculator({
                      stepoverPct: Math.max(1, parseFloat(e.target.value) || profile.stepoverPercentage),
                    })
                  }
                />
                <span className="feeds-calculator-hint">
                  Material default: {results.stepoverRangeLabel}
                </span>
              </div>
            </div>

            {results.lowRpmWarning && (
              <p className="feeds-calculator-warning" role="status">
                RPM below 10,000 — verify torque, chipload, and surface speed for this material.
              </p>
            )}
          </section>

          <section className="feeds-calculator-section feeds-calculator-outputs">
            <h3 className="feeds-calculator-section-title">Outputs</h3>
            <dl className="feeds-calculator-output-list">
              <div className="feeds-calculator-output-row feeds-calculator-output-row--primary">
                <dt>Cutting feed</dt>
                <dd>{formatFeed(results.cuttingFeedMmMin)}</dd>
              </div>
              <div className="feeds-calculator-output-row">
                <dt>Chip thinning factor</dt>
                <dd>{formatFactor(results.chipThinningFactor)}</dd>
              </div>
              <div className="feeds-calculator-output-row feeds-calculator-output-row--accent">
                <dt>Adjusted feed</dt>
                <dd>{formatFeed(results.adjustedFeedMmMin)}</dd>
              </div>
              <div className="feeds-calculator-output-row feeds-calculator-output-row--direction">
                <dt>Cut direction</dt>
                <dd>{results.millingDirectionLabel}</dd>
              </div>
              <div className="feeds-calculator-output-row">
                <dt>Stepover @ {stepoverPct.toFixed(0)}%</dt>
                <dd>{results.stepoverMm.toFixed(2)} mm</dd>
              </div>
              <div className="feeds-calculator-output-row">
                <dt>Material stepover</dt>
                <dd>{results.stepoverRangeLabel}</dd>
              </div>
              <div className="feeds-calculator-output-row">
                <dt>Adaptive max DOC</dt>
                <dd>{results.adaptiveDocLabel}</dd>
              </div>
              <div className="feeds-calculator-output-row">
                <dt>Pocket max DOC</dt>
                <dd>{results.pocketDocLabel}</dd>
              </div>
              <div className="feeds-calculator-output-row">
                <dt>Ramp angle</dt>
                <dd>{results.helixRampLabel}</dd>
              </div>
              <div className="feeds-calculator-output-row">
                <dt>Plunge feed</dt>
                <dd>{results.plungeFeedLabel}</dd>
              </div>
              <div className="feeds-calculator-output-row">
                <dt>Finish allowance</dt>
                <dd>{results.finishAllowanceLabel}</dd>
              </div>
            </dl>
            {results.millingNote ? (
              <div className="feeds-calculator-milling-note">
                <h4 className="feeds-calculator-milling-note-title">Milling note</h4>
                <p className="feeds-calculator-milling-note-body">{results.millingNote}</p>
              </div>
            ) : null}
            <p className="feeds-calculator-footnote">
              Adjusted feed applies chip thinning for {stepoverPct.toFixed(0)}% radial
              engagement ({results.stepoverMm.toFixed(2)} mm). Use adjusted value when stepover is
              below ~50% tool Ø.
            </p>
          </section>
        </div>
      </div>

      <FeedsMaterialEditor
        open={materialEditorOpen}
        materialRows={feedsMaterialRows}
        onSave={(rows) => {
          setFeedsMaterialRows(rows);
          setMaterialEditorOpen(false);
        }}
        onCancel={() => setMaterialEditorOpen(false)}
      />
    </aside>
  );
}
