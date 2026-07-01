import { memo, useMemo } from 'react';
import * as THREE from 'three';
import type { Operation, ToolpathSegment } from '../../types/operations';
import {
  colorForToolpathEdge,
  computeToolpathFeedRange,
  type ToolpathColorMode,
} from '../../lib/toolpathColors';

/** Trochoid samples classified as on-spur (debug overlay). */
export const SPUR_TOOLPATH_COLOR = '#22c55e';

interface ToolpathLinesProps {
  segments: ToolpathSegment[];
  colorMode?: ToolpathColorMode;
  operations?: Operation[];
  travelFeedRate?: number;
}

const PathLine = memo(function PathLine({
  segment,
  colorMode,
  op,
  travelFeedRate,
  feedRange,
  operations,
}: {
  segment: ToolpathSegment;
  colorMode: ToolpathColorMode;
  op: Operation | undefined;
  travelFeedRate: number;
  feedRange: { min: number; max: number };
  operations: Operation[];
}) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const scratch = new THREE.Color();
    const input = {
      segments: [segment],
      colorMode,
      operations,
      travelFeedRate,
    };

    for (let i = 0; i < segment.points.length - 1; i++) {
      const a = segment.points[i];
      const b = segment.points[i + 1];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);

      const color = colorForToolpathEdge(a, b, segment, op, input, feedRange, scratch);
      colors.push(color.r, color.g, color.b);
      colors.push(color.r, color.g, color.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, [segment, colorMode, op, travelFeedRate, feedRange, operations]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors linewidth={2} />
    </lineSegments>
  );
});

export function ToolpathLines({
  segments,
  colorMode = 'type',
  operations = [],
  travelFeedRate = 2000,
}: ToolpathLinesProps) {
  const opById = useMemo(() => new Map(operations.map((op) => [op.id, op])), [operations]);
  const feedRange = useMemo(
    () => computeToolpathFeedRange(segments, operations, travelFeedRate),
    [segments, operations, travelFeedRate]
  );

  return (
    <group>
      {segments.map((seg, index) => (
        <PathLine
          key={`${seg.operationId}-${index}`}
          segment={seg}
          colorMode={colorMode}
          op={opById.get(seg.operationId)}
          travelFeedRate={travelFeedRate}
          feedRange={feedRange}
          operations={operations}
        />
      ))}
    </group>
  );
}
