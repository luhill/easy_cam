import { useEffect, useRef } from 'react';
import type { PartBounds } from '../../lib/geometryProcessing';
import type { ToolpathSegment } from '../../types/operations';

interface Viewer2DProps {
  bounds: PartBounds | null;
  toolpaths: ToolpathSegment[];
}

interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function fitTransform(
  bounds: PartBounds,
  width: number,
  height: number,
  padding = 28
): ViewTransform {
  const partWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const partDepth = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min((width - padding * 2) / partWidth, (height - padding * 2) / partDepth);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  return {
    scale,
    offsetX: width / 2 - centerX * scale,
    offsetY: height / 2 + centerY * scale,
  };
}

function worldToScreen(x: number, y: number, view: ViewTransform): [number, number] {
  return [x * view.scale + view.offsetX, -y * view.scale + view.offsetY];
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bounds: PartBounds | null,
  toolpaths: ToolpathSegment[],
  view: ViewTransform
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0f1115';
  ctx.fillRect(0, 0, width, height);

  const gridStep = 5;
  ctx.strokeStyle = '#222831';
  ctx.lineWidth = 1;
  const gridWorld = gridStep;
  const [originX, originY] = worldToScreen(0, 0, view);
  ctx.beginPath();
  for (let x = originX % (gridWorld * view.scale); x < width; x += gridWorld * view.scale) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = originY % (gridWorld * view.scale); y < height; y += gridWorld * view.scale) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  ctx.strokeStyle = '#3d4555';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, originY);
  ctx.lineTo(width, originY);
  ctx.moveTo(originX, 0);
  ctx.lineTo(originX, height);
  ctx.stroke();

  if (bounds) {
    const corners: Array<[number, number]> = [
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.minY],
      [bounds.maxX, bounds.maxY],
      [bounds.minX, bounds.maxY],
    ];
    ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    corners.forEach(([x, y], index) => {
      const [sx, sy] = worldToScreen(x, y, view);
      if (index === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  for (const segment of toolpaths) {
    ctx.strokeStyle = segment.color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    segment.points.forEach((point, index) => {
      const [sx, sy] = worldToScreen(point.x, point.y, view);
      if (index === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('2D top view (XY) · WebGL 3D unavailable in this browser', 12, height - 12);
}

export function Viewer2D({ bounds, toolpaths }: Viewer2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      viewRef.current = fitTransform(bounds, rect.width, rect.height);
      drawScene(ctx, rect.width, rect.height, bounds, toolpaths, viewRef.current);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [bounds, toolpaths]);

  return <canvas ref={canvasRef} className="viewer-2d-canvas" aria-label="2D top-down part view" />;
}
