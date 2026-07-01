import { useAppStore } from '../store/useAppStore';
import { partDimensionsFromBounds } from '../lib/geometryProcessing';
import { HintTooltip } from './HintTooltip';

export function PartSetup() {
  const stlUrl = useAppStore((s) => s.stlUrl);
  const partBounds = useAppStore((s) => s.partBounds);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const selectionSubMode = useAppStore((s) => s.selectionSubMode);
  const setSelectionMode = useAppStore((s) => s.setSelectionMode);
  const setActiveOperation = useAppStore((s) => s.setActiveOperation);

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
