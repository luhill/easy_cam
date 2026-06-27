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
  getFaceCount,
  hexToThreeColor,
} from '../../lib/faceColors';
import { processStlGeometry, type PartBounds } from '../../lib/geometryProcessing';
import { getSelectionHint } from '../../lib/selectionRules';
import {
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
  url: string;
  onIndexReady: (ready: boolean, regionCount?: number) => void;
  onBoundsReady: (bounds: PartBounds) => void;
}

function StlMesh({ url, onIndexReady, onBoundsReady }: StlMeshProps) {
  const geometry = useLoader(STLLoader, url);

  const activeOperationId = useAppStore((s) => s.activeOperationId);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const selectionSubMode = useAppStore((s) => s.selectionSubMode);
  const setSelectionSubMode = useAppStore((s) => s.setSelectionSubMode);
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

  const processed = useMemo(() => {
    const result = processStlGeometry(geometry);
    createFaceColorAttribute(result.geometry);
    return result;
  }, [geometry]);

  const processedGeometry = processed.geometry;
  const partBounds = processed.bounds;

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
    onBoundsReady(partBounds);
  }, [partBounds, onBoundsReady]);

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
  }, [processedGeometry, faceCount, onIndexReady]);

  useEffect(() => {
    const colorManager = colorManagerRef.current;
    const colorAttr = colorAttrRef.current;
    if (!colorManager || !colorAttr) return;

    const nextSelected = new Set(activeGeometry?.faceIndices ?? []);
    const hovered = new Set(prevHoveredFacesRef.current);

    colorManager.syncAll(nextSelected, selectionMode ? hovered : new Set(), selectedColor);
    colorAttr.needsUpdate = true;
    selectedFacesRef.current = nextSelected;
  }, [activeGeometry, selectionMode, selectedColor]);

  const resolveHoverGroup = useCallback(
    (faceIndex: number | null, point: THREE.Vector3 | null): SelectionGroup | null => {
      const meshIndex = meshIndexRef.current;
      if (!meshIndex || !activeOperationType || faceIndex === null) return null;
      return meshIndex.resolveSelection(faceIndex, activeOperationType, point ?? undefined);
    },
    [activeOperationType]
  );

  const applyHover = useCallback(
    (faceIndex: number | null, point: THREE.Vector3 | null) => {
      const meshIndex = meshIndexRef.current;
      const colorManager = colorManagerRef.current;
      const colorAttr = colorAttrRef.current;
      if (!meshIndex || !colorManager || !colorAttr || !activeOperationType) return;

      const group = resolveHoverGroup(faceIndex, point);
      const regionId =
        faceIndex !== null && group ? meshIndex.getRegionId(faceIndex) : -1;

      if (regionId === hoveredRegionIdRef.current && group) return;

      const prevFaces = prevHoveredFacesRef.current;
      const nextFaces = group?.faceIndices ?? [];

      colorManager.updateHoverRegion(
        prevFaces,
        nextFaces,
        selectedFacesRef.current,
        selectedColorRef.current
      );
      colorAttr.needsUpdate = true;

      hoveredRegionIdRef.current = regionId;
      prevHoveredFacesRef.current = nextFaces;

      if (
        group &&
        (activeOperationType === 'outline' || activeOperationType === 'adaptive-outline')
      ) {
        setHoveredLoops(group.loops);
      } else if (group && group.loops.length > 0) {
        setHoveredLoops(group.loops);
      } else {
        setHoveredLoops([]);
      }
    },
    [activeOperationType, resolveHoverGroup]
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
    if (!selectionMode) {
      scheduleHover(null, null);
    }
  }, [selectionMode, scheduleHover]);

  const handlePointerMove = useCallback(
    (event: { stopPropagation: () => void; faceIndex?: number; point: THREE.Vector3 }) => {
      if (!selectionMode || selectionSubMode !== 'geometry') return;
      event.stopPropagation();
      scheduleHover(event.faceIndex ?? null, event.point);
    },
    [selectionMode, selectionSubMode, scheduleHover]
  );

  const handlePointerOut = useCallback(() => {
    if (!selectionMode || selectionSubMode !== 'geometry') return;
    scheduleHover(null, null);
  }, [selectionMode, selectionSubMode, scheduleHover]);

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
      if (!selectionMode || !activeOperationId || !meshIndexRef.current || !activeOperationType)
        return;
      if (selectionSubMode !== 'geometry') return;
      event.stopPropagation();

      const faceIndex = event.faceIndex ?? 0;
      const group = meshIndexRef.current.resolveSelection(
        faceIndex,
        activeOperationType,
        event.point
      );
      if (!group) return;

      applyGeometrySelection(group, activeOperationType);
    },
    [selectionMode, selectionSubMode, activeOperationId, activeOperationType, applyGeometrySelection]
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
        onPick={handleEntryPick}
      />

      {selectionMode && hoveredLoops.length > 0 && (
        <SelectionLoopLines loops={hoveredLoops} color="#93c5fd" opacity={0.85} />
      )}

      {selectedLoops.length > 0 && (
        <SelectionLoopLines loops={selectedLoops} color={accentColor} opacity={1} />
      )}

      {entryPoint && <EntryPointMarker point={entryPoint} />}
    </>
  );
}

function SceneContent({
  onIndexReady,
  onBoundsReady,
}: {
  onIndexReady: (ready: boolean, regionCount?: number) => void;
  onBoundsReady: (bounds: PartBounds) => void;
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
          <StlMesh url={stlUrl} onIndexReady={onIndexReady} onBoundsReady={onBoundsReady} />
        </Suspense>
      )}
      <ToolpathLines segments={visiblePaths} />
      <ToolOriginMarker origin={toolOrigin} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
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

  const setToolOriginFromBounds = useSettingsStore((s) => s.setToolOriginFromBounds);

  const [indexStatus, setIndexStatus] = useState<{ ready: boolean; regions?: number }>({
    ready: false,
  });

  const handleIndexReady = useCallback((ready: boolean, regionCount?: number) => {
    setIndexStatus({ ready, regions: regionCount });
  }, []);

  const handleBoundsReady = useCallback(
    (bounds: PartBounds) => {
      setToolOriginFromBounds(bounds);
    },
    [setToolOriginFromBounds]
  );

  const selectionHint = getSelectionHint(activeOperationType, selectionSubMode);

  return (
    <div className={`stl-viewer ${selectionMode ? 'selection-active' : ''}`}>
      {!stlUrl && (
        <div className="viewer-placeholder">
          <p>Upload an STL file to begin</p>
          <p className="viewer-axis-hint">Z+ up · XY work plane · cuts into −Z</p>
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
        <SceneContent onIndexReady={handleIndexReady} onBoundsReady={handleBoundsReady} />
      </Canvas>
      {selectionMode && indexStatus.ready && (
        <div className="selection-hint">{selectionHint} — right-drag to orbit</div>
      )}
    </div>
  );
}
