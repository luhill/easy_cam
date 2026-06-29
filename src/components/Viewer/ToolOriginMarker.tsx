import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import type { ToolOrigin } from '../../lib/geometryProcessing';

interface ToolOriginMarkerProps {
  origin: ToolOrigin;
  /** World Z of stock top (CAM Z=0). */
  stockTopWorldZ?: number;
}

export function ToolOriginMarker({ origin, stockTopWorldZ = 0 }: ToolOriginMarkerProps) {
  const axisLength = 8;
  const worldZ = stockTopWorldZ + origin.z;

  const axes = useMemo(() => {
    const points = [
      [origin.x, origin.y, worldZ, origin.x + axisLength, origin.y, worldZ],
      [origin.x, origin.y, worldZ, origin.x, origin.y + axisLength, worldZ],
      [origin.x, origin.y, worldZ, origin.x, origin.y, worldZ + axisLength],
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
  }, [origin.x, origin.y, worldZ]);

  useEffect(() => () => axes.dispose(), [axes]);

  return (
    <group>
      <lineSegments geometry={axes}>
        <lineBasicMaterial vertexColors linewidth={2} />
      </lineSegments>
      <mesh position={[origin.x, origin.y, worldZ]}>
        <sphereGeometry args={[0.8, 12, 12]} />
        <meshBasicMaterial color="#f59e0b" />
      </mesh>
    </group>
  );
}
