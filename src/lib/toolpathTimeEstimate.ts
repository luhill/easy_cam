import type { Operation, ToolpathPoint, ToolpathSegment } from '../types/operations';
import { PREVIEW_RAPID_FEED } from './toolpathSimulation';

export interface TimeEstimateResult {
  totalSeconds: number;
  enabledOperationCount: number;
}

const FEED_MATCH_TOLERANCE = 0.02;

function matchesPlungeFeed(
  prev: ToolpathPoint,
  curr: ToolpathPoint,
  plungeRate: number
): boolean {
  const feed = curr.feedRate ?? prev.feedRate;
  return (
    feed !== undefined &&
    Math.abs(feed - plungeRate) / Math.max(plungeRate, 1) <= FEED_MATCH_TOLERANCE
  );
}

function segmentFeedRate(
  prev: ToolpathPoint,
  curr: ToolpathPoint,
  op: Operation
): number {
  if (curr.rapid || prev.rapid) return PREVIEW_RAPID_FEED;

  const dx = curr.x - prev.x;
  const dy = curr.y - prev.y;
  const dz = curr.z - prev.z;
  const xy = Math.hypot(dx, dy);
  if (matchesPlungeFeed(prev, curr, op.settings.plungeRate) || (Math.abs(dz) > 0.01 && Math.abs(dz) >= xy * 0.5)) {
    return op.settings.plungeRate;
  }

  return curr.feedRate ?? prev.feedRate ?? op.settings.feedRate;
}

export function estimateToolpathTime(
  operations: Operation[],
  toolpaths: ToolpathSegment[]
): TimeEstimateResult {
  const opById = new Map(operations.map((op) => [op.id, op]));
  let totalSeconds = 0;
  let enabledOperationCount = 0;
  const countedOps = new Set<string>();

  for (const segment of toolpaths) {
    const op = opById.get(segment.operationId);
    if (!op?.enabled) continue;
    if (!countedOps.has(op.id)) {
      countedOps.add(op.id);
      enabledOperationCount += 1;
    }

    for (let i = 1; i < segment.points.length; i++) {
      const prev = segment.points[i - 1];
      const curr = segment.points[i];
      const dist = Math.hypot(curr.x - prev.x, curr.y - prev.y, curr.z - prev.z);
      if (dist < 1e-9) continue;
      const feed = segmentFeedRate(prev, curr, op);
      totalSeconds += (dist / feed) * 60;
    }
  }

  return { totalSeconds, enabledOperationCount };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}
