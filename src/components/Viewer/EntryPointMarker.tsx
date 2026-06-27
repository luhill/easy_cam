import { useMemo } from 'react';
import { Line } from '@react-three/drei';

interface EntryPointMarkerProps {
  point: { x: number; y: number };
  color?: string;
}

export function EntryPointMarker({ point, color = '#f59e0b' }: EntryPointMarkerProps) {
  const cross = useMemo(
    () => [
      [point.x - 2, point.y, 0] as [number, number, number],
      [point.x + 2, point.y, 0] as [number, number, number],
      [point.x, point.y - 2, 0] as [number, number, number],
      [point.x, point.y + 2, 0] as [number, number, number],
    ],
    [point.x, point.y]
  );

  return (
    <group>
      <Line points={[cross[0], cross[1]]} color={color} lineWidth={2} />
      <Line points={[cross[2], cross[3]]} color={color} lineWidth={2} />
    </group>
  );
}

export function StockTopPlane({
  onPick,
  active,
  bounds,
}: {
  onPick: (x: number, y: number) => void;
  active: boolean;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}) {
  if (!active) return null;

  const pad = 15;
  const w = bounds.maxX - bounds.minX + pad * 2;
  const h = bounds.maxY - bounds.minY + pad * 2;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  return (
    <mesh
      position={[cx, cy, 0.01]}
      rotation={[0, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onPick(e.point.x, e.point.y);
      }}
    >
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial transparent opacity={0.08} color="#3b82f6" depthWrite={false} />
    </mesh>
  );
}
