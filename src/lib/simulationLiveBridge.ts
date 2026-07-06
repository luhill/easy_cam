import { useAppStore } from '../store/useAppStore';

/** Transient distance used during scrub/play to avoid React re-renders every frame. */
let liveDistance: number | null = null;

/** Transient preview window used during range drag. */
let liveWindow: { start: number; end: number } | null = null;

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

export function setLiveSimulationWindow(start: number, end: number): void {
  liveWindow = { start, end };
}

export function clearLiveSimulationWindow(): void {
  liveWindow = null;
}

export function getEffectiveSimulationWindow(): { start: number; end: number } {
  if (liveWindow) return liveWindow;
  const state = useAppStore.getState();
  return { start: state.simulationWindowStart, end: state.simulationWindowEnd };
}

export function syncLiveSimulationWindowFromStore(): void {
  const state = useAppStore.getState();
  liveWindow = { start: state.simulationWindowStart, end: state.simulationWindowEnd };
}

export function hasLiveSimulationOverride(): boolean {
  return liveDistance !== null || liveWindow !== null;
}
