import { useAppStore } from '../store/useAppStore';

export function PartSetup() {
  const stlUrl = useAppStore((s) => s.stlUrl);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const selectionSubMode = useAppStore((s) => s.selectionSubMode);
  const setSelectionMode = useAppStore((s) => s.setSelectionMode);
  const setActiveOperation = useAppStore((s) => s.setActiveOperation);

  if (!stlUrl) return null;

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
      <p className="part-setup-desc">Bottom of part sits on Z=0 build plate</p>
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
