import { useCallback, useRef } from 'react';

interface RangeWindowSliderProps {
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
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

export function RangeWindowSlider({ start, end, onChange }: RangeWindowSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    | { mode: 'start' | 'end' | 'window'; start0: number; end0: number; originFrac: number }
    | null
  >(null);

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
      dragRef.current = {
        mode,
        start0: start,
        end0: end,
        originFrac: fractionFromEvent(event.clientX),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const frac = fractionFromEvent(event.clientX);

    if (drag.mode === 'start') {
      const [s, e] = clampWindow(frac, end);
      onChange(s, e);
      return;
    }
    if (drag.mode === 'end') {
      const [s, e] = clampWindow(start, frac);
      onChange(s, e);
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
    onChange(...clampWindow(nextStart, nextEnd));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
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
        style={{ left: `${start * 100}%`, width: `${(end - start) * 100}%` }}
        onPointerDown={onPointerDown('window')}
      />
      <div
        className="range-window-handle range-window-handle--start"
        style={{ left: `${start * 100}%` }}
        onPointerDown={onPointerDown('start')}
        role="slider"
        aria-label="Preview range start"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(start * 100)}
      />
      <div
        className="range-window-handle range-window-handle--end"
        style={{ left: `${end * 100}%` }}
        onPointerDown={onPointerDown('end')}
        role="slider"
        aria-label="Preview range end"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(end * 100)}
      />
    </div>
  );
}
