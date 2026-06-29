import { useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { buildSimulationTimeline, sampleSimulationTimeline } from '../../lib/toolpathSimulation';

export function ToolSimulationControls() {
  const stlUrl = useAppStore((s) => s.stlUrl);
  const toolpaths = useAppStore((s) => s.toolpaths);
  const operations = useAppStore((s) => s.operations);
  const simulationDistance = useAppStore((s) => s.simulationDistance);
  const simulationPlaying = useAppStore((s) => s.simulationPlaying);
  const simulationSpeed = useAppStore((s) => s.simulationSpeed);
  const setSimulationDistance = useAppStore((s) => s.setSimulationDistance);
  const setSimulationPlaying = useAppStore((s) => s.setSimulationPlaying);
  const setSimulationSpeed = useAppStore((s) => s.setSimulationSpeed);
  const resetSimulation = useAppStore((s) => s.resetSimulation);

  const visiblePaths = useMemo(() => {
    const visibleIds = new Set(operations.filter((o) => o.visible).map((o) => o.id));
    return toolpaths.filter((tp) => visibleIds.has(tp.operationId));
  }, [toolpaths, operations]);

  const timeline = useMemo(() => buildSimulationTimeline(visiblePaths), [visiblePaths]);
  const sample = useMemo(
    () => sampleSimulationTimeline(timeline, simulationDistance),
    [timeline, simulationDistance]
  );

  if (!stlUrl || timeline.samples.length === 0) return null;

  const progress =
    timeline.totalDistance > 0 ? (simulationDistance / timeline.totalDistance) * 100 : 0;

  return (
    <div className="tool-simulation-controls">
      <div className="tool-simulation-header">
        <span className="tool-simulation-title">Tool Preview</span>
        <span className="tool-simulation-mode">{sample?.rapid ? 'Rapid' : 'Cutting'}</span>
      </div>
      <div className="tool-simulation-buttons">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => setSimulationPlaying(!simulationPlaying)}
        >
          {simulationPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn btn-small btn-secondary" onClick={resetSimulation}>
          Reset
        </button>
        <label className="tool-simulation-speed">
          Speed
          <select
            value={simulationSpeed}
            onChange={(e) => setSimulationSpeed(parseFloat(e.target.value))}
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
            <option value={8}>8×</option>
          </select>
        </label>
      </div>
      <input
        type="range"
        className="tool-simulation-scrubber"
        min={0}
        max={100}
        step={0.05}
        value={progress}
        onChange={(e) => {
          setSimulationPlaying(false);
          const t = parseFloat(e.target.value) / 100;
          setSimulationDistance(t * timeline.totalDistance);
        }}
      />
      <div className="tool-simulation-meta">
        <span>{simulationDistance.toFixed(1)} mm</span>
        <span>{progress.toFixed(0)}%</span>
      </div>
    </div>
  );
}
