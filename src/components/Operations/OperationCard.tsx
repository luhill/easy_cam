import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Operation } from '../../types/operations';
import { OPERATION_COLORS, getSelectionStrategy } from '../../types/operations';
import { useAppStore } from '../../store/useAppStore';
import { OperationSettings } from './OperationSettings';

interface OperationCardProps {
  operation: Operation;
}

function formatGeometrySummary(operation: Operation): string {
  const geo = operation.geometry;
  if (!geo || geo.faceIndices.length === 0) return 'None selected';

  const strategy = getSelectionStrategy(operation.type);
  const faceCount = geo.faceIndices.length;

  if (strategy === 'outline-loop' && geo.loops && geo.loops.length > 0) {
    const points = geo.loops.reduce((sum, loop) => sum + loop.length, 0);
    return `${geo.loops.length} loop(s), ${points} pts (${faceCount} faces)`;
  }

  if (strategy === 'point') {
    return faceCount === 1 ? '1 point' : `${faceCount} points`;
  }

  return `${faceCount} face${faceCount === 1 ? '' : 's'}`;
}

export function OperationCard({ operation }: OperationCardProps) {
  const {
    toggleOperationEnabled,
    toggleOperationVisible,
    toggleOperationCollapsed,
    setActiveOperation,
    setSelectionMode,
    removeOperation,
    activeOperationId,
    selectionMode,
  } = useAppStore();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: operation.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    borderLeftColor: OPERATION_COLORS[operation.type],
  };

  const isActive = activeOperationId === operation.id;
  const geometrySummary = formatGeometrySummary(operation);

  const handleSelectGeometry = () => {
    setActiveOperation(operation.id);
    setSelectionMode(true);
  };

  const handleStopSelection = () => {
    setSelectionMode(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`operation-card ${!operation.enabled ? 'disabled' : ''} ${isActive ? 'active' : ''}`}
    >
      <div
        className="operation-header"
        onClick={() => {
          setActiveOperation(operation.id);
          toggleOperationCollapsed(operation.id);
        }}
      >
        <button
          className="drag-handle"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
        >
          ⠿
        </button>

        <span className="collapse-arrow">{operation.collapsed ? '▶' : '▼'}</span>

        <span className="operation-name">{operation.name}</span>

        <div className="operation-header-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className={`btn-toggle ${operation.visible ? 'on' : ''}`}
            onClick={() => toggleOperationVisible(operation.id)}
            title={operation.visible ? 'Hide toolpath' : 'Show toolpath'}
          >
            👁
          </button>
          <button
            className={`btn-toggle ${operation.enabled ? 'on' : ''}`}
            onClick={() => toggleOperationEnabled(operation.id)}
            title={operation.enabled ? 'Disable for G-code' : 'Enable for G-code'}
          >
            ⚡
          </button>
          <button
            className="btn-icon btn-danger"
            onClick={() => removeOperation(operation.id)}
            title="Remove operation"
          >
            ✕
          </button>
        </div>
      </div>

      {!operation.collapsed && (
        <div className="operation-body">
          <OperationSettings operation={operation} />

          <div className="geometry-section">
            <div className="geometry-header">
              <span>Geometry</span>
              <span className="geometry-count">{geometrySummary}</span>
            </div>
            <div className="geometry-actions">
              {isActive && selectionMode ? (
                <button className="btn btn-small btn-accent" onClick={handleStopSelection}>
                  Done Selecting
                </button>
              ) : (
                <button className="btn btn-small" onClick={handleSelectGeometry}>
                  Select from Model
                </button>
              )}
              {operation.geometry && operation.geometry.faceIndices.length > 0 && (
                <button
                  className="btn btn-small btn-secondary"
                  onClick={() => useAppStore.getState().setOperationGeometry(operation.id, null)}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
