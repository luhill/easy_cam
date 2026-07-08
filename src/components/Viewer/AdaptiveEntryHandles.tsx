import { useCallback, useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ArcLengthGuide } from '../../lib/trochoidalPath';
import { findClosestSOnGuide, sampleGuideAtS } from '../../lib/trochoidalPath';
import { snapPointToSlotCenterline } from '../../lib/adaptiveEntryLayout';

interface AdaptiveEntryHandlesProps {
  toolStart: { x: number; y: number };
  slotJoin?: { x: number; y: number };
  slotArcGuide?: ArcLengthGuide;
  toolStartArcGuide?: ArcLengthGuide;
  topZ: number;
  toolStartManual: boolean;
  slotJoinManual?: boolean;
  showSlotJoin?: boolean;
  onToolStartChange: (point: { x: number; y: number }) => void;
  onSlotJoinChange?: (point: { x: number; y: number }) => void;
}

function CalloutDragHandle({
  point,
  topZ,
  color,
  label,
  labelOffset,
  onCommit,
  onSnap,
  dragPlane,
}: {
  point: { x: number; y: number };
  topZ: number;
  color: string;
  label: string;
  labelOffset: { x: number; y: number };
  onCommit: (x: number, y: number) => void;
  onSnap?: (x: number, y: number) => { x: number; y: number };
  dragPlane: THREE.Plane;
}) {
  const z = topZ + 0.12;
  const { raycaster, camera, gl } = useThree();
  const hit = useRef(new THREE.Vector3());
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);

  const display = preview ?? point;
  const labelX = display.x + labelOffset.x;
  const labelY = display.y + labelOffset.y;

  const pickXY = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(dragPlane, hit.current)) return null;
      const raw = { x: hit.current.x, y: hit.current.y };
      return onSnap ? onSnap(raw.x, raw.y) : raw;
    },
    [camera, dragPlane, gl.domElement, onSnap, raycaster]
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

  return (
    <group>
      <Line
        points={[
          [labelX, labelY, z],
          [display.x, display.y, z],
        ]}
        color={color}
        lineWidth={1.5}
      />
      <mesh position={[display.x, display.y, z]}>
        <sphereGeometry args={[1.1, 12, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html
        position={[labelX, labelY, z]}
        center
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.92)',
            border: `1px solid ${color}`,
            borderRadius: 4,
            color: '#f8fafc',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            padding: '2px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
      </Html>
      <mesh
        position={[display.x, display.y, z]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <sphereGeometry args={[2.2, 16, 16]} />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function AdaptiveEntryHandles({
  toolStart,
  slotJoin,
  slotArcGuide,
  toolStartArcGuide,
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

  const handleToolStartCommit = useCallback(
    (x: number, y: number) => {
      if (toolStartArcGuide) {
        const hit = findClosestSOnGuide(toolStartArcGuide, { x, y });
        const frame = sampleGuideAtS(toolStartArcGuide, hit.s);
        onToolStartChange({ x: frame.x, y: frame.y });
        return;
      }
      onToolStartChange({ x, y });
    },
    [onToolStartChange, toolStartArcGuide]
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

  const snapSlotJoin = useCallback(
    (x: number, y: number) => {
      if (!slotArcGuide) return { x, y };
      return snapPointToSlotCenterline(slotArcGuide, { x, y });
    },
    [slotArcGuide]
  );

  return (
    <group>
      <CalloutDragHandle
        point={toolStart}
        topZ={topZ}
        color={toolStartManual ? '#f59e0b' : '#94a3b8'}
        label="Start"
        labelOffset={{ x: 16, y: 16 }}
        onCommit={handleToolStartCommit}
        dragPlane={dragPlane}
      />
      {showSlotJoin && slotJoin && (
        <CalloutDragHandle
          point={slotJoin}
          topZ={topZ}
          color={slotJoinManual ? '#38bdf8' : '#64748b'}
          label="Join"
          labelOffset={{ x: -16, y: 16 }}
          onCommit={handleSlotJoinCommit}
          onSnap={snapSlotJoin}
          dragPlane={dragPlane}
        />
      )}
    </group>
  );
}
