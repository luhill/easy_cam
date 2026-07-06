import { useCallback, useMemo, useRef, useState } from 'react';
import { Line } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ArcLengthGuide } from '../../lib/trochoidalPath';
import { snapPointToSlotCenterline } from '../../lib/adaptiveEntryLayout';

interface AdaptiveEntryHandlesProps {
  toolStart: { x: number; y: number };
  slotJoin?: { x: number; y: number };
  slotArcGuide?: ArcLengthGuide;
  topZ: number;
  toolStartManual: boolean;
  slotJoinManual?: boolean;
  showSlotJoin?: boolean;
  onToolStartChange: (point: { x: number; y: number }) => void;
  onSlotJoinChange?: (point: { x: number; y: number }) => void;
}

function crossSegments(x: number, y: number, z: number, size: number) {
  return [
    [
      [x - size, y, z] as [number, number, number],
      [x + size, y, z] as [number, number, number],
    ],
    [
      [x, y - size, z] as [number, number, number],
      [x, y + size, z] as [number, number, number],
    ],
  ];
}

function DragHandle({
  point,
  topZ,
  color,
  onCommit,
  dragPlane,
}: {
  point: { x: number; y: number };
  topZ: number;
  color: string;
  onCommit: (x: number, y: number) => void;
  dragPlane: THREE.Plane;
}) {
  const z = topZ + 0.12;
  const size = 2.4;
  const { raycaster, camera, gl } = useThree();
  const hit = useRef(new THREE.Vector3());
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);

  const display = preview ?? point;

  const pickXY = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(dragPlane, hit.current)) return null;
      return { x: hit.current.x, y: hit.current.y };
    },
    [camera, dragPlane, gl.domElement, raycaster]
  );

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!dragging) return;
      e.stopPropagation();
      const xy = pickXY(e.nativeEvent.clientX, e.nativeEvent.clientY);
      if (xy) setPreview(xy);
    },
    [dragging, pickXY]
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      setDragging(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      const xy = pickXY(e.nativeEvent.clientX, e.nativeEvent.clientY);
      if (xy) onCommit(xy.x, xy.y);
      setPreview(null);
    },
    [onCommit, pickXY]
  );

  const crosses = crossSegments(display.x, display.y, z, size);

  return (
    <group>
      <Line points={crosses[0]} color={color} lineWidth={2.5} />
      <Line points={crosses[1]} color={color} lineWidth={2.5} />
      <mesh
        position={[display.x, display.y, z]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <sphereGeometry args={[1.8, 16, 16]} />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function AdaptiveEntryHandles({
  toolStart,
  slotJoin,
  slotArcGuide,
  topZ,
  toolStartManual,
  slotJoinManual = false,
  showSlotJoin = true,
  onToolStartChange,
  onSlotJoinChange,
}: AdaptiveEntryHandlesProps) {
  const dragPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 0, 1), -topZ),
    [topZ]
  );

  const handleSlotJoinCommit = useCallback(
    (x: number, y: number) => {
      if (!onSlotJoinChange) return;
      if (slotArcGuide) {
        const snapped = snapPointToSlotCenterline(slotArcGuide, { x, y });
        onSlotJoinChange({ x: snapped.x, y: snapped.y });
      } else {
        onSlotJoinChange({ x, y });
      }
    },
    [onSlotJoinChange, slotArcGuide]
  );

  return (
    <group>
      <DragHandle
        point={toolStart}
        topZ={topZ}
        color={toolStartManual ? '#f59e0b' : '#94a3b8'}
        onCommit={(x, y) => onToolStartChange({ x, y })}
        dragPlane={dragPlane}
      />
      {showSlotJoin && slotJoin && (
        <DragHandle
          point={slotJoin}
          topZ={topZ}
          color={slotJoinManual ? '#38bdf8' : '#64748b'}
          onCommit={handleSlotJoinCommit}
          dragPlane={dragPlane}
        />
      )}
    </group>
  );
}
