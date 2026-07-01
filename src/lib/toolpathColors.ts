import * as THREE from 'three';
import type { Operation, ToolpathPoint, ToolpathSegment } from '../types/operations';
import { PREVIEW_RAPID_FEED } from './toolpathSimulation';

export type ToolpathColorMode = 'type' | 'speed';

export type ToolpathMoveKind = 'rapid' | 'cut' | 'plunge' | 'travel' | 'spur';

export const TOOLPATH_MOVE_COLORS: Record<ToolpathMoveKind, string> = {
  rapid: '#f59e0b',
  cut: '#e2e8f0',
  plunge: '#3b82f6',
  travel: '#a855f7',
  spur: '#22c55e',
};

export const TOOLPATH_MOVE_LABELS: Record<ToolpathMoveKind, string> = {
  rapid: 'Rapid',
  cut: 'Cut',
  plunge: 'Plunge',
  travel: 'Travel',
  spur: 'Spur',
};

const TRAVEL_FEED_TOLERANCE = 0.02;

function isPlungeMove(a: ToolpathPoint, b: ToolpathPoint): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const xy = Math.hypot(dx, dy);
  return Math.abs(dz) > 0.01 && Math.abs(dz) >= xy * 0.5;
}

function edgeFeedRate(
  a: ToolpathPoint,
  b: ToolpathPoint,
  op: Operation | undefined,
  travelFeedRate: number
): number {
  if (a.rapid || b.rapid) return PREVIEW_RAPID_FEED;
  if (isPlungeMove(a, b)) return op?.settings.plungeRate ?? travelFeedRate;
  return b.feedRate ?? a.feedRate ?? op?.settings.feedRate ?? travelFeedRate;
}

export function classifyToolpathMove(
  a: ToolpathPoint,
  b: ToolpathPoint,
  _op: Operation | undefined,
  travelFeedRate: number
): ToolpathMoveKind {
  if (a.onSpur || b.onSpur) return 'spur';
  if (a.rapid || b.rapid) return 'rapid';
  if (isPlungeMove(a, b)) return 'plunge';

  const feed = b.feedRate ?? a.feedRate;
  if (
    feed !== undefined &&
    Math.abs(feed - travelFeedRate) / Math.max(travelFeedRate, 1) <= TRAVEL_FEED_TOLERANCE
  ) {
    return 'travel';
  }

  return 'cut';
}

/** Orca-style speed gradient: blue (slow) → cyan → green → yellow → red (fast). */
export function feedRateToSpeedColor(
  feed: number,
  minFeed: number,
  maxFeed: number,
  target = new THREE.Color()
): THREE.Color {
  const span = Math.max(maxFeed - minFeed, 1);
  const t = Math.min(1, Math.max(0, (feed - minFeed) / span));
  const hue = (1 - t) * 0.72;
  return target.setHSL(hue, 0.92, 0.52);
}

export interface ToolpathFeedRange {
  min: number;
  max: number;
}

export function computeToolpathFeedRange(
  segments: ToolpathSegment[],
  operations: Operation[],
  travelFeedRate: number
): ToolpathFeedRange {
  const opById = new Map(operations.map((op) => [op.id, op]));
  let min = Infinity;
  let max = 0;

  for (const segment of segments) {
    const op = opById.get(segment.operationId);
    for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1];
      const b = segment.points[i];
      const feed = edgeFeedRate(a, b, op, travelFeedRate);
      if (feed < min) min = feed;
      if (feed > max) max = feed;
    }
  }

  if (!Number.isFinite(min) || min === Infinity) {
    return { min: 0, max: Math.max(travelFeedRate, 1000) };
  }

  return { min, max: Math.max(max, min + 1) };
}

export interface ToolpathEdgeColorInput {
  segments: ToolpathSegment[];
  colorMode: ToolpathColorMode;
  operations: Operation[];
  travelFeedRate: number;
}

export function colorForToolpathEdge(
  a: ToolpathPoint,
  b: ToolpathPoint,
  _segment: ToolpathSegment,
  op: Operation | undefined,
  input: ToolpathEdgeColorInput,
  feedRange: ToolpathFeedRange,
  target = new THREE.Color()
): THREE.Color {
  if (input.colorMode === 'speed') {
    const feed = edgeFeedRate(a, b, op, input.travelFeedRate);
    return feedRateToSpeedColor(feed, feedRange.min, feedRange.max, target);
  }

  const kind = classifyToolpathMove(a, b, op, input.travelFeedRate);
  return target.set(TOOLPATH_MOVE_COLORS[kind]);
}
