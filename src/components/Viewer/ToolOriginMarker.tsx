import { useMemo } from 'react';
import * as THREE from 'three';
import type { ToolOrigin } from '../../lib/geometryProcessing';

interface ToolOriginMarkerProps {
  origin: ToolOrigin;
}

export function ToolOriginMarker({ origin }: ToolOriginMarkerProps) {
  const axisLength = 8;

  const axes = useMemo(() => {
    const points = [
      [origin.x, origin.y, origin.z, origin.x + axisLength, origin.y, origin.z],
      [origin.x, origin.y, origin.z, origin.x, origin.y + axisLength, origin.z],
      [origin.x, origin.y, origin.z, origin.x, origin.y, origin.z + axisLength],
    ];
    const colors = [
      1, 0.2, 0.2, 1, 0.2, 0.2,
      0.2, 1, 0.2, 0.2, 1, 0.2,
      0.3, 0.5, 1, 0.3, 0.5, 1,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, [origin.x, origin.y, origin.z]);

  return (
    <group>
      <lineSegments geometry={axes}>
        <lineBasicMaterial vertexColors linewidth={2} />
      </lineSegments>
      <mesh position={[origin.x, origin.y, origin.z]}>
        <sphereGeometry args={[0.8, 12, 12]} />
        <meshBasicMaterial color="#f59e0b" />
      </mesh>
    </group>
  );
}
