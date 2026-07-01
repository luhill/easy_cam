import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import {
  buildSimulationTimeline,
  clampDistanceToWindow,
  previewWindowDistances,
  stepSimulationDistance,
} from '../../lib/toolpathSimulation';
import {
  clearLiveSimulationDistance,
  commitLiveSimulationDistance,
  getEffectiveSimulationDistance,
  getEffectiveSimulationWindow,
  hasLiveSimulationOverride,
  setLiveSimulationDistance,
  syncLiveSimulationDistanceFromStore,
} from '../../lib/simulationLiveBridge';
import { RangeWindowSlider } from './RangeWindowSlider';

export function ToolSimulationControls() {
  const stlUrl = useAppStore((s) => s.stlUrl);
  const toolpaths = useAppStore((s) => s.toolpaths);
  const operations = useAppStore((s) => s.operations);
  const simulationPlaying = useAppStore((s) => s.simulationPlaying);
  const simulationDistance = useAppStore((s) => s.simulationDistance);
  const simulationSpeed = useAppStore((s) => s.simulationSpeed);
  const simulationWindowStart = useAppStore((s) => s.simulationWindowStart);
  const simulationWindowEnd = useAppStore((s) => s.simulationWindowEnd);
  const simulationShowTool = useAppStore((s) => s.simulationShowTool);
  const setSimulationDistance = useAppStore((s) => s.setSimulationDistance);
  const setSimulationPlaying = useAppStore((s) => s.setSimulationPlaying);
  const setSimulationSpeed = useAppStore((s) => s.setSimulationSpeed);
  const setSimulationWindow = useAppStore((s) => s.setSimulationWindow);
  const setSimulationShowTool = useAppStore((s) => s.setSimulationShowTool);
  const resetSimulation = useAppStore((s) => s.resetSimulation);

  const [displayDistance, setDisplayDistance] = useState(0);
  const [displayWindow, setDisplayWindow] = useState({
    start: simulationWindowStart,
    end: simulationWindowEnd,
  });
  const scrubbingRef = useRef(false);
  const windowDraggingRef = useRef(false);
  const lastDisplayRef = useRef({ distance: 0, start: 0, end: 0 });

  const visiblePaths = useMemo(() => {
    const visibleIds = new Set(operations.filter((o) => o.visible).map((o) => o.id));
    return toolpaths.filter((tp) => visibleIds.has(tp.operationId));
  }, [toolpaths, operations]);

  const timeline = useMemo(() => buildSimulationTimeline(visiblePaths), [visiblePaths]);

  const windowDistances = useMemo(
    () =>
      previewWindowDistances(timeline.totalDistance, displayWindow.start, displayWindow.end),
    [timeline.totalDistance, displayWindow.start, displayWindow.end]
  );

  useEffect(() => {
    syncLiveSimulationDistanceFromStore();
    const w = getEffectiveSimulationWindow();
    setDisplayWindow(w);
    setDisplayDistance(getEffectiveSimulationDistance());
  }, [timeline.totalDistance]);

  useEffect(() => {
    setDisplayWindow({ start: simulationWindowStart, end: simulationWindowEnd });
  }, [simulationWindowStart, simulationWindowEnd]);

  useEffect(() => {
    if (scrubbingRef.current || simulationPlaying || windowDraggingRef.current) return;
    setDisplayDistance(simulationDistance);
  }, [simulationDistance, simulationPlaying]);

  useEffect(() => {
    let frameId = 0;

    const tick = () => {
      const active =
        simulationPlaying ||
        scrubbingRef.current ||
        windowDraggingRef.current ||
        hasLiveSimulationOverride();

      if (active) {
        const distance = getEffectiveSimulationDistance();
        const window = getEffectiveSimulationWindow();
        const last = lastDisplayRef.current;
        if (
          Math.abs(distance - last.distance) > 1e-4 ||
          Math.abs(window.start - last.start) > 1e-6 ||
          Math.abs(window.end - last.end) > 1e-6
        ) {
          lastDisplayRef.current = { distance, start: window.start, end: window.end };
          setDisplayDistance(distance);
          setDisplayWindow(window);
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [simulationPlaying]);

  useEffect(() => {
    const clamped = clampDistanceToWindow(
      getEffectiveSimulationDistance(),
      windowDistances.start,
      windowDistances.end
    );
    if (Math.abs(clamped - getEffectiveSimulationDistance()) > 1e-6) {
      setLiveSimulationDistance(clamped);
      if (!windowDraggingRef.current && !scrubbingRef.current) {
        setSimulationDistance(clamped);
        clearLiveSimulationDistance();
      }
      setDisplayDistance(clamped);
    }
  }, [windowDistances.start, windowDistances.end, setSimulationDistance]);

  if (!stlUrl || timeline.samples.length === 0) return null;

  const { start: windowStartDist, end: windowEndDist, span: windowSpan } = windowDistances;
  const progressInWindow =
    windowSpan > 0 ? ((displayDistance - windowStartDist) / windowSpan) * 100 : 0;
  const offsetInWindow = displayDistance - windowStartDist;

  const handleWindowChange = (start: number, end: number) => {
    setSimulationWindow(start, end);
    const nextWindow = previewWindowDistances(timeline.totalDistance, start, end);
    const clamped = clampDistanceToWindow(
      getEffectiveSimulationDistance(),
      nextWindow.start,
      nextWindow.end
    );
    setLiveSimulationDistance(clamped);
    setSimulationDistance(clamped);
    clearLiveSimulationDistance();
    setDisplayDistance(clamped);
    setDisplayWindow({ start, end });
  };

  const stepBy = (delta: number) => {
    setSimulationPlaying(false);
    scrubbingRef.current = false;
    clearLiveSimulationDistance();
    const next = stepSimulationDistance(
      timeline,
      getEffectiveSimulationDistance(),
      delta,
      windowStartDist,
      windowEndDist
    );
    setSimulationDistance(next);
    setDisplayDistance(next);
  };

  const handlePlayToggle = () => {
    if (!simulationPlaying) {
      let current = clampDistanceToWindow(
        getEffectiveSimulationDistance(),
        windowStartDist,
        windowEndDist
      );
      if (current >= windowEndDist - 1e-6) {
        current = windowStartDist;
      }
      setLiveSimulationDistance(current);
      setSimulationDistance(current);
      setDisplayDistance(current);
    } else {
      commitLiveSimulationDistance();
    }
    setSimulationPlaying(!simulationPlaying);
  };

  return (
    <div className="tool-simulation-controls">
      <div className="tool-simulation-header">
        <span className="tool-simulation-title">Tool Preview</span>
      </div>
      <div className="tool-simulation-buttons">
        <button
          type="button"
          className="btn btn-small btn-icon"
          title="Previous point"
          aria-label="Previous toolpath point"
          onClick={() => stepBy(-1)}
        >
          ‹
        </button>
        <button type="button" className="btn btn-small" onClick={handlePlayToggle}>
          {simulationPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className="btn btn-small btn-icon"
          title="Next point"
          aria-label="Next toolpath point"
          onClick={() => stepBy(1)}
        >
          ›
        </button>
        <button
          type="button"
          className="btn btn-small btn-secondary"
          onClick={() => {
            scrubbingRef.current = false;
            windowDraggingRef.current = false;
            clearLiveSimulationDistance();
            resetSimulation();
            setDisplayDistance(0);
            setDisplayWindow({ start: 0, end: 1 });
          }}
        >
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
        <label className="tool-simulation-show-tool">
          <input
            type="checkbox"
            checked={simulationShowTool}
            onChange={(e) => setSimulationShowTool(e.target.checked)}
          />
          Show tool
        </label>
      </div>
      <div className="tool-simulation-range-label">Preview range</div>
      <RangeWindowSlider
        start={simulationWindowStart}
        end={simulationWindowEnd}
        onChange={handleWindowChange}
        onDraggingChange={(dragging) => {
          windowDraggingRef.current = dragging;
        }}
      />
      <div className="tool-simulation-meta tool-simulation-window-meta">
        <span>
          {windowStartDist.toFixed(1)}–{windowEndDist.toFixed(1)} mm
        </span>
        <span>{((displayWindow.end - displayWindow.start) * 100).toFixed(0)}% of path</span>
      </div>
      <input
        type="range"
        className="tool-simulation-scrubber"
        min={0}
        max={100}
        step={0.05}
        value={Math.max(0, Math.min(100, progressInWindow))}
        onPointerDown={() => {
          scrubbingRef.current = true;
          setSimulationPlaying(false);
          syncLiveSimulationDistanceFromStore();
        }}
        onChange={(e) => {
          const t = parseFloat(e.target.value) / 100;
          const distance = windowStartDist + t * windowSpan;
          setLiveSimulationDistance(distance);
          setDisplayDistance(distance);
        }}
        onPointerUp={() => {
          scrubbingRef.current = false;
          commitLiveSimulationDistance();
          setDisplayDistance(getEffectiveSimulationDistance());
        }}
        onPointerCancel={() => {
          scrubbingRef.current = false;
          commitLiveSimulationDistance();
          setDisplayDistance(getEffectiveSimulationDistance());
        }}
      />
      <div className="tool-simulation-meta">
        <span>
          {offsetInWindow.toFixed(1)} / {windowSpan.toFixed(1)} mm
        </span>
        <span>{progressInWindow.toFixed(0)}%</span>
      </div>
    </div>
  );
}
