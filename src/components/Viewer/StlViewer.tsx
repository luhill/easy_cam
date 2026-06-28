import { useRef, useEffect, useMemo, useCallback, useState, Suspense } from 'react';
import { Canvas, useThree, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { STLLoader } from 'three-stdlib';
import * as THREE from 'three';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { OPERATION_COLORS, getSelectedHoles } from '../../types/operations';
import type { LoopPoint, OperationType } from '../../types/operations';
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
  processStlGeometry,
  loopCentroid,
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
import { ToolPreview, ToolSimulationDriver } from './ToolPreview';
import { ToolSimulationControls } from './ToolSimulationControls';
import {
  buildSimulationTimeline,
  sampleSimulationTimeline,
  pickPreviewToolDiameter,
  PREVIEW_RAPID_FEED,
} from '../../lib/toolpathSimulation';
import { SelectionLoopLines } from './SelectionLoopLines';
import { ToolOriginMarker } from './ToolOriginMarker';
import { EntryPointMarker, StockTopPlane } from './EntryPointMarker';
import { resolveAdaptiveEntryPoint } from '../../lib/adaptiveOutline';

interface StlMeshProps {
  processedMesh: ProcessedMesh;
  meshKey: number;
  onMeshUpdate: (mesh: ProcessedMesh) => void;
  onIndexReady: (ready: boolean, regionCount?: number) => void;
}

function StlMesh({ processedMesh, meshKey, onMeshUpdate, onIndexReady }: StlMeshProps) {
  const activeOperationId = useAppStore((s) => s.activeOperationId);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const selectionSubMode = useAppStore((s) => s.selectionSubMode);
  const setSelectionSubMode = useAppStore((s) => s.setSelectionSubMode);
  const setSelectionMode = useAppStore((s) => s.setSelectionMode);
  const setPartBounds = useAppStore((s) => s.setPartBounds);
  const setToolOriginFromBounds = useSettingsStore((s) => s.setToolOriginFromBounds);
  const regenerateToolpaths = useAppStore((s) => s.regenerateToolpaths);

  const activeGeometry = useAppStore((s) => {
    if (!s.activeOperationId) return null;
    return s.operations.find((o) => o.id === s.activeOperationId)?.geometry ?? null;
  });
  const activeOperationType = useAppStore((s) => {
    if (!s.activeOperationId) return null;
    return s.operations.find((o) => o.id === s.activeOperationId)?.type ?? null;
  });
  const activeOperationSettings = useAppStore((s) => {
    if (!s.activeOperationId) return null;
    return s.operations.find((o) => o.id === s.activeOperationId)?.settings ?? null;
  });
  const setOperationGeometry = useAppStore((s) => s.setOperationGeometry);
  const updateOperation = useAppStore((s) => s.updateOperation);

  const processedGeometry = processedMesh.geometry;
  const partBounds = processedMesh.bounds;

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
  const entryPoint = useMemo(() => {
    if (activeOperationType !== 'adaptive-outline') return null;
    const loop = activeGeometry?.loops?.[0];
    if (!loop || loop.length < 2 || !activeOperationSettings) return null;
    return resolveAdaptiveEntryPoint(loop, activeOperationSettings, activeGeometry?.entryPoint);
  }, [activeOperationType, activeGeometry, activeOperationSettings]);
  const entryPointIsAuto =
    activeOperationType === 'adaptive-outline' && !activeGeometry?.entryPoint && !!entryPoint;
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
    setPartBounds(partBounds);
    setToolOriginFromBounds(partBounds);
  }, [partBounds, setPartBounds, setToolOriginFromBounds]);

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

      clearMeshIndexCache(processedGeometry);

      const normal = new THREE.Vector3(region.normal.x, region.normal.y, region.normal.z);
      const rotated = orientFaceToBottom(processedGeometry, normal);
      const newMesh = finalizePartPlacement(rotated);
      createFaceColorAttribute(newMesh.geometry);

      onMeshUpdate(newMesh);
      setSelectionMode(false);
      regenerateToolpaths();
    },
    [processedGeometry, onMeshUpdate, setSelectionMode, regenerateToolpaths]
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

  const handleEntryPick = useCallback(
    (x: number, y: number) => {
      if (!activeOperationId) return;
      const op = useAppStore.getState().operations.find((o) => o.id === activeOperationId);
      const existing = op?.geometry;
      updateOperation(activeOperationId, {
        geometry: existing
          ? { ...existing, entryPoint: { x, y } }
          : {
              faceIndices: [],
              vertexIndices: [],
              entryPoint: { x, y },
            },
      });
      setSelectionSubMode('geometry');
    },
    [activeOperationId, updateOperation, setSelectionSubMode]
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

      <StockTopPlane
        active={selectionMode && selectionSubMode === 'entry-point'}
        bounds={partBounds}
        topZ={partBounds.maxZ}
        onPick={handleEntryPick}
      />

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

      {entryPoint && (
        <EntryPointMarker
          point={entryPoint}
          topZ={partBounds.maxZ}
          color={entryPointIsAuto ? '#94a3b8' : '#f59e0b'}
        />
      )}
    </>
  );
}

function LoadedStl({
  url,
  onIndexReady,
}: {
  url: string;
  onIndexReady: (ready: boolean, regionCount?: number) => void;
}) {
  const rawGeometry = useLoader(STLLoader, url);
  const [processedMesh, setProcessedMesh] = useState<ProcessedMesh | null>(null);
  const [meshKey, setMeshKey] = useState(0);

  useEffect(() => {
    const mesh = processStlGeometry(rawGeometry);
    createFaceColorAttribute(mesh.geometry);
    setProcessedMesh(mesh);
    setMeshKey((k) => k + 1);
  }, [rawGeometry]);

  const handleMeshUpdate = useCallback((mesh: ProcessedMesh) => {
    setProcessedMesh(mesh);
    setMeshKey((k) => k + 1);
  }, []);

  if (!processedMesh) return null;

  return (
    <StlMesh
      processedMesh={processedMesh}
      meshKey={meshKey}
      onMeshUpdate={handleMeshUpdate}
      onIndexReady={onIndexReady}
    />
  );
}

function SceneContent({
  onIndexReady,
}: {
  onIndexReady: (ready: boolean, regionCount?: number) => void;
}) {
  const stlUrl = useAppStore((s) => s.stlUrl);
  const toolpaths = useAppStore((s) => s.toolpaths);
  const operations = useAppStore((s) => s.operations);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const simulationDistance = useAppStore((s) => s.simulationDistance);
  const simulationPlaying = useAppStore((s) => s.simulationPlaying);
  const simulationSpeed = useAppStore((s) => s.simulationSpeed);
  const setSimulationDistance = useAppStore((s) => s.setSimulationDistance);
  const setSimulationPlaying = useAppStore((s) => s.setSimulationPlaying);
  const activeOperationId = useAppStore((s) => s.activeOperationId);
  const toolOrigin = useSettingsStore((s) => s.toolOrigin);
  const { camera } = useThree();
  const simulationDistanceRef = useRef(simulationDistance);
  simulationDistanceRef.current = simulationDistance;

  useEffect(() => {
    camera.position.set(60, -60, 60);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
  }, [camera, stlUrl]);

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

  const simulationSample = useMemo(
    () => sampleSimulationTimeline(simulationTimeline, simulationDistance),
    [simulationTimeline, simulationDistance]
  );

  const previewToolDiameter = useMemo(
    () => pickPreviewToolDiameter(operations, visiblePaths),
    [operations, visiblePaths]
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
      {stlUrl && (
        <Suspense fallback={null}>
          <LoadedStl url={stlUrl} onIndexReady={onIndexReady} />
        </Suspense>
      )}
      <ToolpathLines segments={visiblePaths} />
      <ToolPreview sample={simulationSample} toolDiameter={previewToolDiameter} />
      <ToolSimulationDriver
        playing={simulationPlaying}
        speed={simulationSpeed}
        feedRate={previewFeedRate}
        rapidFeedRate={PREVIEW_RAPID_FEED}
        timeline={simulationTimeline}
        timelineLength={simulationTimeline.totalDistance}
        onDistanceChange={(distance) => {
          setSimulationDistance(distance);
          if (distance >= simulationTimeline.totalDistance) {
            setSimulationPlaying(false);
          }
        }}
        getDistance={() => simulationDistanceRef.current}
      />
      <ToolOriginMarker origin={toolOrigin} />
      <OrbitControls
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
      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
        <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="white" />
      </GizmoHelper>
    </>
  );
}

export function StlViewer() {
  const stlUrl = useAppStore((s) => s.stlUrl);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const selectionSubMode = useAppStore((s) => s.selectionSubMode);
  const activeOperationType = useAppStore((s) => {
    const id = s.activeOperationId;
    if (!id) return null;
    return s.operations.find((o) => o.id === id)?.type ?? null;
  });

  const [indexStatus, setIndexStatus] = useState<{ ready: boolean; regions?: number }>({
    ready: false,
  });

  const handleIndexReady = useCallback((ready: boolean, regionCount?: number) => {
    setIndexStatus({ ready, regions: regionCount });
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
      {stlUrl && !indexStatus.ready && (
        <div className="viewer-processing">
          <p>Analyzing mesh geometry…</p>
        </div>
      )}
      <Canvas
        camera={{ fov: 45, near: 0.1, far: 1000, position: [60, -60, 60], up: [0, 0, 1] }}
        style={{ background: '#0f1115', cursor: selectionMode ? 'crosshair' : 'default' }}
      >
        <SceneContent onIndexReady={handleIndexReady} />
      </Canvas>
      {selectionMode && indexStatus.ready && (
        <div className="selection-hint">{selectionHint} — right-drag to orbit</div>
      )}
      <ToolSimulationControls />
    </div>
  );
}
