import type { Operation } from '../../types/operations';
import {
  getSelectionStrategy,
  getSelectedHoles,
} from '../../types/operations';
import {
  adaptiveEntryOverridesFromGeometry,
  resolveAdaptiveEntryLayout,
} from '../../lib/adaptiveGuides';
import { minkowskiSegmentLen, trochoidSampleSpacing } from '../../lib/toolpathConfig';
import { resolveAdaptiveSlotGeometry } from '../../lib/adaptiveOutline';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppStore } from '../../store/useAppStore';

interface OperationGeometrySectionProps {
  operation: Operation;
}

function formatGeometrySummary(operation: Operation): string {
  const geo = operation.geometry;
  if (!geo) return 'None selected';

  const holes = getSelectedHoles(geo);
  if (holes.length > 0 && (operation.type === 'drill' || operation.type === 'helix')) {
    if (holes.length === 1) {
      return `Hole ⌀${(holes[0].radius * 2).toFixed(1)} mm`;
    }
    return `${holes.length} holes`;
  }

  if (operation.type === 'adaptive-outline') {
    const hasOutline = geo.loops && geo.loops.length > 0;
    if (!hasOutline) return 'None selected';
    const parts: string[] = ['outline'];
    const loop = geo.loops![0];
    const resolution = useSettingsStore.getState().toolpathResolution;
    const segLen = minkowskiSegmentLen(resolution);
    const roughSlot = resolveAdaptiveSlotGeometry(operation.settings, { roughing: true });
    const trochSampleSpacing = trochoidSampleSpacing(
      roughSlot.forwardIncrement,
      roughSlot.trochoidRadius,
      resolution
    );
    const layout = resolveAdaptiveEntryLayout(
      loop,
      operation.settings,
      adaptiveEntryOverridesFromGeometry(geo),
      segLen,
      trochSampleSpacing
    );
    if (layout) {
      parts.push(`start (${layout.toolStart.x.toFixed(1)}, ${layout.toolStart.y.toFixed(1)})`);
      parts.push(`join (${layout.slotJoin.x.toFixed(1)}, ${layout.slotJoin.y.toFixed(1)})`);
    }
    return parts.join(', ');
  }

  if (!geo.faceIndices.length) return 'None selected';

  const strategy = getSelectionStrategy(operation.type);
  const faceCount = geo.faceIndices.length;

  if (strategy === 'outline-loop' && geo.loops && geo.loops.length > 0) {
    const points = geo.loops.reduce((sum, loop) => sum + loop.length, 0);
    return `${geo.loops.length} loop(s), ${points} pts`;
  }

  return `${faceCount} face${faceCount === 1 ? '' : 's'}`;
}

export function OperationGeometrySection({ operation }: OperationGeometrySectionProps) {
  const {
    setActiveOperation,
    setSelectionMode,
    activeOperationId,
    selectionMode,
    selectionSubMode,
  } = useAppStore();

  const isActive = activeOperationId === operation.id;
  const geometrySummary = formatGeometrySummary(operation);
  const hasGeometry =
    !!operation.geometry &&
    (operation.geometry.faceIndices.length > 0 ||
      getSelectedHoles(operation.geometry).length > 0 ||
      !!operation.geometry.entryPoint ||
      !!operation.geometry.toolStartPoint ||
      !!operation.geometry.slotJoinPoint ||
      (operation.type === 'adaptive-outline' &&
        !!operation.geometry.loops &&
        operation.geometry.loops.length > 0));

  const handleSelectGeometry = () => {
    setActiveOperation(operation.id);
    setSelectionMode(true, 'geometry');
  };

  const handleStopSelection = () => {
    setSelectionMode(false);
  };

  const supportsModelSelection =
    operation.type === 'outline' ||
    operation.type === 'adaptive-outline' ||
    operation.type === 'drill' ||
    operation.type === 'helix' ||
    operation.type === 'pocket' ||
    operation.type === 'contour';

  if (!supportsModelSelection) return null;

  return (
    <div className="geometry-section geometry-section-first">
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
        {hasGeometry && !(isActive && selectionMode) && (
          <button
            className="btn btn-small btn-secondary"
            onClick={() => useAppStore.getState().setOperationGeometry(operation.id, null)}
          >
            Clear
          </button>
        )}
      </div>
      {isActive && operation.type === 'adaptive-outline' && operation.geometry?.loops?.[0] && (
        <p className="geometry-submode">
          Drag gray/amber cross = tool start, blue cross = slot join on centerline (orange guide).
          Lead-in is a spline tangent to the outline in climb/conventional direction.
        </p>
      )}
      {isActive && selectionMode && operation.type === 'adaptive-outline' && (
        <p className="geometry-submode">
          {selectionSubMode === 'geometry'
            ? 'Select top-facing part outline — then drag entry handles in the 3D view'
            : 'Select top-facing part outline'}
        </p>
      )}
      {isActive && selectionMode && (operation.type === 'drill' || operation.type === 'helix') && (
        <p className="geometry-submode">
          Click holes to add or remove — multiple holes supported
        </p>
      )}
      {isActive && selectionMode && (operation.type === 'pocket' || operation.type === 'contour') && (
        <p className="geometry-submode">Select faces on the model to define the operation region</p>
      )}
    </div>
  );
}
