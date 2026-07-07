import { useMemo } from 'react';
import type { Operation } from '../../types/operations';
import {
  getSelectedEdgeLoops,
  getSelectedHoles,
  DEFAULT_SETTINGS,
  isAdaptiveOutlineOperation,
  isOutlineHelixEntryOperation,
  isOutlineOperation,
  isStandardOutlineEntryEditable,
} from '../../types/operations';
import { createCutZContext, type CutZContext } from '../../lib/cutDepth';
import { validateHelixHole } from '../../lib/helixValidation';
import { clampOperationSettings } from '../../lib/settingLimits';
import {
  adaptiveEntryOverridesFromGeometry,
  resolveAdaptiveEntryLayout,
} from '../../lib/adaptiveGuides';
import { minkowskiSegmentLen, pathSampleSpacing, trochoidSampleSpacing } from '../../lib/toolpathConfig';
import { resolveStandardEntryLayout } from '../../lib/outlineEntry';
import { finishingStockAllowance, resolveAdaptiveSlotGeometry } from '../../lib/adaptiveOutline';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAppStore } from '../../store/useAppStore';
import { HintTooltip } from '../HintTooltip';

interface OperationGeometrySectionProps {
  operation: Operation;
}

function formatGeometrySummary(operation: Operation, cutZContext: CutZContext): string {
  const geo = operation.geometry;
  if (!geo) return 'None selected';

  const edgeLoops = getSelectedEdgeLoops(geo);
  if (edgeLoops.length > 0 && isOutlineOperation(operation)) {
    if (edgeLoops.length === 1) {
      const el = edgeLoops[0];
      const depth = el.topZ - el.bottomZ;
      return `edge loop, Z ${el.topZ.toFixed(1)} → ${el.bottomZ.toFixed(1)} mm (${depth.toFixed(1)} mm deep)`;
    }
    return `${edgeLoops.length} edge loops`;
  }

  const holes = getSelectedHoles(geo);
  if (holes.length > 0 && (operation.type === 'drill' || operation.type === 'helix')) {
    if (operation.type === 'helix') {
      const settings = clampOperationSettings({ ...DEFAULT_SETTINGS, ...operation.settings });
      const invalidCount = holes.filter(
        (hole) => !validateHelixHole(hole.radius, settings, cutZContext).valid
      ).length;
      const validCount = holes.length - invalidCount;
      const parts: string[] = [];
      if (validCount > 0) {
        parts.push(validCount === 1 ? `1 hole` : `${validCount} holes`);
      }
      if (invalidCount > 0) {
        parts.push(`${invalidCount} invalid`);
      }
      return parts.join(', ') || 'None selected';
    }
    if (holes.length === 1) {
      return `Hole ⌀${(holes[0].radius * 2).toFixed(1)} mm`;
    }
    return `${holes.length} holes`;
  }

  if (isStandardOutlineEntryEditable(operation)) {
    const hasOutline = geo.loops && geo.loops.length > 0;
    if (!hasOutline) return 'None selected';
    const loop = geo.loops![0];
    const resolution = useSettingsStore.getState().toolpathResolution;
    const stockAllowance = finishingStockAllowance(operation.settings);
    const toolOrigin = useSettingsStore.getState().toolOrigin;
    const layout = resolveStandardEntryLayout(
      loop,
      operation.settings,
      stockAllowance,
      geo,
      pathSampleSpacing(resolution),
      minkowskiSegmentLen(resolution),
      toolOrigin
    );
    if (!layout) return 'outline';
    const entryLabel =
      operation.settings.outlineEntryType === 'helix' ? 'entry' : 'start';
    const parts = [
      'outline',
      `${entryLabel} (${layout.toolStart.x.toFixed(1)}, ${layout.toolStart.y.toFixed(1)})`,
      `join (${layout.contourJoin.x.toFixed(1)}, ${layout.contourJoin.y.toFixed(1)})`,
    ];
    return parts.join(', ');
  }

  if (isAdaptiveOutlineOperation(operation)) {
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
    const toolOrigin = useSettingsStore.getState().toolOrigin;
    const layout = resolveAdaptiveEntryLayout(
      loop,
      operation.settings,
      adaptiveEntryOverridesFromGeometry(geo),
      segLen,
      trochSampleSpacing,
      resolution,
      toolOrigin
    );
    if (layout) {
      parts.push(`start (${layout.toolStart.x.toFixed(1)}, ${layout.toolStart.y.toFixed(1)})`);
      parts.push(`join (${layout.slotJoin.x.toFixed(1)}, ${layout.slotJoin.y.toFixed(1)})`);
    }
    return parts.join(', ');
  }

  if (!geo.faceIndices.length && edgeLoops.length === 0) return 'None selected';

  const faceCount = geo.faceIndices.length;

  if (isOutlineOperation(operation) && geo.loops && geo.loops.length > 0) {
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

  const partBounds = useAppStore((s) => s.partBounds);
  const cutZContext = useMemo(() => createCutZContext(partBounds), [partBounds]);

  const isActive = activeOperationId === operation.id;
  const geometrySummary = formatGeometrySummary(operation, cutZContext);
  const hasEditableEntry =
    (isOutlineHelixEntryOperation(operation) || isStandardOutlineEntryEditable(operation)) &&
    !!operation.geometry?.loops &&
    operation.geometry.loops.length > 0;
  const hasAdaptiveEntry = hasEditableEntry && isAdaptiveOutlineOperation(operation);
  const hasStandardTwoPointEntry = hasEditableEntry && isStandardOutlineEntryEditable(operation);
  const hasTwoPointEntry = hasAdaptiveEntry || hasStandardTwoPointEntry;
  const hasGeometry =
    !!operation.geometry &&
    (operation.geometry.faceIndices.length > 0 ||
      getSelectedHoles(operation.geometry).length > 0 ||
      getSelectedEdgeLoops(operation.geometry).length > 0 ||
      !!operation.geometry.entryPoint ||
      !!operation.geometry.toolStartPoint ||
      !!operation.geometry.slotJoinPoint ||
      hasEditableEntry);
  const isEditingEntry = isActive && selectionMode && selectionSubMode === 'entry-point';
  const isSelectingGeometry = isActive && selectionMode && selectionSubMode !== 'entry-point';

  const toolOrigin = useSettingsStore((s) => s.toolOrigin);

  const entryLayout = useMemo(() => {
    if (!hasEditableEntry || !operation.geometry?.loops?.[0]) return null;
    const loop = operation.geometry.loops[0];
    if (isAdaptiveOutlineOperation(operation)) {
      const resolution = useSettingsStore.getState().toolpathResolution;
      const segLen = minkowskiSegmentLen(resolution);
      const roughSlot = resolveAdaptiveSlotGeometry(operation.settings, { roughing: true });
      const trochSampleSpacing = trochoidSampleSpacing(
        roughSlot.forwardIncrement,
        roughSlot.trochoidRadius,
        resolution
      );
      return resolveAdaptiveEntryLayout(
        loop,
        operation.settings,
        adaptiveEntryOverridesFromGeometry(operation.geometry),
        segLen,
        trochSampleSpacing,
        resolution,
        toolOrigin
      );
    }
    const stockAllowance = finishingStockAllowance(operation.settings);
    const resolution = useSettingsStore.getState().toolpathResolution;
    return resolveStandardEntryLayout(
      loop,
      operation.settings,
      stockAllowance,
      operation.geometry,
      pathSampleSpacing(resolution),
      minkowskiSegmentLen(resolution),
      toolOrigin
    );
  }, [hasEditableEntry, operation, toolOrigin]);

  const resolvedToolStart = entryLayout
    ? entryLayout.toolStart
    : { x: 0, y: 0 };
  const resolvedJoin =
    entryLayout && 'slotJoin' in entryLayout
      ? entryLayout.slotJoin
      : entryLayout && 'contourJoin' in entryLayout
        ? entryLayout.contourJoin
        : { x: 0, y: 0 };

  const toolStartX = operation.geometry?.toolStartPoint?.x ?? resolvedToolStart.x;
  const toolStartY = operation.geometry?.toolStartPoint?.y ?? resolvedToolStart.y;
  const slotJoinX = operation.geometry?.slotJoinPoint?.x ?? resolvedJoin.x;
  const slotJoinY = operation.geometry?.slotJoinPoint?.y ?? resolvedJoin.y;

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
    const current = operation.geometry.toolStartPoint ?? resolvedToolStart;
    updateOperation(operation.id, {
      geometry: {
        ...operation.geometry,
        toolStartPoint: { ...current, [axis]: value },
        entryPoint: undefined,
      },
    });
  };

  const handleSlotJoinCoordinateChange = (axis: 'x' | 'y', raw: string) => {
    if (!operation.geometry) return;
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return;
    const current = operation.geometry.slotJoinPoint ?? resolvedJoin;
    updateOperation(operation.id, {
      geometry: {
        ...operation.geometry,
        slotJoinPoint: { ...current, [axis]: value },
      },
    });
  };

  const supportsModelSelection =
    operation.type !== 'custom-gcode' &&
    (isOutlineOperation(operation) ||
    operation.type === 'drill' ||
    operation.type === 'helix' ||
    operation.type === 'pocket' ||
    operation.type === 'contour');

  if (!supportsModelSelection) return null;

  const geometryHint = (() => {
    if (isEditingEntry) {
      return hasTwoPointEntry
        ? hasAdaptiveEntry
          ? 'Drag amber cross = tool start, blue cross = slot join on centerline (yellow reference guide). Right-drag to orbit the view.'
          : 'Drag amber cross = entry start, blue cross = outline join on tool path. Right-drag to orbit the view.'
        : 'Drag amber cross = outline entry start on the tool path. Right-drag to orbit the view.';
    }
    if (isActive && hasEditableEntry && !isEditingEntry) {
      return hasTwoPointEntry
        ? hasAdaptiveEntry
          ? 'Use Edit Entry Points to drag tool start and slot join without rotating the view. Lead-in is a spline tangent to the outline in climb/conventional direction.'
          : 'Use Edit Entry Points to drag entry start and outline join. Lead-in uses a tangent spline when entry is offset from the join.'
        : 'Use Edit Entry Points to set where the ramp, helix tangent, or straight plunge begins on the outline.';
    }
    if (isSelectingGeometry && isOutlineOperation(operation)) {
      return 'Click vertical wall faces along a closed edge loop — add/remove like holes';
    }
    if (isActive && selectionMode && isOutlineOperation(operation)) {
      return 'Click vertical wall faces along a closed edge loop — add/remove like holes';
    }
    if (isActive && selectionMode && (operation.type === 'drill' || operation.type === 'helix')) {
      return 'Click holes to add or remove — multiple holes supported';
    }
    if (isActive && selectionMode && (operation.type === 'pocket' || operation.type === 'contour')) {
      return 'Select faces on the model to define the operation region';
    }
    return null;
  })();

  return (
    <div className="geometry-section geometry-section-first">
      <div className="geometry-header">
        <span className="label-with-hint">
          Geometry
          {geometryHint ? <HintTooltip text={geometryHint} /> : null}
        </span>
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
            {hasEditableEntry && (
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
      {hasEditableEntry && (
        <div className="settings-grid entry-start-grid">
          <div className="setting-row">
            <label>
              Entry start X <span className="unit">(mm)</span>
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
              Entry start Y <span className="unit">(mm)</span>
            </label>
            <input
              type="number"
              value={Number.isFinite(toolStartY) ? toolStartY : 0}
              step={0.1}
              onChange={(e) => handleToolStartCoordinateChange('y', e.target.value)}
            />
          </div>
          {hasTwoPointEntry && (
            <>
              <div className="setting-row">
                <label>
                  Outline join X <span className="unit">(mm)</span>
                </label>
                <input
                  type="number"
                  value={Number.isFinite(slotJoinX) ? slotJoinX : 0}
                  step={0.1}
                  onChange={(e) => handleSlotJoinCoordinateChange('x', e.target.value)}
                />
              </div>
              <div className="setting-row">
                <label>
                  Outline join Y <span className="unit">(mm)</span>
                </label>
                <input
                  type="number"
                  value={Number.isFinite(slotJoinY) ? slotJoinY : 0}
                  step={0.1}
                  onChange={(e) => handleSlotJoinCoordinateChange('y', e.target.value)}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
