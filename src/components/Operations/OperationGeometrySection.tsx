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
    updateOperation,
  } = useAppStore();

  const isActive = activeOperationId === operation.id;
  const geometrySummary = formatGeometrySummary(operation);
  const hasOutlineLoop =
    operation.type === 'adaptive-outline' &&
    !!operation.geometry?.loops &&
    operation.geometry.loops.length > 0;
  const hasGeometry =
    !!operation.geometry &&
    (operation.geometry.faceIndices.length > 0 ||
      getSelectedHoles(operation.geometry).length > 0 ||
      !!operation.geometry.entryPoint ||
      !!operation.geometry.toolStartPoint ||
      !!operation.geometry.slotJoinPoint ||
      hasOutlineLoop);
  const isEditingEntry = isActive && selectionMode && selectionSubMode === 'entry-point';
  const isSelectingGeometry = isActive && selectionMode && selectionSubMode !== 'entry-point';

  const entryLayout = (() => {
    if (!hasOutlineLoop || !operation.geometry?.loops?.[0]) return null;
    const resolution = useSettingsStore.getState().toolpathResolution;
    const segLen = minkowskiSegmentLen(resolution);
    const roughSlot = resolveAdaptiveSlotGeometry(operation.settings, { roughing: true });
    const trochSampleSpacing = trochoidSampleSpacing(
      roughSlot.forwardIncrement,
      roughSlot.trochoidRadius,
      resolution
    );
    return resolveAdaptiveEntryLayout(
      operation.geometry.loops[0],
      operation.settings,
      adaptiveEntryOverridesFromGeometry(operation.geometry),
      segLen,
      trochSampleSpacing
    );
  })();

  const toolStartX =
    operation.geometry?.toolStartPoint?.x ?? entryLayout?.toolStart.x ?? 0;
  const toolStartY =
    operation.geometry?.toolStartPoint?.y ?? entryLayout?.toolStart.y ?? 0;

  const handleSelectGeometry = () => {
    setActiveOperation(operation.id);
    setSelectionMode(true, 'geometry');
  };

  const handleEditEntryPoints = () => {
    setActiveOperation(operation.id);
    setSelectionMode(true, 'entry-point');
  };

  const handleStopSelection = () => {
    setSelectionMode(false);
  };

  const handleToolStartCoordinateChange = (axis: 'x' | 'y', raw: string) => {
    if (!operation.geometry) return;
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return;
    const current = operation.geometry.toolStartPoint ?? entryLayout?.toolStart ?? { x: 0, y: 0 };
    updateOperation(operation.id, {
      geometry: {
        ...operation.geometry,
        toolStartPoint: { ...current, [axis]: value },
        entryPoint: undefined,
      },
    });
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
        {isEditingEntry ? (
          <button className="btn btn-small btn-accent" onClick={handleStopSelection}>
            Done Editing
          </button>
        ) : isSelectingGeometry ? (
          <button className="btn btn-small btn-accent" onClick={handleStopSelection}>
            Done Selecting
          </button>
        ) : (
          <>
            <button className="btn btn-small" onClick={handleSelectGeometry}>
              Select from Model
            </button>
            {hasOutlineLoop && (
              <button className="btn btn-small btn-secondary" onClick={handleEditEntryPoints}>
                Edit Entry Points
              </button>
            )}
          </>
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
      {hasOutlineLoop && (
        <div className="settings-grid entry-start-grid">
          <div className="setting-row">
            <label>
              Tool start X <span className="unit">(mm)</span>
            </label>
            <input
              type="number"
              value={Number.isFinite(toolStartX) ? toolStartX : 0}
              step={0.1}
              onChange={(e) => handleToolStartCoordinateChange('x', e.target.value)}
            />
          </div>
          <div className="setting-row">
            <label>
              Tool start Y <span className="unit">(mm)</span>
            </label>
            <input
              type="number"
              value={Number.isFinite(toolStartY) ? toolStartY : 0}
              step={0.1}
              onChange={(e) => handleToolStartCoordinateChange('y', e.target.value)}
            />
          </div>
        </div>
      )}
      {isActive && hasOutlineLoop && !isEditingEntry && (
        <p className="geometry-submode">
          Use Edit Entry Points to drag tool start and slot join without rotating the view.
          Lead-in is a spline tangent to the outline in climb/conventional direction.
        </p>
      )}
      {isEditingEntry && (
        <p className="geometry-submode">
          Drag amber cross = tool start, blue cross = slot join on centerline (orange guide).
          Right-drag to orbit the view.
        </p>
      )}
      {isSelectingGeometry && operation.type === 'adaptive-outline' && (
        <p className="geometry-submode">Select top-facing part outline</p>
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
