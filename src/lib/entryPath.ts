import type { LoopPoint, OperationDefaults, ToolpathPoint } from '../types/operations';
import {
  closestPointOnLoop2D,
  distanceToLoop2D,
  pointInPolygon2D,
} from './geometryProcessing';

/** Helix circle radius from diameter % (default 1.5× tool ⌀ → radius 0.75× tool ⌀). */
export function resolveHelixRadius(settings: OperationDefaults): number {
  const toolD = Math.max(settings.toolDiameter, 0.1);
  return (settings.helixDiameterPercent / 100) * toolD / 2;
}

/** One revolution Z drop from helix lead angle (degrees). */
export function helixPitchFromAngle(settings: OperationDefaults): number {
  const helixR = Math.max(resolveHelixRadius(settings), 0.05);
  const angleRad = (settings.helixAngleDeg * Math.PI) / 180;
  return Math.max(2 * Math.PI * helixR * Math.tan(angleRad), 0.05);
}

export function loopCentroid2D(loop: LoopPoint[]): { x: number; y: number } {
  if (loop.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of loop) {
    x += p.x;
    y += p.y;
  }
  return { x: x / loop.length, y: y / loop.length };
}

/** Push entry outward if it lies inside the part or too close to the outline. */
export function ensureEntryOutsidePart(
  partLoop: LoopPoint[],
  point: { x: number; y: number },
  minDist: number
): { x: number; y: number } {
  const inside = pointInPolygon2D(point.x, point.y, partLoop);
  const dist = distanceToLoop2D(point.x, point.y, partLoop);
  if (!inside && dist >= minDist) return point;

  const closest = closestPointOnLoop2D(point.x, point.y, partLoop);
  const standoff = Math.max(minDist, 0.5);
  return {
    x: closest.x + closest.outX * standoff,
    y: closest.y + closest.outY * standoff,
  };
}

export function closestPointIndexOnPath(
  path: ToolpathPoint[],
  point: { x: number; y: number }
): number {
  if (path.length === 0) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = Math.hypot(path[i].x - point.x, path[i].y - point.y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Horizontal toroidal arc from entry to the outline join point, bulging away from
 * the part so the tool stays in open stock.
 */
export function generateToroidalLeadIn(
  from: { x: number; y: number },
  to: { x: number; y: number },
  arcRadius: number,
  z: number,
  partLoop: LoopPoint[],
  feedRate: number
): ToolpathPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-4) return [{ x: to.x, y: to.y, z, feedRate }];

  const R = Math.max(arcRadius, chord / 2 + 0.05);
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const tx = dx / chord;
  const ty = dy / chord;
  const n1x = -ty;
  const n1y = tx;

  const centroid = loopCentroid2D(partLoop);
  const toCentroidX = centroid.x - mx;
  const toCentroidY = centroid.y - my;
  const outward =
    toCentroidX * n1x + toCentroidY * n1y > 0
      ? { nx: -n1x, ny: -n1y }
      : { nx: n1x, ny: n1y };

  const halfChord = chord / 2;
  const h = Math.sqrt(Math.max(R * R - halfChord * halfChord, 0));
  const cx = mx + outward.nx * h;
  const cy = my + outward.ny * h;

  const a1 = Math.atan2(from.y - cy, from.x - cx);
  const a2 = Math.atan2(to.y - cy, to.x - cx);

  let sweep1 = a2 - a1;
  while (sweep1 <= 1e-9) sweep1 += 2 * Math.PI;
  let sweep2 = sweep1 - 2 * Math.PI;

  const sampleArc = (sweep: number): ToolpathPoint[] => {
    const steps = Math.max(4, Math.ceil((Math.abs(sweep) * R) / 0.4));
    const pts: ToolpathPoint[] = [];
    for (let i = 1; i <= steps; i++) {
      const ang = a1 + (sweep * i) / steps;
      pts.push({
        x: cx + R * Math.cos(ang),
        y: cy + R * Math.sin(ang),
        z,
        feedRate,
      });
    }
    return pts;
  };

  const arc1 = sampleArc(sweep1);
  const arc2 = sampleArc(sweep2);

  const score = (pts: ToolpathPoint[]) => {
    let minDist = Infinity;
    for (const p of pts) {
      minDist = Math.min(minDist, distanceToLoop2D(p.x, p.y, partLoop));
    }
    return minDist;
  };

  return score(arc1) >= score(arc2) ? arc1 : arc2;
}

export function minimumEntryStandoff(settings: OperationDefaults): number {
  const toolR = Math.max(settings.toolDiameter, 0.1) / 2;
  const radialOffset = settings.radialOffset ?? 0;
  const slotWidthPercent = Math.max(settings.slotWidthPercent ?? 150, 125);
  const slotWidth = settings.toolDiameter * (slotWidthPercent / 100);
  const maxCenterDist = radialOffset + slotWidth - toolR;
  return maxCenterDist + Math.max(settings.clearance, 1);
}
