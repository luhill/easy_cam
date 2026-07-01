import { useAppStore } from '../store/useAppStore';

/** Transient distance used during scrub/play to avoid React re-renders every frame. */
let liveDistance: number | null = null;

export function setLiveSimulationDistance(distance: number): void {
  liveDistance = distance;
}

export function clearLiveSimulationDistance(): void {
  liveDistance = null;
}

export function getEffectiveSimulationDistance(): number {
  if (liveDistance !== null) return liveDistance;
  return useAppStore.getState().simulationDistance;
}

export function commitLiveSimulationDistance(): void {
  if (liveDistance === null) return;
  useAppStore.getState().setSimulationDistance(liveDistance);
  liveDistance = null;
}

export function syncLiveSimulationDistanceFromStore(): void {
  liveDistance = useAppStore.getState().simulationDistance;
}
