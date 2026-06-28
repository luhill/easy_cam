import { useAppStore } from '../store/useAppStore';
import { partDimensionsFromBounds } from '../lib/geometryProcessing';

export function PartSetup() {
  const stlUrl = useAppStore((s) => s.stlUrl);
  const partBounds = useAppStore((s) => s.partBounds);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const selectionSubMode = useAppStore((s) => s.selectionSubMode);
  const setSelectionMode = useAppStore((s) => s.setSelectionMode);
  const setActiveOperation = useAppStore((s) => s.setActiveOperation);

  if (!stlUrl) return null;

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
      <h3 className="panel-title">Part Setup</h3>
      <p className="part-setup-desc">STL units are millimeters. Bottom of part sits on Z=0 build plate.</p>
      {dimensions && (
        <p className="part-setup-desc">
          Size: {dimensions.width.toFixed(1)} × {dimensions.depth.toFixed(1)} ×{' '}
          {dimensions.height.toFixed(1)} mm (X × Y × Z)
        </p>
      )}
      {isBottomMode ? (
        <button className="btn btn-small btn-accent" onClick={cancelBottomFace}>
          Done / Cancel
        </button>
      ) : (
        <button className="btn btn-small" onClick={startBottomFace}>
          Set Bottom Face
        </button>
      )}
    </div>
  );
}
