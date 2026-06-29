import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { LoopPoint } from '../../types/operations';

interface SelectionLoopLinesProps {
  loops: LoopPoint[][];
  color: string;
  opacity?: number;
}

function LoopLine({
  loop,
  color,
  opacity = 1,
}: {
  loop: LoopPoint[];
  color: string;
  opacity?: number;
}) {
  const points = useMemo(() => {
    const coords = loop.map((p) => [p.x, p.y, p.z] as [number, number, number]);
    if (coords.length > 2) {
      coords.push(coords[0]);
    }
    return coords;
  }, [loop]);

  if (points.length < 2) return null;

  return <Line points={points} color={color} lineWidth={2} transparent opacity={opacity} />;
}

export function SelectionLoopLines({
  loops,
  color,
  opacity = 1,
}: SelectionLoopLinesProps) {
  if (loops.length === 0) return null;

  return (
    <group>
      {loops.map((loop, index) => (
        <LoopLine key={index} loop={loop} color={color} opacity={opacity} />
      ))}
    </group>
  );
}
