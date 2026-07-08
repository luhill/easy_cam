import { useCallback, useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
interface AdaptiveEntryHandlesProps {
  toolStart: { x: number; y: number };
  slotJoin?: { x: number; y: number };
  topZ: number;
  toolStartManual: boolean;
  slotJoinManual?: boolean;
  showSlotJoin?: boolean;
  snapToolStart?: (x: number, y: number) => { x: number; y: number };
  snapSlotJoin?: (x: number, y: number) => { x: number; y: number };
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
  const [labelDelta, setLabelDelta] = useState({ x: 0, y: 0 });
  const [ghostPoint, setGhostPoint] = useState<{ x: number; y: number } | null>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const pointOrigin = useRef<{ x: number; y: number } | null>(null);
  const deltaRef = useRef({ x: 0, y: 0 });
  const ghostRef = useRef<{ x: number; y: number } | null>(null);

  const labelX = point.x + labelOffset.x + labelDelta.x;
  const labelY = point.y + labelOffset.y + labelDelta.y;
  const calloutTarget = dragging && ghostPoint ? ghostPoint : point;

  const pickRawXY = useCallback(
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

  const resolveGhost = useCallback(
    (origin: { x: number; y: number }, delta: { x: number; y: number }) => {
      const candidate = { x: origin.x + delta.x, y: origin.y + delta.y };
      return onSnap ? onSnap(candidate.x, candidate.y) : candidate;
    },
    [onSnap]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      const origin = pickRawXY(e.clientX, e.clientY);
      if (!origin) return;
      dragOrigin.current = origin;
      pointOrigin.current = { x: point.x, y: point.y };
      deltaRef.current = { x: 0, y: 0 };
      setLabelDelta({ x: 0, y: 0 });
      const initialGhost = resolveGhost(pointOrigin.current, { x: 0, y: 0 });
      ghostRef.current = initialGhost;
      setGhostPoint(initialGhost);
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pickRawXY, point.x, point.y, resolveGhost]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || !dragOrigin.current || !pointOrigin.current) return;
      e.stopPropagation();
      const xy = pickRawXY(e.clientX, e.clientY);
      if (!xy) return;
      const delta = {
        x: xy.x - dragOrigin.current.x,
        y: xy.y - dragOrigin.current.y,
      };
      deltaRef.current = delta;
      setLabelDelta(delta);
      const nextGhost = resolveGhost(pointOrigin.current, delta);
      ghostRef.current = nextGhost;
      setGhostPoint(nextGhost);
    },
    [dragging, pickRawXY, resolveGhost]
  );

  const finishDrag = useCallback(() => {
    setDragging(false);
    const moved = Math.hypot(deltaRef.current.x, deltaRef.current.y) > 0.35;
    const ghost = ghostRef.current;
    if (moved && ghost) {
      onCommit(ghost.x, ghost.y);
    }
    dragOrigin.current = null;
    pointOrigin.current = null;
    deltaRef.current = { x: 0, y: 0 };
    ghostRef.current = null;
    setGhostPoint(null);
    setLabelDelta({ x: 0, y: 0 });
  }, [onCommit]);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      finishDrag();
    },
    [finishDrag]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      finishDrag();
    },
    [finishDrag]
  );

  return (
    <group>
      <Line
        points={[
          [labelX, labelY, z],
          [calloutTarget.x, calloutTarget.y, z],
        ]}
        color={color}
        lineWidth={1.5}
      />
      <mesh position={[point.x, point.y, z]}>
        <sphereGeometry args={[1.1, 12, 12]} />
        <meshBasicMaterial color={color} transparent={dragging} opacity={dragging ? 0.35 : 1} />
      </mesh>
      {dragging && ghostPoint ? (
        <mesh position={[ghostPoint.x, ghostPoint.y, z]}>
          <sphereGeometry args={[1.9, 14, 14]} />
          <meshBasicMaterial color={color} transparent opacity={0.55} depthWrite={false} />
        </mesh>
      ) : null}
      <Html position={[labelX, labelY, z]} center style={{ pointerEvents: 'none', userSelect: 'none' }}>
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          style={{
            background: 'rgba(15, 23, 42, 0.92)',
            border: `1px solid ${color}`,
            borderRadius: 4,
            color: '#f8fafc',
            cursor: dragging ? 'grabbing' : 'grab',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            padding: '2px 8px',
            pointerEvents: 'auto',
            touchAction: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}

export function AdaptiveEntryHandles({
  toolStart,
  slotJoin,
  topZ,
  toolStartManual,
  slotJoinManual = false,
  showSlotJoin = true,
  snapToolStart,
  snapSlotJoin,
  onToolStartChange,
  onSlotJoinChange,
}: AdaptiveEntryHandlesProps) {
  const dragPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 0, 1), -topZ),
    [topZ]
  );

  const handleToolStartCommit = useCallback(
    (x: number, y: number) => {
      onToolStartChange({ x, y });
    },
    [onToolStartChange]
  );

  const handleSlotJoinCommit = useCallback(
    (x: number, y: number) => {
      if (!onSlotJoinChange) return;
      onSlotJoinChange({ x, y });
    },
    [onSlotJoinChange]
  );

  return (
    <group>
      <CalloutDragHandle
        point={toolStart}
        topZ={topZ}
        color={toolStartManual ? '#f59e0b' : '#94a3b8'}
        label="Start"
        labelOffset={{ x: 4, y: 4 }}
        onCommit={handleToolStartCommit}
        onSnap={snapToolStart}
        dragPlane={dragPlane}
      />
      {showSlotJoin && slotJoin && (
        <CalloutDragHandle
          point={slotJoin}
          topZ={topZ}
          color={slotJoinManual ? '#38bdf8' : '#64748b'}
          label="Join"
          labelOffset={{ x: -4, y: 4 }}
          onCommit={handleSlotJoinCommit}
          onSnap={snapSlotJoin}
          dragPlane={dragPlane}
        />
      )}
    </group>
  );
}
