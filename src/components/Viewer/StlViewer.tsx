import { useRef, useEffect, useMemo, useCallback, useState, Suspense } from 'react';
import { Canvas, useThree, useLoader } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, Center } from '@react-three/drei';
import { STLLoader } from 'three-stdlib';
import * as THREE from 'three';
import { useAppStore } from '../../store/useAppStore';
import { getSelectionStrategy, OPERATION_COLORS } from '../../types/operations';
import type { LoopPoint } from '../../types/operations';
import {
  createFaceColorAttribute,
  FaceColorManager,
  getFaceCount,
  hexToThreeColor,
} from '../../lib/faceColors';
import {
  collectVertexIndices,
  getMeshIndex,
  isGroupSelected,
  mergeLoops,
  removeGroupFromSelection,
  type MeshIndex,
} from '../../lib/meshSelection';
import { ToolpathLines } from './ToolpathLines';
import { SelectionLoopLines } from './SelectionLoopLines';

interface StlMeshProps {
  url: string;
  onIndexReady: (ready: boolean, regionCount?: number) => void;
}

function StlMesh({ url, onIndexReady }: StlMeshProps) {
  const geometry = useLoader(STLLoader, url);

  const activeOperationId = useAppStore((s) => s.activeOperationId);
  const selectionMode = useAppStore((s) => s.selectionMode);
  const activeGeometry = useAppStore((s) => {
    if (!s.activeOperationId) return null;
    return s.operations.find((o) => o.id === s.activeOperationId)?.geometry ?? null;
  });
  const activeOperationType = useAppStore((s) => {
    if (!s.activeOperationId) return null;
    return s.operations.find((o) => o.id === s.activeOperationId)?.type ?? null;
  });
  const setOperationGeometry = useAppStore((s) => s.setOperationGeometry);

  const processedGeometry = useMemo(() => {
    const geo = geometry.clone();
    geo.computeVertexNormals();
    geo.center();
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 50 / maxDim;
    geo.scale(scale, scale, scale);
    geo.computeBoundingBox();
    createFaceColorAttribute(geo);
    return geo;
  }, [geometry]);

  const faceCount = useMemo(() => getFaceCount(processedGeometry), [processedGeometry]);

  const selectionStrategy = useMemo(
    () => (activeOperationType ? getSelectionStrategy(activeOperationType) : 'region'),
    [activeOperationType]
  );

  const selectedColor = useMemo(
    () =>
      activeOperationType
        ? hexToThreeColor(OPERATION_COLORS[activeOperationType])
        : hexToThreeColor('#3b82f6'),
    [activeOperationType]
  );

  const selectedLoops = activeGeometry?.loops ?? [];
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
  const rafHandleRef = useRef<number | null>(null);
  const selectedColorRef = useRef(selectedColor);

  const [hoveredLoops, setHoveredLoops] = useState<LoopPoint[][]>([]);

  selectedColorRef.current = selectedColor;

  // Build mesh index once when geometry loads (precomputes all coplanar regions + loops)
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

  // Repaint when selection changes (not on every hover)
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

  const applyHover = useCallback(
    (faceIndex: number | null) => {
      const meshIndex = meshIndexRef.current;
      const colorManager = colorManagerRef.current;
      const colorAttr = colorAttrRef.current;
      if (!meshIndex || !colorManager || !colorAttr) return;

      const regionId = faceIndex !== null ? meshIndex.getRegionId(faceIndex) : -1;
      if (regionId === hoveredRegionIdRef.current) return;

      const prevFaces = prevHoveredFacesRef.current;
      const nextFaces =
        regionId >= 0 ? meshIndex.regions[regionId].faceIndices : [];

      colorManager.updateHoverRegion(
        prevFaces,
        nextFaces,
        selectedFacesRef.current,
        selectedColorRef.current
      );
      colorAttr.needsUpdate = true;

      hoveredRegionIdRef.current = regionId;
      prevHoveredFacesRef.current = nextFaces;

      if (selectionStrategy === 'outline-loop' && regionId >= 0) {
        setHoveredLoops(meshIndex.regions[regionId].loops);
      } else {
        setHoveredLoops([]);
      }
    },
    [selectionStrategy]
  );

  const clearHover = useCallback(() => {
    pendingFaceRef.current = null;
    applyHover(null);
  }, [applyHover]);

  const scheduleHover = useCallback(
    (faceIndex: number | null) => {
      pendingFaceRef.current = faceIndex;
      if (rafHandleRef.current !== null) return;

      rafHandleRef.current = requestAnimationFrame(() => {
        rafHandleRef.current = null;
        applyHover(pendingFaceRef.current);
      });
    },
    [applyHover]
  );

  useEffect(() => {
    return () => {
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectionMode) {
      clearHover();
    }
  }, [selectionMode, clearHover]);

  const handlePointerMove = useCallback(
    (event: { stopPropagation: () => void; faceIndex?: number }) => {
      if (!selectionMode || !meshIndexRef.current) return;
      event.stopPropagation();
      scheduleHover(event.faceIndex ?? null);
    },
    [selectionMode, scheduleHover]
  );

  const handlePointerOut = useCallback(() => {
    if (!selectionMode) return;
    scheduleHover(null);
  }, [selectionMode, scheduleHover]);

  const handleClick = useCallback(
    (event: { stopPropagation: () => void; faceIndex?: number }) => {
      if (!selectionMode || !activeOperationId || !meshIndexRef.current) return;
      event.stopPropagation();

      const faceIndex = event.faceIndex ?? 0;
      const group = meshIndexRef.current.getSelectionGroup(faceIndex, selectionStrategy);

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
          faceIndices.length > 0 ? { faceIndices, vertexIndices, loops } : null
        );
        return;
      }

      const faceIndices = [...new Set([...(existing?.faceIndices ?? []), ...group.faceIndices])];
      const loops =
        selectionStrategy === 'outline-loop'
          ? mergeLoops(existing?.loops, group.loops)
          : existing?.loops;
      const vertexIndices = collectVertexIndices(meshIndexRef.current, faceIndices);

      setOperationGeometry(activeOperationId, {
        faceIndices,
        vertexIndices,
        loops,
      });
    },
    [selectionMode, activeOperationId, selectionStrategy, setOperationGeometry]
  );

  return (
    <Center>
      <group rotation={[-Math.PI / 2, 0, 0]}>
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

        {selectionMode && hoveredLoops.length > 0 && (
          <SelectionLoopLines loops={hoveredLoops} color="#93c5fd" opacity={0.85} />
        )}

        {selectedLoops.length > 0 && (
          <SelectionLoopLines
            loops={selectedLoops}
            color={accentColor}
            opacity={selectionMode ? 1 : 1}
          />
        )}
      </group>
    </Center>
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
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(60, 60, 60);
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
      <directionalLight position={[50, 80, 50]} intensity={1.2} castShadow />
      <directionalLight position={[-30, 40, -20]} intensity={0.4} />
      <Grid
        args={[200, 200]}
        cellSize={5}
        cellThickness={0.5}
        cellColor="#2a2f38"
        sectionSize={25}
        sectionThickness={1}
        sectionColor="#3d4555"
        fadeDistance={300}
        position={[0, -0.01, 0]}
      />
      {stlUrl && (
        <Suspense fallback={null}>
          <StlMesh url={stlUrl} onIndexReady={onIndexReady} />
        </Suspense>
      )}
      <ToolpathLines segments={visiblePaths} />
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

  const selectionStrategy = useMemo(
    () => (activeOperationType ? getSelectionStrategy(activeOperationType) : 'region'),
    [activeOperationType]
  );

  const selectionHint =
    selectionStrategy === 'outline-loop'
      ? 'Click a surface to select its outline loop — click again to deselect — right-drag to orbit'
      : 'Click a surface to select the whole face — click again to deselect — right-drag to orbit';

  return (
    <div className={`stl-viewer ${selectionMode ? 'selection-active' : ''}`}>
      {!stlUrl && (
        <div className="viewer-placeholder">
          <p>Upload an STL file to begin</p>
        </div>
      )}
      {stlUrl && !indexStatus.ready && (
        <div className="viewer-processing">
          <p>Analyzing mesh geometry…</p>
        </div>
      )}
      <Canvas
        camera={{ fov: 45, near: 0.1, far: 1000, position: [60, 60, 60] }}
        style={{ background: '#0f1115', cursor: selectionMode ? 'crosshair' : 'default' }}
      >
        <SceneContent onIndexReady={handleIndexReady} />
      </Canvas>
      {selectionMode && indexStatus.ready && (
        <div className="selection-hint">{selectionHint}</div>
      )}
    </div>
  );
}
