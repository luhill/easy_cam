import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '../../store/useAppStore';
import type { SimulationTimeline } from '../../lib/toolpathSimulation';
import {
  previewWindowDistances,
  sampleSimulationTimeline,
} from '../../lib/toolpathSimulation';
import {
  getEffectiveSimulationDistance,
  getEffectiveSimulationWindow,
  setLiveSimulationDistance,
  clearLiveSimulationDistance,
  commitLiveSimulationDistance,
} from '../../lib/simulationLiveBridge';

interface ToolPreviewLiveProps {
  timeline: SimulationTimeline;
  toolDiameter: number;
}

export function ToolPreviewLive({ timeline, toolDiameter }: ToolPreviewLiveProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const markerRef = useRef<THREE.Mesh>(null);
  const rapidColor = useRef(new THREE.Color('#f59e0b'));
  const cutColor = useRef(new THREE.Color('#e2e8f0'));
  const rapidRing = useRef(new THREE.Color('#fbbf24'));
  const cutRing = useRef(new THREE.Color('#94a3b8'));

  useFrame(() => {
    const group = groupRef.current;
    if (!group || timeline.samples.length === 0) return;

    const distance = getEffectiveSimulationDistance();
    const { start: simulationWindowStart, end: simulationWindowEnd } =
      getEffectiveSimulationWindow();
    const { simulationShowTool } = useAppStore.getState();

    const { start, end } = previewWindowDistances(
      timeline.totalDistance,
      simulationWindowStart,
      simulationWindowEnd
    );
    const inWindow =
      timeline.totalDistance <= 0 || (distance >= start - 1e-6 && distance <= end + 1e-6);

    if (!inWindow) {
      group.visible = false;
      return;
    }

    const sample = sampleSimulationTimeline(timeline, distance);
    if (!sample) {
      group.visible = false;
      return;
    }

    group.visible = true;
    group.position.set(sample.x, sample.y, sample.z);

    const color = sample.rapid ? rapidColor.current : cutColor.current;
    const ring = sample.rapid ? rapidRing.current : cutRing.current;

    if (simulationShowTool) {
      if (bodyRef.current) {
        bodyRef.current.visible = true;
        (bodyRef.current.material as THREE.MeshStandardMaterial).color.copy(color);
      }
      if (ringRef.current) {
        ringRef.current.visible = true;
        (ringRef.current.material as THREE.MeshBasicMaterial).color.copy(ring);
      }
      if (markerRef.current) markerRef.current.visible = false;
    } else {
      if (bodyRef.current) bodyRef.current.visible = false;
      if (ringRef.current) ringRef.current.visible = false;
      if (markerRef.current) {
        markerRef.current.visible = true;
        (markerRef.current.material as THREE.MeshBasicMaterial).color.copy(color);
      }
    }
  });

  const r = Math.max(toolDiameter / 2, 0.05);

  return (
    <group ref={groupRef}>
      <mesh ref={bodyRef} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r, Math.max(r * 0.6, 0.2), 16]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh ref={ringRef} position={[0, 0, r * 0.35]}>
        <ringGeometry args={[r * 0.85, r, 24]} />
        <meshBasicMaterial color="#94a3b8" side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={markerRef} visible={false}>
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshBasicMaterial color="#e2e8f0" depthTest />
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
}

export function ToolSimulationDriver({
  playing,
  speed,
  feedRate,
  rapidFeedRate,
  timeline,
}: ToolSimulationDriverProps) {
  useFrame((_, delta) => {
    if (!playing || timeline.totalDistance <= 0) return;

    const store = useAppStore.getState();
    const { start: windowStart, end: windowEnd } = getEffectiveSimulationWindow();
    const { end } = previewWindowDistances(
      timeline.totalDistance,
      windowStart,
      windowEnd
    );

    const current = getEffectiveSimulationDistance();
    const sample = sampleSimulationTimeline(timeline, current);
    const rate = sample?.rapid ? rapidFeedRate : feedRate;
    const next = current + rate * speed * (delta / 60);

    if (next >= end) {
      setLiveSimulationDistance(end);
      store.setSimulationDistance(end);
      clearLiveSimulationDistance();
      store.setSimulationPlaying(false);
      return;
    }

    setLiveSimulationDistance(next);
  });

  return null;
}

export { commitLiveSimulationDistance, clearLiveSimulationDistance, setLiveSimulationDistance };
