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

export function previewWindowDistances(
  totalDistance: number,
  windowStart: number,
  windowEnd: number
): { start: number; end: number; span: number } {
  const start = windowStart * totalDistance;
  const end = windowEnd * totalDistance;
  return { start, end, span: Math.max(end - start, 0) };
}

export function clampDistanceToWindow(distance: number, start: number, end: number): number {
  return Math.max(start, Math.min(end, distance));
}

export function sampleSimulationTimeline(
  timeline: SimulationTimeline,
  distance: number
): SimulationSample | null {
  const { samples, totalDistance } = timeline;
  if (samples.length === 0) return null;
  if (distance <= samples[0].distance) return { ...samples[0], distance };
  if (distance >= totalDistance) return { ...samples[samples.length - 1], distance };

  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].distance <= distance) lo = mid;
    else hi = mid;
  }

  const a = samples[lo];
  const b = samples[hi];
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

/** Step simulation to the next or previous toolpath point (sample index). */
export function stepSimulationDistance(
  timeline: SimulationTimeline,
  distance: number,
  stepPoints: number,
  windowStart = 0,
  windowEnd?: number
): number {
  const { samples, totalDistance } = timeline;
  const end = windowEnd ?? totalDistance;
  if (samples.length === 0) return windowStart;
  if (stepPoints === 0) {
    return clampDistanceToWindow(
      Math.max(0, Math.min(totalDistance, distance)),
      windowStart,
      end
    );
  }

  let idx = 0;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].distance <= distance + 1e-6) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const nextIdx = Math.max(0, Math.min(samples.length - 1, idx + stepPoints));
  return clampDistanceToWindow(samples[nextIdx].distance, windowStart, end);
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
  const CHUNK = 8192;
  for (const segment of segments) {
    const pts = segment.points;
    for (let i = 0; i < pts.length; i += CHUNK) {
      points.push(...pts.slice(i, Math.min(i + CHUNK, pts.length)));
    }
  }
  return points;
}

function lerpPoint(a: ToolpathPoint, b: ToolpathPoint, t: number): ToolpathPoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    rapid: a.rapid || b.rapid,
    feedRate: b.feedRate ?? a.feedRate,
  };
}

/** Extract toolpath segments visible within a cumulative distance window. */
export function filterToolpathSegmentsByDistance(
  segments: ToolpathSegment[],
  startDistance: number,
  endDistance: number
): ToolpathSegment[] {
  if (endDistance <= startDistance) return [];

  let distance = 0;
  const filtered: ToolpathSegment[] = [];

  for (const segment of segments) {
    const windowPoints: ToolpathPoint[] = [];

    for (let i = 0; i < segment.points.length; i++) {
      const point = segment.points[i];
      const prev = i > 0 ? segment.points[i - 1] : null;
      const segLen =
        prev !== null
          ? Math.hypot(point.x - prev.x, point.y - prev.y, point.z - prev.z)
          : 0;
      const pointDistance = i === 0 ? distance : distance + segLen;

      if (prev && segLen > 1e-9) {
        const prevDistance = distance;
        const crossesStart =
          prevDistance < startDistance && pointDistance > startDistance + 1e-6;
        const crossesEnd =
          prevDistance < endDistance && pointDistance > endDistance + 1e-6;

        if (crossesStart && windowPoints.length === 0) {
          const t = (startDistance - prevDistance) / segLen;
          windowPoints.push(lerpPoint(prev, point, t));
        }

        const inWindow =
          pointDistance >= startDistance - 1e-6 && pointDistance <= endDistance + 1e-6;
        if (inWindow) {
          if (windowPoints.length === 0 && prev && prevDistance >= startDistance - 1e-6) {
            windowPoints.push(prev);
          }
          windowPoints.push(point);
        }

        if (crossesEnd) {
          const t = (endDistance - prevDistance) / segLen;
          windowPoints.push(lerpPoint(prev, point, t));
          break;
        }
      } else if (pointDistance >= startDistance && pointDistance <= endDistance) {
        windowPoints.push(point);
      }

      if (i > 0) distance = pointDistance;
    }

    if (windowPoints.length >= 2) {
      filtered.push({ ...segment, points: windowPoints });
    }
  }

  return filtered;
}
