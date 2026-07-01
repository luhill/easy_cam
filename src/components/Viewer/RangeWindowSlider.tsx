import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearLiveSimulationWindow,
  setLiveSimulationWindow,
  syncLiveSimulationWindowFromStore,
} from '../../lib/simulationLiveBridge';

interface RangeWindowSliderProps {
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
}

const MIN_GAP = 0.02;

function clampWindow(start: number, end: number): [number, number] {
  let s = Math.max(0, Math.min(1, start));
  let e = Math.max(0, Math.min(1, end));
  if (e - s < MIN_GAP) {
    if (s + MIN_GAP <= 1) e = s + MIN_GAP;
    else s = e - MIN_GAP;
  }
  return [s, e];
}

export function RangeWindowSlider({
  start,
  end,
  onChange,
  onDraggingChange,
}: RangeWindowSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    | { mode: 'start' | 'end' | 'window'; start0: number; end0: number; originFrac: number }
    | null
  >(null);
  const [localStart, setLocalStart] = useState(start);
  const [localEnd, setLocalEnd] = useState(end);
  const localRef = useRef({ start, end });
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!draggingRef.current) {
      setLocalStart(start);
      setLocalEnd(end);
      localRef.current = { start, end };
    }
  }, [start, end]);

  const applyLocal = (nextStart: number, nextEnd: number) => {
    const [s, e] = clampWindow(nextStart, nextEnd);
    setLocalStart(s);
    setLocalEnd(e);
    localRef.current = { start: s, end: e };
    setLiveSimulationWindow(s, e);
  };

  const fractionFromEvent = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

  const onPointerDown =
    (mode: 'start' | 'end' | 'window') => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      draggingRef.current = true;
      onDraggingChange?.(true);
      syncLiveSimulationWindowFromStore();
      dragRef.current = {
        mode,
        start0: localRef.current.start,
        end0: localRef.current.end,
        originFrac: fractionFromEvent(event.clientX),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const frac = fractionFromEvent(event.clientX);

    if (drag.mode === 'start') {
      applyLocal(frac, localRef.current.end);
      return;
    }
    if (drag.mode === 'end') {
      applyLocal(localRef.current.start, frac);
      return;
    }

    const delta = frac - drag.originFrac;
    let nextStart = drag.start0 + delta;
    let nextEnd = drag.end0 + delta;
    const width = drag.end0 - drag.start0;
    if (nextStart < 0) {
      nextStart = 0;
      nextEnd = width;
    }
    if (nextEnd > 1) {
      nextEnd = 1;
      nextStart = 1 - width;
    }
    const [s, e] = clampWindow(nextStart, nextEnd);
    applyLocal(s, e);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    onDraggingChange?.(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag && wasDragging) {
      onChange(localRef.current.start, localRef.current.end);
      clearLiveSimulationWindow();
    }
  };

  return (
    <div
      className="range-window-slider"
      ref={trackRef}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="range-window-track" />
      <div
        className="range-window-selection"
        style={{ left: `${localStart * 100}%`, width: `${(localEnd - localStart) * 100}%` }}
        onPointerDown={onPointerDown('window')}
      />
      <div
        className="range-window-handle range-window-handle--start"
        style={{ left: `${localStart * 100}%` }}
        onPointerDown={onPointerDown('start')}
        role="slider"
        aria-label="Preview range start"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(localStart * 100)}
      />
      <div
        className="range-window-handle range-window-handle--end"
        style={{ left: `${localEnd * 100}%` }}
        onPointerDown={onPointerDown('end')}
        role="slider"
        aria-label="Preview range end"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(localEnd * 100)}
      />
    </div>
  );
}
