import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import { Canvas, useThree, useFrame, type GLProps } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { OPERATION_COLORS, getSelectedHoles } from '../../types/operations';
import type { LoopPoint, OperationType, ToolpathSegment } from '../../types/operations';
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
  partDimensionsFromBounds,
  type PartBounds,
  type ProcessedMesh,
} from '../../lib/geometryProcessing';
import { getSelectionHint, isHoleSelectableForOperation, isRegionSelectableForOperation } from '../../lib/selectionRules';
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
} from '../../lib/adaptiveGuides';
import { minkowskiSegmentLen, trochoidSampleSpacing } from '../../lib/toolpathConfig';
import { resolveAdaptiveSlotGeometry } from '../../lib/adaptiveOutline';
import { createViewerRenderer, detectWebGLSupport } from '../../lib/webglSupport';
import { registerViewerCameraBridge, setTopDownHomeView, goToViewerHome } from '../../lib/viewerCamera';
import { WebGLFallback } from './WebGLFallback';
import { Viewer2D } from './Viewer2D';
import { useProcessedStl } from '../../hooks/useProcessedStl';
import { getEffectiveSimulationWindow } from '../../lib/simulationLiveBridge';

function fitCameraToPartBounds(camera: THREE.PerspectiveCamera, bounds: PartBounds | null): void {
  if (!bounds) {
    camera.position.set(60, -60, 60);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.far = 1000;
    camera.updateProjectionMatrix();
    return;
  }

  const dims = partDimensionsFromBounds(bounds);
  const maxDim = Math.max(dims.width, dims.depth, dims.height, 1);
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const distance = maxDim * 2.2;

  camera.position.set(distance, -distance, centerZ + distance * 0.75);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, centerZ);
  camera.far = Math.max(1000, distance * 8);
  camera.updateProjectionMatrix();
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
    return loops;
  }, [activeGeometry, activeOperationType]);
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
    const hovered = new Set(prevHoveredFacesRef.current);
    const hoverColor =
      selectionSubMode === 'bottom-face' ? FACE_COLORS.hoverBottom : FACE_COLORS.hover;

    colorManager.updateSelectionDiff(
      prevSelectedRef.current,
      nextSelected,
      hovered,
      selectedColor,
      hoverColor
    );
    colorAttr.needsUpdate = true;
    prevSelectedRef.current = nextSelected;
    selectedFacesRef.current = nextSelected;
  }, [activeGeometry?.faceIndices, selectedColor, selectionSubMode]);

  useEffect(() => {
    prevSelectedRef.current = new Set();
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
        hoverColor
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

      if (existing && isGroupSelected(existing.faceIndices, group.faceIndices)) {
        const { faceIndices, loops } = removeGroupFromSelection(
          existing.faceIndices,
          existing.loops,
          group.faceIndices,
          group.loops
        );
        const vertexIndices = collectVertexIndices(meshIndexRef.current, faceIndices);
        setOperationGeometry(
          activeOperationId,
          faceIndices.length > 0
            ? {
                faceIndices,
                vertexIndices,
                loops,
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
        operationType === 'outline' || operationType === 'adaptive-outline'
          ? mergeLoops(existing?.loops, group.loops)
          : existing?.loops;
      const vertexIndices = collectVertexIndices(meshIndexRef.current, faceIndices);

      setOperationGeometry(activeOperationId, {
        faceIndices,
        vertexIndices,
        loops: loops && loops.length > 0 ? loops : group.loops,
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

      {selectedLoops.length > 0 && (
        <SelectionLoopLines loops={selectedLoops} color={accentColor} opacity={1} />
      )}
    </>
  );
}

function ToolpathWindowLive({
  visiblePaths,
  totalDistance,
}: {
  visiblePaths: ToolpathSegment[];
  totalDistance: number;
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

  return <ToolpathLines segments={previewPaths} />;
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
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    registerViewerCameraBridge({
      goHome: () => {
        setTopDownHomeView(
          camera as THREE.PerspectiveCamera,
          controlsRef.current,
          partBounds
        );
      },
    });
    return () => registerViewerCameraBridge(null);
  }, [camera, partBounds]);

  const boundsKey = partBounds
    ? `${partBounds.minX}:${partBounds.maxX}:${partBounds.minY}:${partBounds.maxY}:${partBounds.minZ}:${partBounds.maxZ}`
    : null;

  useEffect(() => {
    fitCameraToPartBounds(camera as THREE.PerspectiveCamera, partBounds);
  }, [camera, boundsKey, partBounds]);

  const visiblePaths = useMemo(() => {
    const visibleIds = new Set(
      operations.filter((o) => o.visible).map((o) => o.id)
    );
    return toolpaths.filter((tp) => visibleIds.has(tp.operationId));
  }, [toolpaths, operations]);

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
    const globals = { safeHeight, resolution: toolpathResolution, travelFeedRate };
    const adaptiveOps = operations.filter(
      (op) => op.visible && op.enabled && op.type === 'adaptive-outline' && op.geometry?.loops?.[0]
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
  ]);

  const adaptiveEntry = useMemo(() => {
    if (!partBounds) return null;
    const op = operations.find(
      (o) =>
        o.id === activeOperationId &&
        o.type === 'adaptive-outline' &&
        o.geometry?.loops?.[0]
    );
    if (!op?.geometry?.loops?.[0]) return null;

    const loop = op.geometry.loops[0];
    const segLen = minkowskiSegmentLen(toolpathResolution);
    const roughSlot = resolveAdaptiveSlotGeometry(op.settings, { roughing: true });
    const trochSampleSpacing = trochoidSampleSpacing(
      roughSlot.forwardIncrement,
      roughSlot.trochoidRadius,
      toolpathResolution
    );
    const layout = resolveAdaptiveEntryLayout(
      loop,
      op.settings,
      adaptiveEntryOverridesFromGeometry(op.geometry),
      segLen,
      trochSampleSpacing,
      toolpathResolution
    );
    if (!layout) return null;

    const slotArcGuide = buildSlotCenterlineArcGuide(loop, op.settings, {
      safeHeight,
      resolution: toolpathResolution,
      travelFeedRate,
    });

    return {
      op,
      layout,
      slotArcGuide,
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
  ]);

  const handleToolStartChange = useCallback(
    (point: { x: number; y: number }) => {
      if (!adaptiveEntry?.op.geometry) return;
      updateOperation(adaptiveEntry.op.id, {
        geometry: {
          ...adaptiveEntry.op.geometry,
          toolStartPoint: point,
          entryPoint: undefined,
        },
      });
    },
    [adaptiveEntry, updateOperation]
  );

  const handleSlotJoinChange = useCallback(
    (point: { x: number; y: number }) => {
      if (!adaptiveEntry?.op.geometry) return;
      updateOperation(adaptiveEntry.op.id, {
        geometry: {
          ...adaptiveEntry.op.geometry,
          slotJoinPoint: point,
        },
      });
    },
    [adaptiveEntry, updateOperation]
  );

  const previewFeedRate = useMemo(() => {
    const visible = operations.filter((o) => o.visible);
    if (visible.length === 0) return 1200;
    const op = visible.find((o) => o.id === activeOperationId) ?? visible[0];
    return op.settings.feedRate;
  }, [operations, activeOperationId]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[50, 50, 80]} intensity={1.2} />
      <directionalLight position={[-30, -40, 40]} intensity={0.4} />
      <Grid
        args={[200, 200]}
        cellSize={5}
        cellThickness={0.5}
        cellColor="#2a2f38"
        sectionSize={25}
        sectionThickness={1}
        sectionColor="#3d4555"
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
      />
      {adaptiveDebugGuides && (
        <DebugGuideLines
          slotCenterline={adaptiveDebugGuides.slotCenterline}
          leadInGuide={adaptiveDebugGuides.leadInGuide}
        />
      )}
      {adaptiveEntry && partBounds && selectionMode && selectionSubMode === 'entry-point' && (
        <AdaptiveEntryHandles
          toolStart={adaptiveEntry.layout.toolStart}
          slotJoin={adaptiveEntry.layout.slotJoin}
          slotArcGuide={adaptiveEntry.slotArcGuide}
          topZ={partBounds.maxZ}
          toolStartManual={adaptiveEntry.toolStartManual}
          slotJoinManual={adaptiveEntry.slotJoinManual}
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

  const { processedMesh, meshKey, loading, loadError, updateMesh, commitOrientationSource } =
    useProcessedStl(stlUrl);

  const visiblePaths = useMemo(() => {
    const visibleIds = new Set(operations.filter((o) => o.visible).map((o) => o.id));
    return toolpaths.filter((tp) => visibleIds.has(tp.operationId));
  }, [toolpaths, operations]);

  const [indexStatus, setIndexStatus] = useState<{ ready: boolean; regions?: number }>({
    ready: false,
  });
  const [webglReady, setWebglReady] = useState<boolean | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  useEffect(() => {
    const result = detectWebGLSupport();
    setWebglReady(result.supported);
    setWebglError(result.supported ? null : (result.message ?? 'WebGL is not available.'));
  }, []);

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
      {webglReady === false && (
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
          style={{ background: '#0f1115', cursor: selectionMode ? 'crosshair' : 'default' }}
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
        <button
          type="button"
          className="viewer-home-btn"
          onClick={() => goToViewerHome()}
          title="Top view — look straight down with Y up"
          aria-label="Reset camera to top view"
        >
          ⌂
        </button>
      )}
      <ToolSimulationControls />
    </div>
  );
}
