import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  normalizeRotationDegrees,
  partDimensionsFromBounds,
  snapRotationDegrees,
} from '../lib/geometryProcessing';
import { HintTooltip } from './HintTooltip';

const ROTATION_STEP = 15;
const ROTATION_NOTCHES = Array.from({ length: 360 / ROTATION_STEP + 1 }, (_, i) => i * ROTATION_STEP);

function formatRotationDisplay(deg: number): string {
  const rounded = Math.round(deg * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function PartRotationControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (degrees: number) => void;
}) {
  const sliderRef = useRef<HTMLInputElement>(null);
  const notchRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [draftText, setDraftText] = useState<string | null>(null);

  const pointerToDegrees = useCallback((clientX: number) => {
    const el = sliderRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return t * 360;
  }, [value]);

  const isInNotchZone = useCallback((clientY: number) => {
    const notch = notchRef.current;
    if (!notch) return false;
    const rect = notch.getBoundingClientRect();
    return clientY >= rect.top && clientY <= rect.bottom;
  }, []);

  const applyRotation = useCallback(
    (raw: number, snap: boolean) => {
      const deg = snap ? snapRotationDegrees(raw, ROTATION_STEP) : normalizeRotationDegrees(raw);
      onChange(deg);
    },
    [onChange]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const raw = pointerToDegrees(e.clientX);
      applyRotation(raw, isInNotchZone(e.clientY));
    };
    const endDrag = () => {
      draggingRef.current = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [applyRotation, isInNotchZone, pointerToDegrees]);

  const startDrag = (e: React.PointerEvent) => {
    draggingRef.current = true;
    const raw = pointerToDegrees(e.clientX);
    applyRotation(raw, isInNotchZone(e.clientY));
  };

  const commitText = () => {
    const raw = draftText ?? formatRotationDisplay(value);
    setDraftText(null);
    const parsed = Number.parseFloat(raw.replace(/°/g, '').trim());
    if (!Number.isFinite(parsed)) return;
    onChange(normalizeRotationDegrees(parsed));
  };

  return (
    <div className="part-rotation-control">
      <div className="part-rotation-header">
        <label htmlFor="part-rotation-slider">
          Rotate Z
          <HintTooltip text="Rotate the part around the vertical (Z) axis. Drag smoothly on the slider, or move into the notch strip below to snap every 15°. Type an exact angle in the box. Operation geometry rotates with the part." />
        </label>
        <div className="part-rotation-value-wrap">
          <input
            type="text"
            inputMode="decimal"
            className="part-rotation-input"
            aria-label="Rotation in degrees"
            value={draftText ?? formatRotationDisplay(value)}
            onChange={(e) => setDraftText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitText();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
          />
          <span className="part-rotation-unit">°</span>
        </div>
      </div>
      <input
        ref={sliderRef}
        id="part-rotation-slider"
        type="range"
        className="part-rotation-slider"
        min={0}
        max={360}
        step="any"
        value={value}
        onPointerDown={startDrag}
        onChange={(e) => applyRotation(parseFloat(e.target.value), false)}
      />
      <div
        ref={notchRef}
        className="part-rotation-notches"
        onPointerDown={startDrag}
        aria-hidden
      >
        {ROTATION_NOTCHES.map((deg) => (
          <span
            key={deg}
            className={`part-rotation-notch${deg % 90 === 0 ? ' major' : ''}`}
            style={{ left: `${(deg / 360) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function PartSetup() {
  const stlUrl = useAppStore((s) => s.stlUrl);
  const partBounds = useAppStore((s) => s.partBounds);
  const partRotationZ = useAppStore((s) => s.partRotationZ);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const selectionSubMode = useAppStore((s) => s.selectionSubMode);
  const setSelectionMode = useAppStore((s) => s.setSelectionMode);
  const setActiveOperation = useAppStore((s) => s.setActiveOperation);
  const setPartRotationZ = useAppStore((s) => s.setPartRotationZ);

  if (!stlUrl) {
    return (
      <div className="part-setup">
        <h3 className="panel-title">Part Setup</h3>
        <p className="part-setup-empty">Upload an STL to configure part orientation.</p>
      </div>
    );
  }

  const dimensions = partBounds ? partDimensionsFromBounds(partBounds) : null;

  const isBottomMode = selectionMode && selectionSubMode === 'bottom-face';

  const startBottomFace = () => {
    setActiveOperation(null);
    setSelectionMode(true, 'bottom-face');
  };

  const cancelBottomFace = () => {
    setSelectionMode(false);
  };

  return (
    <div className="part-setup">
      <div className="panel-title-row">
        <h3 className="panel-title">Part Setup</h3>
        <HintTooltip text="STL units are millimeters. Bottom of part sits on Z=0 build plate." />
      </div>
      {dimensions && (
        <p className="part-setup-dimensions">
          {dimensions.width.toFixed(1)} × {dimensions.depth.toFixed(1)} ×{' '}
          {dimensions.height.toFixed(1)} mm
        </p>
      )}

      <PartRotationControl value={partRotationZ} onChange={setPartRotationZ} />

      {isBottomMode ? (
        <button className="btn btn-small btn-accent" onClick={cancelBottomFace}>
          Done / Cancel
        </button>
      ) : (
        <button
          className="btn btn-small"
          onClick={startBottomFace}
          title="Click a face on the model to set the part bottom (build plate)"
        >
          Set Bottom Face
        </button>
      )}
    </div>
  );
}
