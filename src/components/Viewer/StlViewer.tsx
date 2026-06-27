import { useRef, useEffect, useMemo, useCallback, useState, Suspense } from 'react';
import { Canvas, useThree, useLoader } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport, Center } from '@react-three/drei';
import { STLLoader } from 'three-stdlib';
import * as THREE from 'three';
import { useAppStore } from '../../store/useAppStore';
import { OPERATION_COLORS } from '../../types/operations';
import {
  createFaceColorAttribute,
  getFaceCount,
  hexToThreeColor,
  repaintFaceColors,
} from '../../lib/faceColors';
import { ToolpathLines } from './ToolpathLines';

interface StlMeshProps {
  url: string;
}

function StlMesh({ url }: StlMeshProps) {
  const geometry = useLoader(STLLoader, url);
  const meshRef = useRef<THREE.Mesh>(null);
  const colorAttrRef = useRef<THREE.BufferAttribute | null>(null);
  const [hoveredFace, setHoveredFace] = useState<number | null>(null);

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

  const selectedFaces = useMemo(
    () => new Set(activeGeometry?.faceIndices ?? []),
    [activeGeometry]
  );

  const selectedColor = useMemo(
    () =>
      activeOperationType
        ? hexToThreeColor(OPERATION_COLORS[activeOperationType])
        : undefined,
    [activeOperationType]
  );

  useEffect(() => {
    const colorAttr = processedGeometry.getAttribute('color') as THREE.BufferAttribute;
    colorAttrRef.current = colorAttr;

    if (selectedFaces.size === 0 && hoveredFace === null) {
      repaintFaceColors(colorAttr.array as Float32Array, faceCount, new Set(), null);
    } else {
      repaintFaceColors(
        colorAttr.array as Float32Array,
        faceCount,
        selectedFaces,
        selectionMode ? hoveredFace : null,
        selectedColor
      );
    }
    colorAttr.needsUpdate = true;
  }, [processedGeometry, faceCount, selectedFaces, hoveredFace, selectionMode, selectedColor]);

  const handlePointerMove = useCallback(
    (event: { stopPropagation: () => void; faceIndex?: number }) => {
      if (!selectionMode) return;
      event.stopPropagation();
      const faceIndex = event.faceIndex ?? null;
      setHoveredFace((prev) => (prev === faceIndex ? prev : faceIndex));
    },
    [selectionMode]
  );

  const handlePointerOut = useCallback(() => {
    setHoveredFace(null);
  }, []);

  const handleClick = useCallback(
    (event: {
      stopPropagation: () => void;
      faceIndex?: number;
      face?: { a: number; b: number; c: number };
    }) => {
      if (!selectionMode || !activeOperationId) return;
      event.stopPropagation();

      const faceIndex = event.faceIndex ?? 0;
      const face = event.face;
      const newVertices = face
        ? [face.a, face.b, face.c]
        : [faceIndex * 3, faceIndex * 3 + 1, faceIndex * 3 + 2];

      const op = useAppStore.getState().operations.find((o) => o.id === activeOperationId);
      const existing = op?.geometry;
      const isSelected = existing?.faceIndices.includes(faceIndex) ?? false;

      const faceIndices = isSelected
        ? existing!.faceIndices.filter((i) => i !== faceIndex)
        : [...(existing?.faceIndices ?? []), faceIndex];
      const vertexIndices = isSelected
        ? (existing?.vertexIndices ?? []).filter((v) => !newVertices.includes(v))
        : [...(existing?.vertexIndices ?? []), ...newVertices];

      setOperationGeometry(
        activeOperationId,
        faceIndices.length > 0 ? { faceIndices, vertexIndices } : null
      );
    },
    [selectionMode, activeOperationId, setOperationGeometry]
  );

  return (
    <Center>
      <mesh
        ref={meshRef}
        geometry={processedGeometry}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <meshStandardMaterial
          vertexColors
          metalness={0.25}
          roughness={0.55}
          side={THREE.DoubleSide}
        />
      </mesh>
    </Center>
  );
}

function SceneContent() {
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
          <StlMesh url={stlUrl} />
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

  return (
    <div className={`stl-viewer ${selectionMode ? 'selection-active' : ''}`}>
      {!stlUrl && (
        <div className="viewer-placeholder">
          <p>Upload an STL file to begin</p>
        </div>
      )}
      <Canvas
        camera={{ fov: 45, near: 0.1, far: 1000, position: [60, 60, 60] }}
        style={{ background: '#0f1115', cursor: selectionMode ? 'crosshair' : 'default' }}
      >
        <SceneContent />
      </Canvas>
      {selectionMode && (
        <div className="selection-hint">
          Hover to preview faces — click to select/deselect — right-drag to orbit
        </div>
      )}
    </div>
  );
}
