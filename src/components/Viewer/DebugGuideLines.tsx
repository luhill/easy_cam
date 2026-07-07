import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import type { LoopPoint } from '../../types/operations';
import { TOOLPATH_MOVE_COLORS } from '../../lib/toolpathColors';

interface DebugGuideLinesProps {
  slotCenterline?: LoopPoint[];
  leadInGuide?: LoopPoint[];
  /** Draw slot path without auto-closing (needed when spur branches are present). */
  slotCenterlineOpen?: boolean;
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
  slotCenterlineOpen = false,
  color = TOOLPATH_MOVE_COLORS.reference,
  opacity = 0.95,
}: DebugGuideLinesProps) {
  const hasSlot = (slotCenterline?.length ?? 0) >= 2;
  const hasLeadIn = (leadInGuide?.length ?? 0) >= 2;
  if (!hasSlot && !hasLeadIn) return null;

  return (
    <group>
      {hasSlot &&
        (slotCenterlineOpen ? (
          <OpenPolyline points={slotCenterline!} color={color} opacity={opacity} />
        ) : (
          <ClosedLoop loop={slotCenterline!} color={color} opacity={opacity} />
        ))}
      {hasLeadIn && (
        <OpenPolyline points={leadInGuide!} color={color} opacity={opacity} />
      )}
    </group>
  );
}
