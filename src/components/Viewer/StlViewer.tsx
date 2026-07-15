import { useRef, useEffect, useMemo, useCallback, useState, type RefObject } from 'react';
import { Canvas, useThree, useFrame, type GLProps } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  OPERATION_COLORS,
  getSelectedEdgeLoops,
  getSelectedHoles,
  isAdaptiveOutlineOperation,
  isEdgeLoopInSelection,
  isOutlineHelixEntryOperation,
  isOutlineOperation,
  isStandardOutlineEntryEditable,
} from '../../types/operations';
import type { LoopPoint, OperationType, ToolpathSegment, Operation } from '../../types/operations';
import {
  createFaceColorAttribute,
  FaceColorManager,
  FACE_COLORS,
  getFaceCount,
  hexToThreeColor,
} from '../../lib/faceColors';
import {
  finalizePartPlacement,
  orientFaceToBottom,
  loopCentroid,
  type PartBounds,
  type ProcessedMesh,
} from '../../lib/geometryProcessing';
import { getSelectionHint, isEdgeLoopSelectableForOperation, isHoleSelectableForOperation, isRegionSelectableForOperation } from '../../lib/selectionRules';
import {
  clearMeshIndexCache,
  collectVertexIndices,
  getMeshIndex,
  isGroupSelected,
  mergeLoops,
  removeGroupFromSelection,
  isHoleInSelection,
  type MeshIndex,
  type SelectionGroup,
} from '../../lib/meshSelection';
import { ToolpathLines } from './ToolpathLines';
import { DebugGuideLines } from './DebugGuideLines';
import { ToolPreviewLive, ToolSimulationDriver } from './ToolPreview';
import { ToolSimulationControls } from './ToolSimulationControls';
import {
  buildSimulationTimeline,
  filterToolpathSegmentsByDistance,
  pickPreviewToolDiameter,
  PREVIEW_RAPID_FEED,
} from '../../lib/toolpathSimulation';
import { SelectionLoopLines } from './SelectionLoopLines';
import { ToolOriginMarker } from './ToolOriginMarker';
import { AdaptiveEntryHandles } from './AdaptiveEntryHandles';
import {
  buildSlotCenterlineArcGuide,
  computeAdaptiveOutlineDebugGuidesFromBounds,
  resolveAdaptiveEntryLayout,
  adaptiveEntryOverridesFromGeometry,
  snapPointToSlotCenterline,
} from '../../lib/adaptiveGuides';
import { minkowskiSegmentLen, pathSampleSpacing, trochoidSampleSpacing } from '../../lib/toolpathConfig';
import { resolveAdaptiveSlotGeometry, finishingStockAllowance, resolveAdaptiveEntryPoint } from '../../lib/adaptiveOutline';
import {
  buildOutlineEntryArcGuide,
  resolveOutlineOffsetContext,
  resolveStandardEntryLayout,
  snapPointToOutlineCenterline,
} from '../../lib/outlineEntry';
import { viewerThemeColors } from '../../lib/uiTheme';
import { createViewerRenderer, detectWebGLSupport } from '../../lib/webglSupport';
import { registerViewerCameraBridge, goHomeWithCamera, goToViewerHome } from '../../lib/viewerCamera';
import {
  applyOrthographicFrustum,
  cameraAspect,
  fitPerspectiveToPartBounds,
  replaceWithOrthographicCamera,
  replaceWithPerspectiveCamera,
} from '../../lib/viewportCamera';
import type { ToolpathColorMode, ToolpathTypeVisibility } from '../../lib/toolpathColors';
import { WebGLFallback } from './WebGLFallback';
import { Viewer2D } from './Viewer2D';
import { useProcessedStl } from '../../hooks/useProcessedStl';
import { getEffectiveSimulationWindow } from '../../lib/simulationLiveBridge';
import { buildVisiblePreviewToolpaths } from '../../lib/toolpaths';
import { ToolpathColorControls } from './ToolpathColorControls';
import { createCutZContext } from '../../lib/cutDepth';
import {
  collectInvalidHelixHoleFaces,
  validateHelixHole,
} from '../../lib/helixValidation';
import { clampOperationSettings } from '../../lib/settingLimits';
import { DEFAULT_SETTINGS } from '../../types/operations';

function ViewportCameraSync({
  partBounds,
  controlsRef,
}: {
  partBounds: PartBounds | null;
  controlsRef: RefObject<OrbitControlsImpl | null>;
}) {
  const isometricProjection = useSettingsStore((s) => s.isometricProjection);
  const { camera, set, size } = useThree();
  const projectionRef = useRef(isometricProjection);

  const boundsKey = partBounds
    ? `${partBounds.minX}:${partBounds.maxX}:${partBounds.minY}:${partBounds.maxY}:${partBounds.minZ}:${partBounds.maxZ}`
    : null;

  useEffect(() => {
    registerViewerCameraBridge({
      goHome: () => {
        goHomeWithCamera(
          camera,
          controlsRef.current,
          partBounds,
          cameraAspect(size.width, size.height)
        );
      },
    });
    return () => registerViewerCameraBridge(null);
  }, [camera, partBounds, controlsRef, size.width, size.height]);

  useEffect(() => {
    const aspect = cameraAspect(size.width, size.height);
    const modeChanged = projectionRef.current !== isometricProjection;
    projectionRef.current = isometricProjection;

    if (isometricProjection) {
      if (!(camera instanceof THREE.OrthographicCamera) || modeChanged) {
        const next = replaceWithOrthographicCamera(camera, partBounds, aspect);
        set({ camera: next });
        return;
      }
      applyOrthographicFrustum(camera, partBounds, aspect);
      return;
    }

    if (!(camera instanceof THREE.PerspectiveCamera) || modeChanged) {
      const next = replaceWithPerspectiveCamera(camera, partBounds, aspect);
      set({ camera: next });
      return;
    }

    camera.aspect = aspect;
    fitPerspectiveToPartBounds(camera, partBounds);
  }, [isometricProjection, boundsKey, partBounds, camera, set, size.width, size.height]);

  return null;
}

interface StlMeshProps {
  processedMesh: ProcessedMesh;
  meshKey: number;
  onMeshUpdate: (mesh: ProcessedMesh) => void;
  onOrientationCommitted: (geometry: THREE.BufferGeometry) => void;
  onIndexReady: (ready: boolean, regionCount?: number) => void;
}

function StlMesh({
  processedMesh,
  meshKey,
  onMeshUpdate,
  onOrientationCommitted,
  onIndexReady,
}: StlMeshProps) {
  const activeOperationId = useAppStore((s) => s.activeOperationId);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const selectionSubMode = useAppStore((s) => s.selectionSubMode);
  const setSelectionMode = useAppStore((s) => s.setSelectionMode);
  const regenerateToolpaths = useAppStore((s) => s.regenerateToolpaths);

  const activeGeometry = useAppStore((s) => {
    if (!s.activeOperationId) return null;
    return s.operations.find((o) => o.id === s.activeOperationId)?.geometry ?? null;
  });
  const activeOperationType = useAppStore((s) => {
    if (!s.activeOperationId) return null;
    return s.operations.find((o) => o.id === s.activeOperationId)?.type ?? null;
  });
  const activeOpSettingsRaw = useAppStore((s) => {
    if (!s.activeOperationId) return null;
    return s.operations.find((o) => o.id === s.activeOperationId)?.settings ?? null;
  });
  const activeOperationSettings = useMemo(() => {
    if (!activeOpSettingsRaw) return null;
    return clampOperationSettings({ ...DEFAULT_SETTINGS, ...activeOpSettingsRaw });
  }, [activeOpSettingsRaw]);
  const partBounds = useAppStore((s) => s.partBounds);
  const setOperationGeometry = useAppStore((s) => s.setOperationGeometry);

  const processedGeometry = processedMesh.geometry;

  const faceCount = useMemo(() => getFaceCount(processedGeometry), [processedGeometry]);

  const selectedColor = useMemo(
    () =>
      activeOperationType
        ? hexToThreeColor(OPERATION_COLORS[activeOperationType])
        : hexToThreeColor('#3b82f6'),
    [activeOperationType]
  );

  const selectedLoops = useMemo(() => {
    const loops = [...(activeGeometry?.loops ?? [])];
    if (activeOperationType === 'drill' || activeOperationType === 'helix') {
      for (const hole of getSelectedHoles(activeGeometry)) {
        if (hole.loop && hole.loop.length > 0) loops.push(hole.loop);
      }
    }
    if (
      activeOperationType &&
      isOutlineOperation({
        type: activeOperationType,
        settings: activeOperationSettings ?? DEFAULT_SETTINGS,
      })
    ) {
      for (const edgeLoop of getSelectedEdgeLoops(activeGeometry)) {
        if (edgeLoop.loop.length > 0) loops.push(edgeLoop.loop);
      }
    }
    return loops;
  }, [activeGeometry, activeOperationType, activeOperationSettings]);

  const cutZContext = useMemo(() => createCutZContext(partBounds), [partBounds]);

  const { validHelixLoops, invalidHelixLoops } = useMemo(() => {
    if (activeOperationType !== 'helix' || !activeOperationSettings) {
      return { validHelixLoops: selectedLoops, invalidHelixLoops: [] as LoopPoint[][] };
    }
    const valid: LoopPoint[][] = [];
    const invalid: LoopPoint[][] = [];
    for (const hole of getSelectedHoles(activeGeometry)) {
      if (!hole.loop?.length) continue;
      if (validateHelixHole(hole.radius, activeOperationSettings, cutZContext).valid) {
        valid.push(hole.loop);
      } else {
        invalid.push(hole.loop);
      }
    }
    return { validHelixLoops: valid, invalidHelixLoops: invalid };
  }, [activeGeometry, activeOperationType, activeOperationSettings, cutZContext, selectedLoops]);
  const accentColor = activeOperationType
    ? OPERATION_COLORS[activeOperationType]
    : '#3b82f6';

  const meshIndexRef = useRef<MeshIndex | null>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const colorManagerRef = useRef<FaceColorManager | null>(null);
  const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const selectedFacesRef = useRef<Set<number>>(new Set());
  const hoveredRegionIdRef = useRef(-1);
  const prevHoveredFacesRef = useRef<number[]>([]);
  const selectedColorRef = useRef(selectedColor);
  const prevSelectedRef = useRef<Set<number>>(new Set());
  const prevInvalidRef = useRef<Set<number>>(new Set());
  const invalidFacesRef = useRef<Set<number>>(new Set());
  const selectionModeRef = useRef(selectionMode);
  const selectionSubModeRef = useRef(selectionSubMode);
  const activeOperationTypeRef = useRef(activeOperationType);

  const { raycaster, pointer, camera } = useThree();
  const pickScratch = useMemo(() => new THREE.Vector3(), []);

  const [hoveredLoops, setHoveredLoops] = useState<LoopPoint[][]>([]);

  selectedColorRef.current = selectedColor;
  selectionModeRef.current = selectionMode;
  selectionSubModeRef.current = selectionSubMode;
  activeOperationTypeRef.current = activeOperationType;

  useEffect(() => {
    onIndexReady(false);
    meshIndexRef.current = null;

    const colorAttr = processedGeometry.getAttribute('color') as THREE.BufferAttribute;
    colorAttrRef.current = colorAttr;
    colorManagerRef.current = new FaceColorManager(
      colorAttr.array as Float32Array,
      processedGeometry,
      faceCount
    );

    const timeout = window.setTimeout(() => {
      const index = getMeshIndex(processedGeometry);
      meshIndexRef.current = index;
      onIndexReady(true, index.regions.length);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [processedGeometry, faceCount, meshKey, onIndexReady]);

  useEffect(() => {
    const colorManager = colorManagerRef.current;
    const colorAttr = colorAttrRef.current;
    if (!colorManager || !colorAttr) return;

    const nextSelected = new Set(activeGeometry?.faceIndices ?? []);
    if (
      (activeOperationType === 'drill' || activeOperationType === 'helix') &&
      meshIndexRef.current
    ) {
      for (const hole of getSelectedHoles(activeGeometry)) {
        for (const faceIndex of meshIndexRef.current.getWallFacesForHole(hole)) {
          nextSelected.add(faceIndex);
        }
      }
    }
    if (
      activeOperationType &&
      isOutlineOperation({
        type: activeOperationType,
        settings: activeOperationSettings ?? DEFAULT_SETTINGS,
      }) &&
      meshIndexRef.current
    ) {
      for (const edgeLoop of getSelectedEdgeLoops(activeGeometry)) {
        for (const faceIndex of meshIndexRef.current.getWallFacesForEdgeLoop(edgeLoop)) {
          nextSelected.add(faceIndex);
        }
      }
    }

    const hovered = new Set(prevHoveredFacesRef.current);
    const hoverColor =
      selectionSubMode === 'bottom-face' ? FACE_COLORS.hoverBottom : FACE_COLORS.hover;

    let nextInvalid = new Set<number>();
    if (
      activeOperationType === 'helix' &&
      activeOperationSettings &&
      meshIndexRef.current
    ) {
      nextInvalid = collectInvalidHelixHoleFaces(
        getSelectedHoles(activeGeometry),
        activeOperationSettings,
        cutZContext,
        meshIndexRef.current
      );
    }

    colorManager.updateSelectionDiff(
      prevSelectedRef.current,
      nextSelected,
      hovered,
      selectedColor,
      hoverColor,
      nextInvalid
    );
    colorManager.updateInvalidDiff(
      prevInvalidRef.current,
      nextInvalid,
      nextSelected,
      hovered,
      selectedColor,
      hoverColor
    );
    colorAttr.needsUpdate = true;
    prevSelectedRef.current = nextSelected;
    prevInvalidRef.current = nextInvalid;
    invalidFacesRef.current = nextInvalid;
    selectedFacesRef.current = nextSelected;
  }, [
    activeGeometry?.faceIndices,
    activeGeometry,
    activeOperationType,
    activeOperationSettings,
    cutZContext,
    selectedColor,
    selectionSubMode,
  ]);

  useEffect(() => {
    prevSelectedRef.current = new Set();
    prevInvalidRef.current = new Set();
    invalidFacesRef.current = new Set();
    prevHoveredFacesRef.current = [];
    lastHoverKeyRef.current = '';
  }, [meshKey]);

  const resolveHoverGroup = useCallback(
    (faceIndex: number | null, point: THREE.Vector3 | null): SelectionGroup | null => {
      const meshIndex = meshIndexRef.current;
      if (!meshIndex || faceIndex === null) return null;

      if (selectionSubModeRef.current === 'bottom-face') {
        const region = meshIndex.getRegion(faceIndex);
        if (!region) return null;
        const outline = meshIndex.getOutlineLoop(region);
        return {
          faceIndices: region.faceIndices,
          loops: outline ? [outline] : region.loops,
          outerLoop: outline ?? region.outerLoop,
        };
      }

      const opType = activeOperationTypeRef.current;
      if (!opType) return null;

      if (isHoleSelectableForOperation(opType)) {
        return meshIndex.resolveSelection(faceIndex, opType, point ?? undefined);
      }

      if (isEdgeLoopSelectableForOperation(opType)) {
        return meshIndex.resolveSelection(faceIndex, opType, point ?? undefined);
      }

      const region = meshIndex.getRegion(faceIndex);
      if (!region || !isRegionSelectableForOperation(opType, region, meshIndex.bounds)) {
        return null;
      }

      return meshIndex.resolveSelection(faceIndex, opType, point ?? undefined);
    },
    []
  );

  const lastHoverKeyRef = useRef('');

  const applyHover = useCallback(
    (faceIndex: number | null, point: THREE.Vector3 | null) => {
      const meshIndex = meshIndexRef.current;
      const colorManager = colorManagerRef.current;
      const colorAttr = colorAttrRef.current;
      if (!meshIndex || !colorManager || !colorAttr) return;

      const group = resolveHoverGroup(faceIndex, point);
      const nextFaces = group?.faceIndices ?? [];
      const hoverKey = `${faceIndex}:${nextFaces.length}:${selectionSubModeRef.current}`;

      if (hoverKey === lastHoverKeyRef.current) return;
      lastHoverKeyRef.current = hoverKey;

      const prevFaces = prevHoveredFacesRef.current;
      const hoverColor =
        selectionSubModeRef.current === 'bottom-face'
          ? FACE_COLORS.hoverBottom
          : FACE_COLORS.hover;

      colorManager.updateHoverRegion(
        prevFaces,
        nextFaces,
        selectedFacesRef.current,
        selectedColorRef.current,
        hoverColor,
        invalidFacesRef.current
      );
      colorAttr.needsUpdate = true;

      hoveredRegionIdRef.current = faceIndex !== null ? meshIndex.getRegionId(faceIndex) : -1;
      prevHoveredFacesRef.current = nextFaces;

      setHoveredLoops(group && group.loops.length > 0 ? group.loops : []);
    },
    [resolveHoverGroup]
  );

  useEffect(() => {
    lastHoverKeyRef.current = '';
    if (!selectionMode) {
      prevHoveredFacesRef.current = [];
      applyHover(null, null);
    }
  }, [selectionSubMode, selectionMode, applyHover]);

  useFrame(() => {
    if (!selectionModeRef.current || selectionSubModeRef.current === 'entry-point') return;

    const mesh = meshRef.current;
    const meshIndex = meshIndexRef.current;
    if (!mesh || !meshIndex) return;

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(mesh, false);
    if (hits.length > 0 && hits[0].faceIndex !== undefined && hits[0].faceIndex !== null) {
      pickScratch.copy(hits[0].point);
      applyHover(hits[0].faceIndex, pickScratch);
      return;
    }

    applyHover(null, null);
  });

  const handlePointerMove = useCallback(
    (event: { stopPropagation: () => void; faceIndex?: number; point: THREE.Vector3 }) => {
      if (!selectionMode || selectionSubMode === 'entry-point') return;
      event.stopPropagation();
      applyHover(event.faceIndex ?? null, event.point);
    },
    [selectionMode, selectionSubMode, applyHover]
  );

  const handlePointerOut = useCallback(() => {
    if (!selectionMode || selectionSubMode === 'entry-point') return;
    applyHover(null, null);
  }, [selectionMode, selectionSubMode, applyHover]);

  const applyBottomFace = useCallback(
    (faceIndex: number) => {
      const meshIndex = meshIndexRef.current;
      if (!meshIndex) return;

      const region = meshIndex.getRegion(faceIndex);
      if (!region) return;

      setSelectionMode(false);

      // Face already rests on the build plate — skip re-orienting to avoid vertex drift
      // that breaks coplanar region detection for operations.
      if (region.normal.z < -0.95) {
        return;
      }

      clearMeshIndexCache(processedGeometry);

      const normal = new THREE.Vector3(region.normal.x, region.normal.y, region.normal.z);
      const rotated = orientFaceToBottom(processedGeometry, normal);
      const newMesh = finalizePartPlacement(rotated);
      createFaceColorAttribute(newMesh.geometry);

      onOrientationCommitted(newMesh.geometry);
      onMeshUpdate(newMesh);

      useAppStore.setState({
        partRotationZ: 0,
        operations: useAppStore.getState().operations.map((op) => ({ ...op, geometry: null })),
      });
      regenerateToolpaths();
    },
    [processedGeometry, onMeshUpdate, onOrientationCommitted, setSelectionMode, regenerateToolpaths]
  );

  const applyGeometrySelection = useCallback(
    (group: SelectionGroup, operationType: OperationType) => {
      if (!activeOperationId || !meshIndexRef.current) return;

      const op = useAppStore.getState().operations.find((o) => o.id === activeOperationId);
      const existing = op?.geometry;

      if (operationType === 'drill' || operationType === 'helix') {
        const hole =
          group.holeId !== undefined
            ? meshIndexRef.current.holes.find((h) => h.id === group.holeId)
            : null;

        let center = hole?.center;
        let radius = hole?.radius;
        const loop = group.loops?.[0];
        if ((!center || !radius) && loop?.length) {
          center = loopCentroid(loop);
          let rSum = 0;
          for (const p of loop) {
            rSum += Math.hypot(p.x - center.x, p.y - center.y);
          }
          radius = rSum / loop.length;
        }
        if (!center || !radius) return;

        const candidate = {
          center,
          radius,
          loop,
          holeId: hole?.id,
          topZ: hole?.topZ,
          bottomZ: hole?.bottomZ,
        };
        const existingHoles = getSelectedHoles(existing);

        if (isHoleInSelection(existingHoles, candidate)) {
          const holes = existingHoles.filter((h) => !isHoleInSelection([h], candidate));
          setOperationGeometry(
            activeOperationId,
            holes.length > 0
              ? {
                  faceIndices: existing?.faceIndices ?? [],
                  vertexIndices: existing?.vertexIndices ?? [],
                  holes,
                  loops: holes.map((h) => h.loop).filter((l): l is LoopPoint[] => !!l?.length),
                }
              : null
          );
        } else {
          setOperationGeometry(activeOperationId, {
            faceIndices: existing?.faceIndices ?? [],
            vertexIndices: existing?.vertexIndices ?? [],
            holes: [...existingHoles, candidate],
            loops: [...existingHoles.map((h) => h.loop).filter(Boolean), loop].filter(
              (l): l is LoopPoint[] => !!l?.length
            ),
          });
        }
        return;
      }

      if (
        operationType === 'outline' ||
        operationType === 'adaptive-outline'
      ) {
        const loop = group.loops?.[0];
        if (!loop?.length || group.topZ === undefined || group.bottomZ === undefined) return;

        const candidate = {
          loop,
          faceIndices: group.faceIndices,
          topZ: group.topZ,
          bottomZ: group.bottomZ,
          edgeLoopId: group.edgeLoopId,
          offsetSign: group.offsetSign,
          wallSide: group.wallSide,
        };
        const existingEdgeLoops = getSelectedEdgeLoops(existing);

        if (isEdgeLoopInSelection(existingEdgeLoops, candidate)) {
          const edgeLoops = existingEdgeLoops.filter((el) => !isEdgeLoopInSelection([el], candidate));
          setOperationGeometry(
            activeOperationId,
            edgeLoops.length > 0
              ? {
                  faceIndices: [...new Set(edgeLoops.flatMap((el) => el.faceIndices))],
                  vertexIndices: collectVertexIndices(
                    meshIndexRef.current,
                    [...new Set(edgeLoops.flatMap((el) => el.faceIndices))]
                  ),
                  edgeLoops,
                  loops: edgeLoops.map((el) => el.loop),
                  toolStartPoint: existing?.toolStartPoint,
                  slotJoinPoint: existing?.slotJoinPoint,
                }
              : null
          );
        } else {
          const edgeLoops = [...existingEdgeLoops, candidate];
          const faceIndices = [...new Set(edgeLoops.flatMap((el) => el.faceIndices))];
          setOperationGeometry(activeOperationId, {
            faceIndices,
            vertexIndices: collectVertexIndices(meshIndexRef.current, faceIndices),
            edgeLoops,
            loops: edgeLoops.map((el) => el.loop),
            toolStartPoint: existing?.toolStartPoint,
            slotJoinPoint: existing?.slotJoinPoint,
          });
        }
        return;
      }

      if (existing && isGroupSelected(existing.faceIndices, group.faceIndices)) {
        const { faceIndices, loops } = removeGroupFromSelection(
          existing.faceIndices,
          existing.loops,
          group.faceIndices,
          group.loops
        );
        const vertexIndices = collectVertexIndices(meshIndexRef.current, faceIndices);
        const surfaceSamples =
          op?.type === 'contour' && faceIndices.length > 0
            ? meshIndexRef.current.sampleSurfacePoints(faceIndices)
            : undefined;
        setOperationGeometry(
          activeOperationId,
          faceIndices.length > 0
            ? {
                faceIndices,
                vertexIndices,
                loops,
                surfaceSamples,
                entryPoint: existing.entryPoint,
                toolStartPoint: existing.toolStartPoint,
                slotJoinPoint: existing.slotJoinPoint,
                holeCenter: undefined,
                holeRadius: undefined,
                holeId: undefined,
              }
            : null
        );
        return;
      }

      const faceIndices = [...new Set([...(existing?.faceIndices ?? []), ...group.faceIndices])];
      const loops =
        op && isOutlineOperation(op)
          ? mergeLoops(existing?.loops, group.loops)
          : existing?.loops;
      const vertexIndices = collectVertexIndices(meshIndexRef.current, faceIndices);
      const surfaceSamples =
        op?.type === 'contour'
          ? meshIndexRef.current.sampleSurfacePoints(faceIndices)
          : existing?.surfaceSamples;

      setOperationGeometry(activeOperationId, {
        faceIndices,
        vertexIndices,
        loops: loops && loops.length > 0 ? loops : group.loops,
        surfaceSamples,
        entryPoint: existing?.entryPoint,
        toolStartPoint: existing?.toolStartPoint,
        slotJoinPoint: existing?.slotJoinPoint,
      });
    },
    [activeOperationId, setOperationGeometry]
  );

  const handleClick = useCallback(
    (event: { stopPropagation: () => void; faceIndex?: number; point: THREE.Vector3 }) => {
      if (!selectionMode || !meshIndexRef.current) return;
      event.stopPropagation();

      const faceIndex = event.faceIndex ?? 0;

      if (selectionSubMode === 'bottom-face') {
        applyBottomFace(faceIndex);
        return;
      }

      if (selectionSubMode !== 'geometry' || !activeOperationId || !activeOperationType) return;

      const group = meshIndexRef.current.resolveSelection(
        faceIndex,
        activeOperationType,
        event.point
      );
      if (!group) return;

      applyGeometrySelection(group, activeOperationType);
    },
    [
      selectionMode,
      selectionSubMode,
      activeOperationId,
      activeOperationType,
      applyBottomFace,
      applyGeometrySelection,
    ]
  );

  return (
    <>
      <mesh
        ref={meshRef}
        geometry={processedGeometry}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <meshStandardMaterial
          vertexColors
          metalness={0.25}
          roughness={0.55}
          side={THREE.FrontSide}
        />
      </mesh>

      {selectionMode && hoveredLoops.length > 0 && (
        <SelectionLoopLines
          loops={hoveredLoops}
          color={selectionSubMode === 'bottom-face' ? '#f59e0b' : '#93c5fd'}
          opacity={0.85}
        />
      )}

      {validHelixLoops.length > 0 && (
        <SelectionLoopLines loops={validHelixLoops} color={accentColor} opacity={1} />
      )}
      {invalidHelixLoops.length > 0 && (
        <SelectionLoopLines loops={invalidHelixLoops} color="#ef4444" opacity={1} />
      )}
      {activeOperationType !== 'helix' && selectedLoops.length > 0 && (
        <SelectionLoopLines loops={selectedLoops} color={accentColor} opacity={1} />
      )}
    </>
  );
}

function ToolpathWindowLive({
  visiblePaths,
  totalDistance,
  colorMode,
  operations,
  travelFeedRate,
  typeVisibility,
}: {
  visiblePaths: ToolpathSegment[];
  totalDistance: number;
  colorMode: ToolpathColorMode;
  operations: Operation[];
  travelFeedRate: number;
  typeVisibility: ToolpathTypeVisibility;
}) {
  const [windowFrac, setWindowFrac] = useState(getEffectiveSimulationWindow);
  const lastKeyRef = useRef('');

  useFrame(() => {
    const w = getEffectiveSimulationWindow();
    const key = `${w.start}:${w.end}`;
    if (key !== lastKeyRef.current) {
      lastKeyRef.current = key;
      setWindowFrac(w);
    }
  });

  const previewPaths = useMemo(() => {
    const isFullWindow = windowFrac.start <= 1e-4 && windowFrac.end >= 1 - 1e-4;
    if (isFullWindow) return visiblePaths;
    const start = windowFrac.start * totalDistance;
    const end = windowFrac.end * totalDistance;
    return filterToolpathSegmentsByDistance(visiblePaths, start, end);
  }, [visiblePaths, totalDistance, windowFrac.start, windowFrac.end]);

  return (
    <ToolpathLines
      segments={previewPaths}
      colorMode={colorMode}
      operations={operations}
      travelFeedRate={travelFeedRate}
      typeVisibility={typeVisibility}
    />
  );
}

function SimulationLayer({
  timeline,
  previewFeedRate,
  previewToolDiameter,
}: {
  timeline: ReturnType<typeof buildSimulationTimeline>;
  previewFeedRate: number;
  previewToolDiameter: number;
}) {
  const simulationPlaying = useAppStore((s) => s.simulationPlaying);
  const simulationSpeed = useAppStore((s) => s.simulationSpeed);

  if (timeline.samples.length === 0) return null;

  return (
    <>
      <ToolPreviewLive timeline={timeline} toolDiameter={previewToolDiameter} />
      <ToolSimulationDriver
        playing={simulationPlaying}
        speed={simulationSpeed}
        feedRate={previewFeedRate}
        rapidFeedRate={PREVIEW_RAPID_FEED}
        timeline={timeline}
      />
    </>
  );
}

function SceneContent({
  processedMesh,
  meshKey,
  onMeshUpdate,
  onOrientationCommitted,
  onIndexReady,
}: {
  processedMesh: ProcessedMesh;
  meshKey: number;
  onMeshUpdate: (mesh: ProcessedMesh) => void;
  onOrientationCommitted: (geometry: THREE.BufferGeometry) => void;
  onIndexReady: (ready: boolean, regionCount?: number) => void;
}) {
  const toolpaths = useAppStore((s) => s.toolpaths);
  const operations = useAppStore((s) => s.operations);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const selectionSubMode = useAppStore((s) => s.selectionSubMode);
  const activeOperationId = useAppStore((s) => s.activeOperationId);
  const partBounds = useAppStore((s) => s.partBounds);
  const toolOrigin = useSettingsStore((s) => s.toolOrigin);
  const safeHeight = useSettingsStore((s) => s.safeHeight);
  const updateOperation = useAppStore((s) => s.updateOperation);
  const toolpathResolution = useSettingsStore((s) => s.toolpathResolution);
  const travelFeedRate = useSettingsStore((s) => s.travelFeedRate);
  const toolpathColorMode = useAppStore((s) => s.toolpathColorMode);
  const toolpathTypeVisibility = useAppStore((s) => s.toolpathTypeVisibility);
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const viewerColors = viewerThemeColors(uiTheme);
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const visiblePaths = useMemo(
    () =>
      buildVisiblePreviewToolpaths(
        toolpaths,
        operations,
        toolOrigin,
        partBounds?.maxZ ?? 0,
        safeHeight
      ),
    [toolpaths, operations, toolOrigin, partBounds?.maxZ, safeHeight]
  );

  const simulationTimeline = useMemo(
    () => buildSimulationTimeline(visiblePaths),
    [visiblePaths]
  );

  const previewToolDiameter = useMemo(
    () => pickPreviewToolDiameter(operations, visiblePaths),
    [operations, visiblePaths]
  );

  const adaptiveDebugGuides = useMemo(() => {
    if (!partBounds) return null;
    const globals = {
      safeHeight,
      resolution: toolpathResolution,
      travelFeedRate,
      toolOrigin,
    };
    const adaptiveOps = operations.filter(
      (op) => op.visible && op.enabled && isAdaptiveOutlineOperation(op) && op.geometry?.loops?.[0]
    );
    if (adaptiveOps.length === 0) return null;

    const active =
      adaptiveOps.find((op) => op.id === activeOperationId) ?? adaptiveOps[0];
    return computeAdaptiveOutlineDebugGuidesFromBounds(active, partBounds, globals);
  }, [
    operations,
    activeOperationId,
    partBounds,
    safeHeight,
    toolpathResolution,
    travelFeedRate,
    toolOrigin,
  ]);

  const adaptiveEntry = useMemo(() => {
    if (!partBounds) return null;
    const op = operations.find(
      (o) =>
        o.id === activeOperationId &&
        (isOutlineHelixEntryOperation(o) || isStandardOutlineEntryEditable(o)) &&
        o.geometry?.loops?.[0]
    );
    if (!op?.geometry?.loops?.[0]) return null;

    const loop = op.geometry.loops[0];
    const isAdaptive = isAdaptiveOutlineOperation(op);

    if (isAdaptive) {
      const segLen = minkowskiSegmentLen(toolpathResolution);
      const roughSlot = resolveAdaptiveSlotGeometry(op.settings, { roughing: true });
      const trochSampleSpacing = trochoidSampleSpacing(
        roughSlot.forwardIncrement,
        roughSlot.trochoidRadius,
        toolpathResolution
      );
      const offsetContext = resolveOutlineOffsetContext(op.geometry, loop);
      const layout = resolveAdaptiveEntryLayout(
        loop,
        op.settings,
        adaptiveEntryOverridesFromGeometry(op.geometry),
        segLen,
        trochSampleSpacing,
        toolpathResolution,
        toolOrigin,
        offsetContext
      );
      if (!layout) return null;

      const slotArcGuide = buildSlotCenterlineArcGuide(loop, op.settings, {
        safeHeight,
        resolution: toolpathResolution,
        travelFeedRate,
      }, op.geometry);

      return {
        op,
        layout,
        slotArcGuide,
        toolStartArcGuide: undefined,
        showSlotJoin: true,
        toolStartManual: !!(op.geometry.toolStartPoint ?? op.geometry.entryPoint),
        slotJoinManual: !!op.geometry.slotJoinPoint,
      };
    }

    const stockAllowance = finishingStockAllowance(op.settings);
    const sampleSpacing = pathSampleSpacing(toolpathResolution);
    const segLen = minkowskiSegmentLen(toolpathResolution);
    const layout = resolveStandardEntryLayout(
      loop,
      op.settings,
      stockAllowance,
      op.geometry,
      sampleSpacing,
      segLen,
      toolOrigin
    );
    if (!layout) return null;

    const offsetContext = resolveOutlineOffsetContext(op.geometry, loop);
    const slotArcGuide = buildOutlineEntryArcGuide(
      loop,
      op.settings,
      stockAllowance,
      sampleSpacing,
      offsetContext
    );

    return {
      op,
      layout: { toolStart: layout.toolStart, slotJoin: layout.contourJoin },
      slotArcGuide,
      toolStartArcGuide: undefined,
      showSlotJoin: true,
      toolStartManual: !!(op.geometry.toolStartPoint ?? op.geometry.entryPoint),
      slotJoinManual: !!op.geometry.slotJoinPoint,
    };
  }, [
    operations,
    activeOperationId,
    partBounds,
    safeHeight,
    toolpathResolution,
    travelFeedRate,
    toolOrigin,
  ]);

  const handleToolStartChange = useCallback(
    (point: { x: number; y: number }) => {
      if (!adaptiveEntry?.op.geometry) return;
      const loop = adaptiveEntry.op.geometry.loops?.[0];
      if (!loop) return;
      const offsetContext = resolveOutlineOffsetContext(adaptiveEntry.op.geometry, loop);
      const constrained = resolveAdaptiveEntryPoint(
        loop,
        adaptiveEntry.op.settings,
        point,
        toolOrigin,
        offsetContext.offsetSign,
        offsetContext.wallSide
      );
      updateOperation(adaptiveEntry.op.id, {
        geometry: {
          ...adaptiveEntry.op.geometry,
          toolStartPoint: constrained,
          entryPoint: undefined,
        },
      });
    },
    [adaptiveEntry, updateOperation, toolOrigin]
  );

  const handleSlotJoinChange = useCallback(
    (point: { x: number; y: number }) => {
      if (!adaptiveEntry?.op.geometry) return;
      const loop = adaptiveEntry.op.geometry.loops?.[0];
      let next = point;
      if (loop && adaptiveEntry.slotArcGuide) {
        if (isStandardOutlineEntryEditable(adaptiveEntry.op)) {
          next = snapPointToOutlineCenterline(adaptiveEntry.slotArcGuide, point);
        } else {
          next = snapPointToSlotCenterline(adaptiveEntry.slotArcGuide, point);
        }
      }
      updateOperation(adaptiveEntry.op.id, {
        geometry: {
          ...adaptiveEntry.op.geometry,
          slotJoinPoint: { x: next.x, y: next.y },
        },
      });
    },
    [adaptiveEntry, updateOperation]
  );

  const snapEntryToolStart = useCallback(
    (x: number, y: number) => {
      if (!adaptiveEntry?.op.geometry?.loops?.[0]) return { x, y };
      const loop = adaptiveEntry.op.geometry.loops[0];
      const offsetContext = resolveOutlineOffsetContext(adaptiveEntry.op.geometry, loop);
      return resolveAdaptiveEntryPoint(
        loop,
        adaptiveEntry.op.settings,
        { x, y },
        toolOrigin,
        offsetContext.offsetSign,
        offsetContext.wallSide
      );
    },
    [adaptiveEntry, toolOrigin]
  );

  const snapEntrySlotJoin = useCallback(
    (x: number, y: number) => {
      if (!adaptiveEntry?.slotArcGuide) return { x, y };
      if (isStandardOutlineEntryEditable(adaptiveEntry.op)) {
        return snapPointToOutlineCenterline(adaptiveEntry.slotArcGuide, { x, y });
      }
      return snapPointToSlotCenterline(adaptiveEntry.slotArcGuide, { x, y });
    },
    [adaptiveEntry]
  );

  const previewFeedRate = useMemo(() => {
    const visible = operations.filter((o) => o.visible);
    if (visible.length === 0) return 1200;
    const op = visible.find((o) => o.id === activeOperationId) ?? visible[0];
    return op.settings.feedRate;
  }, [operations, activeOperationId]);

  return (
    <>
      <ambientLight intensity={viewerColors.ambientLight} />
      <directionalLight position={[50, 50, 80]} intensity={viewerColors.keyLight} />
      <directionalLight position={[-30, -40, 40]} intensity={viewerColors.fillLight} />
      <Grid
        args={[200, 200]}
        cellSize={5}
        cellThickness={0.5}
        cellColor={viewerColors.gridCell}
        sectionSize={25}
        sectionThickness={1}
        sectionColor={viewerColors.gridSection}
        fadeDistance={300}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
      />
      <StlMesh
        processedMesh={processedMesh}
        meshKey={meshKey}
        onMeshUpdate={onMeshUpdate}
        onOrientationCommitted={onOrientationCommitted}
        onIndexReady={onIndexReady}
      />
      <ToolpathWindowLive
        visiblePaths={visiblePaths}
        totalDistance={simulationTimeline.totalDistance}
        colorMode={toolpathColorMode}
        operations={operations}
        travelFeedRate={travelFeedRate}
        typeVisibility={toolpathTypeVisibility}
      />
      {adaptiveDebugGuides && toolpathTypeVisibility.reference && (
        <DebugGuideLines
          slotCenterline={adaptiveDebugGuides.slotCenterline}
          leadInGuide={adaptiveDebugGuides.leadInGuide}
          slotCenterlineOpen={adaptiveDebugGuides.slotCenterlineOpen}
        />
      )}
      {adaptiveEntry && partBounds && selectionMode && selectionSubMode === 'entry-point' && (
        <AdaptiveEntryHandles
          toolStart={adaptiveEntry.layout.toolStart}
          slotJoin={adaptiveEntry.layout.slotJoin}
          topZ={partBounds.maxZ}
          toolStartManual={adaptiveEntry.toolStartManual}
          slotJoinManual={adaptiveEntry.slotJoinManual}
          showSlotJoin={adaptiveEntry.showSlotJoin}
          snapToolStart={snapEntryToolStart}
          snapSlotJoin={snapEntrySlotJoin}
          onToolStartChange={handleToolStartChange}
          onSlotJoinChange={handleSlotJoinChange}
        />
      )}
      <SimulationLayer
        timeline={simulationTimeline}
        previewFeedRate={previewFeedRate}
        previewToolDiameter={previewToolDiameter}
      />
      <ToolOriginMarker origin={toolOrigin} stockTopWorldZ={partBounds?.maxZ ?? 0} />
      <ViewportCameraSync partBounds={partBounds} controlsRef={controlsRef} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.1}
        enableRotate
        enablePan={!selectionMode}
        mouseButtons={
          selectionMode
            ? {
                LEFT: null as unknown as THREE.MOUSE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.ROTATE,
              }
            : {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN,
              }
        }
      />
      <GizmoHelper alignment="top-right" margin={[56, 48]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="white" />
      </GizmoHelper>
    </>
  );
}

export function StlViewer() {
  const stlUrl = useAppStore((s) => s.stlUrl);
  const partBounds = useAppStore((s) => s.partBounds);
  const toolpaths = useAppStore((s) => s.toolpaths);
  const operations = useAppStore((s) => s.operations);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const selectionSubMode = useAppStore((s) => s.selectionSubMode);
  const activeOperationType = useAppStore((s) => {
    const id = s.activeOperationId;
    if (!id) return null;
    return s.operations.find((o) => o.id === id)?.type ?? null;
  });

  const toolOrigin = useSettingsStore((s) => s.toolOrigin);
  const safeHeight = useSettingsStore((s) => s.safeHeight);
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const viewerColors = viewerThemeColors(uiTheme);

  const { processedMesh, meshKey, loading, loadError, updateMesh, commitOrientationSource } =
    useProcessedStl(stlUrl);

  const visiblePaths = useMemo(
    () =>
      buildVisiblePreviewToolpaths(
        toolpaths,
        operations,
        toolOrigin,
        partBounds?.maxZ ?? 0,
        safeHeight
      ),
    [toolpaths, operations, toolOrigin, partBounds?.maxZ, safeHeight]
  );

  const [indexStatus, setIndexStatus] = useState<{ ready: boolean; regions?: number }>({
    ready: false,
  });
  const [webglReady, setWebglReady] = useState<boolean | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const stlUrlRef = useRef(stlUrl);

  useEffect(() => {
    stlUrlRef.current = stlUrl;
  }, [stlUrl]);

  useEffect(() => {
    const result = detectWebGLSupport();
    setWebglReady(result.supported);
    setWebglError(result.supported ? null : (result.message ?? 'WebGL is not available.'));
  }, []);

  useEffect(() => {
    if (!stlUrl) {
      setIndexStatus({ ready: false });
      return;
    }

    setIndexStatus({ ready: false });
    const result = detectWebGLSupport();
    if (result.supported) {
      setWebglReady(true);
      setWebglError(null);
    } else {
      setWebglReady(false);
      setWebglError(result.message ?? 'WebGL is not available.');
    }
  }, [stlUrl]);

  useEffect(() => {
    if (webglReady === false && processedMesh) {
      setIndexStatus({ ready: true });
    }
  }, [webglReady, processedMesh]);

  const handleIndexReady = useCallback((ready: boolean, regionCount?: number) => {
    setIndexStatus({ ready, regions: regionCount });
  }, []);

  const handleWebglCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    const canvas = gl.domElement;
    const onLost = (event: Event) => {
      event.preventDefault();
      if (!stlUrlRef.current) return;
      setWebglReady(false);
      setWebglError(
        'WebGL context was lost. Reload the page or close other 3D tabs, then try again.'
      );
    };
    canvas.addEventListener('webglcontextlost', onLost, false);
  }, []);

  const handleWebglRetry = useCallback(() => {
    const result = detectWebGLSupport();
    if (result.supported) {
      setWebglReady(true);
      setWebglError(null);
      return;
    }
    setWebglReady(false);
    setWebglError(result.message ?? 'WebGL is still unavailable.');
  }, []);

  const selectionHint = getSelectionHint(activeOperationType, selectionSubMode);

  return (
    <div className={`stl-viewer ${selectionMode ? 'selection-active' : ''}`}>
      {!stlUrl && (
        <div className="viewer-placeholder">
          <p>Upload an STL file to begin</p>
          <p className="viewer-axis-hint">Z+ up · build plate at Z=0 · top of part at +Z</p>
        </div>
      )}
      {stlUrl && loading && (
        <div className="viewer-processing">
          <p>Loading part…</p>
        </div>
      )}
      {loadError && (
        <div className="viewer-processing">
          <p>{loadError}</p>
        </div>
      )}
      {stlUrl && !loading && !loadError && webglReady && !indexStatus.ready && (
        <div className="viewer-processing">
          <p>Analyzing mesh geometry…</p>
        </div>
      )}
      {stlUrl && webglReady === false && (
        <div className="viewer-fallback-layout">
          <WebGLFallback
            message={webglError ?? 'WebGL is not available.'}
            onRetry={handleWebglRetry}
            show2dHint={!!processedMesh}
          />
          {processedMesh && partBounds && (
            <Viewer2D bounds={partBounds} toolpaths={visiblePaths} />
          )}
        </div>
      )}
      {webglReady && processedMesh && (
        <Canvas
          gl={createViewerRenderer as GLProps}
          dpr={[1, 1.5]}
          camera={{ fov: 45, near: 0.1, far: 1000, position: [60, -60, 60], up: [0, 0, 1] }}
          style={{
            background: viewerColors.background,
            cursor: selectionMode ? 'crosshair' : 'default',
          }}
          onCreated={handleWebglCreated}
        >
          <SceneContent
            processedMesh={processedMesh}
            meshKey={meshKey}
            onMeshUpdate={updateMesh}
            onOrientationCommitted={commitOrientationSource}
            onIndexReady={handleIndexReady}
          />
        </Canvas>
      )}
      {selectionMode && webglReady && indexStatus.ready && (
        <div className="selection-hint">{selectionHint} — right-drag to orbit</div>
      )}
      {webglReady && processedMesh && (
        <>
          <ToolpathColorControls />
          <button
          type="button"
          className="viewer-home-btn"
          onClick={() => goToViewerHome()}
          title="Top view — look straight down with Y up"
          aria-label="Reset camera to top view"
        >
          ⌂
        </button>
        </>
      )}
      <ToolSimulationControls />
    </div>
  );
}
