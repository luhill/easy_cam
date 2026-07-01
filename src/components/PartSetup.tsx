import { useAppStore } from '../store/useAppStore';
import { partDimensionsFromBounds, snapRotationDegrees } from '../lib/geometryProcessing';
import { HintTooltip } from './HintTooltip';

const ROTATION_STEP = 30;

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

  const handleRotationChange = (raw: number) => {
    setPartRotationZ(snapRotationDegrees(raw, ROTATION_STEP));
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

      <div className="part-rotation-control">
        <div className="part-rotation-header">
          <label htmlFor="part-rotation-slider">
            Rotate Z
            <HintTooltip text="Rotate the part around the vertical (Z) axis. Snaps to 30° steps. Operation geometry rotates with the part." />
          </label>
          <span className="part-rotation-value">{partRotationZ}°</span>
        </div>
        <input
          id="part-rotation-slider"
          type="range"
          className="part-rotation-slider"
          min={0}
          max={360}
          step={ROTATION_STEP}
          value={partRotationZ}
          onChange={(e) => handleRotationChange(parseFloat(e.target.value))}
          list="part-rotation-notches"
        />
        <datalist id="part-rotation-notches">
          {Array.from({ length: 360 / ROTATION_STEP + 1 }, (_, i) => (
            <option key={i * ROTATION_STEP} value={i * ROTATION_STEP} />
          ))}
        </datalist>
      </div>

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
