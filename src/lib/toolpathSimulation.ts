import type { ToolpathPoint, ToolpathSegment } from '../types/operations';

export interface SimulationSample {
  x: number;
  y: number;
  z: number;
  rapid: boolean;
  /** Cumulative travel distance (mm) along the timeline. */
  distance: number;
}

export interface SimulationTimeline {
  samples: SimulationSample[];
  totalDistance: number;
}

export function buildSimulationTimeline(segments: ToolpathSegment[]): SimulationTimeline {
  const samples: SimulationSample[] = [];
  let distance = 0;

  for (const segment of segments) {
    for (let i = 0; i < segment.points.length; i++) {
      const point = segment.points[i];
      if (i > 0) {
        const prev = segment.points[i - 1];
        distance += Math.hypot(point.x - prev.x, point.y - prev.y, point.z - prev.z);
      }
      samples.push({
        x: point.x,
        y: point.y,
        z: point.z,
        rapid: !!point.rapid,
        distance,
      });
    }
  }

  return { samples, totalDistance: distance };
}

export function sampleSimulationTimeline(
  timeline: SimulationTimeline,
  distance: number
): SimulationSample | null {
  const { samples, totalDistance } = timeline;
  if (samples.length === 0) return null;
  if (distance <= 0) return samples[0];
  if (distance >= totalDistance) return samples[samples.length - 1];

  for (let i = 1; i < samples.length; i++) {
    const b = samples[i];
    if (b.distance >= distance) {
      const a = samples[i - 1];
      const span = b.distance - a.distance || 1;
      const t = (distance - a.distance) / span;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        rapid: a.rapid || b.rapid,
        distance,
      };
    }
  }

  return samples[samples.length - 1];
}

/** Default mm/min for rapid segments in preview (not exported G-code). */
export const PREVIEW_RAPID_FEED = 6000;

export function pickPreviewToolDiameter(
  operations: { id: string; visible: boolean; settings: { toolDiameter: number } }[],
  segments: ToolpathSegment[]
): number {
  const visibleIds = new Set(operations.filter((o) => o.visible).map((o) => o.id));
  for (const segment of segments) {
    if (!visibleIds.has(segment.operationId)) continue;
    const op = operations.find((o) => o.id === segment.operationId);
    if (op) return Math.max(op.settings.toolDiameter, 0.1);
  }
  return 6.35;
}

export function flattenVisibleToolpathPoints(segments: ToolpathSegment[]): ToolpathPoint[] {
  const points: ToolpathPoint[] = [];
  for (const segment of segments) {
    points.push(...segment.points);
  }
  return points;
}
