import { useRef, useEffect, useMemo, useCallback, useState, Suspense } from 'react';
import { Canvas, useThree, useLoader } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { STLLoader } from 'three-stdlib';
import * as THREE from 'three';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { OPERATION_COLORS } from '../../types/operations';
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
  type ProcessedMesh,
} from '../../lib/geometryProcessing';
import { getSelectionHint } from '../../lib/selectionRules';
import {
  clearMeshIndexCache,
  collectVertexIndices,
  getMeshIndex,
  isGroupSelected,
  mergeLoops,
  removeGroupFromSelection,
  type MeshIndex,
  type SelectionGroup,
} from '../../lib/meshSelection';
import { ToolpathLines } from './ToolpathLines';
import { SelectionLoopLines } from './SelectionLoopLines';
import { ToolOriginMarker } from './ToolOriginMarker';
import { EntryPointMarker, StockTopPlane } from './EntryPointMarker';

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

  const selectedLoops = activeGeometry?.loops ?? [];
  const entryPoint = activeGeometry?.entryPoint;
  const accentColor = activeOperationType
    ? OPERATION_COLORS[activeOperationType]
    : '#3b82f6';

  const meshIndexRef = useRef<MeshIndex | null>(null);
  const colorManagerRef = useRef<FaceColorManager | null>(null);
  const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const selectedFacesRef = useRef<Set<number>>(new Set());
  const hoveredRegionIdRef = useRef(-1);
  const prevHoveredFacesRef = useRef<number[]>([]);
  const pendingFaceRef = useRef<number | null>(null);
  const pendingPointRef = useRef<THREE.Vector3 | null>(null);
  const rafHandleRef = useRef<number | null>(null);
  const selectedColorRef = useRef(selectedColor);

  const [hoveredLoops, setHoveredLoops] = useState<LoopPoint[][]>([]);

  selectedColorRef.current = selectedColor;

  useEffect(() => {
    setPartBounds(partBounds);
    setToolOriginFromBounds(partBounds);
  }, [partBounds, setPartBounds, setToolOriginFromBounds]);

  useEffect(() => {
    onIndexReady(false);
    meshIndexRef.current = null;

    const colorAttr = processedGeometry.getAttribute('color') as THREE.BufferAttribute;
    colorAttrRef.current = colorAttr;
    colorManagerRef.current = new FaceColorManager(colorAttr.array as Float32Array, faceCount);

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
    const hovered = selectionMode ? new Set(prevHoveredFacesRef.current) : new Set<number>();
    const hoverColor =
      selectionSubMode === 'bottom-face' ? FACE_COLORS.hoverBottom : FACE_COLORS.hover;

    colorManager.syncAll(nextSelected, hovered, selectedColor, hoverColor);
    colorAttr.needsUpdate = true;
    selectedFacesRef.current = nextSelected;
  }, [activeGeometry, selectionMode, selectionSubMode, selectedColor]);

  const resolveHoverGroup = useCallback(
    (faceIndex: number | null, point: THREE.Vector3 | null): SelectionGroup | null => {
      const meshIndex = meshIndexRef.current;
      if (!meshIndex || faceIndex === null) return null;

      if (selectionSubMode === 'bottom-face') {
        const region = meshIndex.getRegion(faceIndex);
        if (!region) return null;
        return { faceIndices: region.faceIndices, loops: region.loops, outerLoop: region.outerLoop };
      }

      if (!activeOperationType) return null;
      return meshIndex.resolveSelection(faceIndex, activeOperationType, point ?? undefined);
    },
    [activeOperationType, selectionSubMode]
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
      const hoverKey = `${faceIndex}:${nextFaces.length}:${selectionSubMode}`;

      if (hoverKey === lastHoverKeyRef.current) return;
      lastHoverKeyRef.current = hoverKey;

      const prevFaces = prevHoveredFacesRef.current;
      const hoverColor =
        selectionSubMode === 'bottom-face' ? FACE_COLORS.hoverBottom : FACE_COLORS.hover;

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
    [resolveHoverGroup, selectionSubMode]
  );

  const scheduleHover = useCallback(
    (faceIndex: number | null, point: THREE.Vector3 | null) => {
      pendingFaceRef.current = faceIndex;
      pendingPointRef.current = point;
      if (rafHandleRef.current !== null) return;

      rafHandleRef.current = requestAnimationFrame(() => {
        rafHandleRef.current = null;
        applyHover(pendingFaceRef.current, pendingPointRef.current);
      });
    },
    [applyHover]
  );

  useEffect(() => {
    return () => {
      if (rafHandleRef.current !== null) cancelAnimationFrame(rafHandleRef.current);
    };
  }, []);

  useEffect(() => {
    lastHoverKeyRef.current = '';
    if (!selectionMode) scheduleHover(null, null);
  }, [selectionSubMode, selectionMode, scheduleHover]);

  const handlePointerMove = useCallback(
    (event: { stopPropagation: () => void; faceIndex?: number; point: THREE.Vector3 }) => {
      if (!selectionMode || selectionSubMode === 'entry-point') return;
      event.stopPropagation();
      scheduleHover(event.faceIndex ?? null, event.point);
    },
    [selectionMode, selectionSubMode, scheduleHover]
  );

  const handlePointerOut = useCallback(() => {
    if (!selectionMode || selectionSubMode === 'entry-point') return;
    scheduleHover(null, null);
  }, [selectionMode, selectionSubMode, scheduleHover]);

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

      const hole =
        group.holeId !== undefined
          ? meshIndexRef.current.holes.find((h) => h.id === group.holeId)
          : null;

      setOperationGeometry(activeOperationId, {
        faceIndices,
        vertexIndices,
        loops,
        holeCenter: hole?.center,
        holeRadius: hole?.radius,
        holeId: hole?.id,
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
        geometry={processedGeometry}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <meshStandardMaterial
          vertexColors
          metalness={0.25}
          roughness={0.55}
          side={THREE.DoubleSide}
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

      {entryPoint && <EntryPointMarker point={entryPoint} topZ={partBounds.maxZ} />}
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
  const toolOrigin = useSettingsStore((s) => s.toolOrigin);
  const { camera } = useThree();

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
      <ToolOriginMarker origin={toolOrigin} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        enableRotate={!selectionMode}
        enablePan={!selectionMode}
        mouseButtons={{
          LEFT: selectionMode ? undefined : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: selectionMode ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
        }}
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
    </div>
  );
}
