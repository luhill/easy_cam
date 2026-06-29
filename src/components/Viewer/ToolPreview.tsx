import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SimulationSample, SimulationTimeline } from '../../lib/toolpathSimulation';
import { sampleSimulationTimeline } from '../../lib/toolpathSimulation';

interface ToolPreviewProps {
  sample: SimulationSample | null;
  toolDiameter: number;
  showTool?: boolean;
}

export function ToolPreview({ sample, toolDiameter, showTool = true }: ToolPreviewProps) {
  if (!sample) return null;

  const color = sample.rapid ? '#f59e0b' : '#e2e8f0';

  if (!showTool) {
    return (
      <mesh position={[sample.x, sample.y, sample.z]}>
        <sphereGeometry args={[0.22, 10, 10]} />
        <meshBasicMaterial color={color} depthTest />
      </mesh>
    );
  }

  const r = Math.max(toolDiameter / 2, 0.05);

  return (
    <group position={[sample.x, sample.y, sample.z]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r, Math.max(r * 0.6, 0.2), 24]} />
        <meshStandardMaterial color={color} metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0, r * 0.35]}>
        <ringGeometry args={[r * 0.85, r, 32]} />
        <meshBasicMaterial color={sample.rapid ? '#fbbf24' : '#94a3b8'} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

interface ToolSimulationDriverProps {
  playing: boolean;
  speed: number;
  feedRate: number;
  rapidFeedRate: number;
  timeline: SimulationTimeline;
  timelineLength: number;
  onDistanceChange: (distance: number) => void;
  getDistance: () => number;
}

export function ToolSimulationDriver({
  playing,
  speed,
  feedRate,
  rapidFeedRate,
  timeline,
  timelineLength,
  onDistanceChange,
  getDistance,
}: ToolSimulationDriverProps) {
  useFrame((_, delta) => {
    if (!playing || timelineLength <= 0) return;
    const current = getDistance();
    const sample = sampleSimulationTimeline(timeline, current);
    const rate = sample?.rapid ? rapidFeedRate : feedRate;
    const next = current + rate * speed * (delta / 60);
    if (next >= timelineLength) {
      onDistanceChange(timelineLength);
      return;
    }
    onDistanceChange(next);
  });

  return null;
}
