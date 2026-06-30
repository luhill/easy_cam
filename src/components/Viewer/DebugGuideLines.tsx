import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { LoopPoint } from '../../types/operations';

const DEBUG_GUIDE_COLOR = '#f97316';

interface DebugGuideLinesProps {
  slotCenterline?: LoopPoint[];
  leadInGuide?: LoopPoint[];
  color?: string;
  opacity?: number;
}

function OpenPolyline({
  points,
  color,
  opacity,
}: {
  points: LoopPoint[];
  color: string;
  opacity: number;
}) {
  const linePoints = useMemo(
    () => points.map((p) => [p.x, p.y, p.z] as [number, number, number]),
    [points]
  );

  if (linePoints.length < 2) return null;

  return (
    <Line points={linePoints} color={color} lineWidth={2.5} transparent opacity={opacity} />
  );
}

function ClosedLoop({
  loop,
  color,
  opacity,
}: {
  loop: LoopPoint[];
  color: string;
  opacity: number;
}) {
  const linePoints = useMemo(() => {
    const coords = loop.map((p) => [p.x, p.y, p.z] as [number, number, number]);
    if (coords.length > 2) {
      coords.push(coords[0]);
    }
    return coords;
  }, [loop]);

  if (linePoints.length < 2) return null;

  return (
    <Line points={linePoints} color={color} lineWidth={2.5} transparent opacity={opacity} />
  );
}

export function DebugGuideLines({
  slotCenterline,
  leadInGuide,
  color = DEBUG_GUIDE_COLOR,
  opacity = 0.95,
}: DebugGuideLinesProps) {
  const hasSlot = (slotCenterline?.length ?? 0) >= 2;
  const hasLeadIn = (leadInGuide?.length ?? 0) >= 2;
  if (!hasSlot && !hasLeadIn) return null;

  return (
    <group>
      {hasSlot && (
        <ClosedLoop loop={slotCenterline!} color={color} opacity={opacity} />
      )}
      {hasLeadIn && (
        <OpenPolyline points={leadInGuide!} color={color} opacity={opacity} />
      )}
    </group>
  );
}
