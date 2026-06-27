import { useMemo } from 'react';
import * as THREE from 'three';
import type { ToolpathSegment } from '../../types/operations';

interface ToolpathLinesProps {
  segments: ToolpathSegment[];
}

function PathLine({ segment }: { segment: ToolpathSegment }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];
    const color = new THREE.Color(segment.color);

    for (let i = 0; i < segment.points.length - 1; i++) {
      const a = segment.points[i];
      const b = segment.points[i + 1];
      positions.push(a.x, a.z, a.y, b.x, b.z, b.y);
      const alpha = a.rapid || b.rapid ? 0.4 : 1;
      colors.push(color.r * alpha, color.g * alpha, color.b * alpha);
      colors.push(color.r * alpha, color.g * alpha, color.b * alpha);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, [segment]);

  return (
    <lineSegments geometry={geometry} rotation={[-Math.PI / 2, 0, 0]}>
      <lineBasicMaterial vertexColors linewidth={2} />
    </lineSegments>
  );
}

export function ToolpathLines({ segments }: ToolpathLinesProps) {
  return (
    <group>
      {segments.map((seg) => (
        <PathLine key={seg.operationId} segment={seg} />
      ))}
    </group>
  );
}
