// src/components/galaxy/hull.ts
import { polygonHull } from 'd3-polygon';

export interface Point {
  x: number;
  y: number;
}

/**
 * Compute convex hull for a set of points.
 * Returns expanded hull path points, or null if < 2 points.
 * For 1-2 points, returns a synthetic circle-approximating polygon.
 */
export function computeHull(points: Point[], pad: number): Point[] | null {
  if (points.length === 0) return null;

  // For 1-2 nodes, synthesize a small circle polygon
  if (points.length < 3) {
    const cx =
      points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy =
      points.reduce((s, p) => s + p.y, 0) / points.length;
    const r = pad * 2;
    return Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * 2 * Math.PI;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });
  }

  const raw = polygonHull(points.map((p) => [p.x, p.y] as [number, number]));
  if (!raw) return null;

  // Expand hull outward: each vertex moves away from centroid by `pad`
  const cx = raw.reduce((s, p) => s + p[0], 0) / raw.length;
  const cy = raw.reduce((s, p) => s + p[1], 0) / raw.length;

  return raw.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: x + (dx / len) * pad, y: y + (dy / len) * pad };
  });
}

/**
 * Draw a convex hull on a canvas context with rounded appearance.
 * hullPoints must have >= 3 entries.
 */
export function drawHull(
  ctx: CanvasRenderingContext2D,
  hullPoints: Point[],
  fillStyle: string,
  strokeStyle: string,
  lineWidth: number,
): void {
  if (hullPoints.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(hullPoints[0].x, hullPoints[0].y);
  for (let i = 1; i < hullPoints.length; i++) {
    ctx.lineTo(hullPoints[i].x, hullPoints[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/**
 * Draw cluster label (gloss text) at centroid position.
 */
export function drawClusterLabel(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  label: string,
  wordCount: number,
  hue: number,
  globalScale: number,
  opacity: number,
): void {
  if (points.length === 0 || opacity <= 0) return;
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;

  const fontSize = 13 / globalScale;
  ctx.font = `500 ${fontSize}px 'JetBrains Mono', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `hsla(${hue}, 60%, 70%, ${opacity})`;
  ctx.fillText(label, cx, cy - fontSize * 0.6);

  const badgeFontSize = fontSize * 0.75;
  ctx.font = `300 ${badgeFontSize}px 'JetBrains Mono', monospace`;
  ctx.fillStyle = `hsla(${hue}, 55%, 65%, ${opacity * 0.55})`;
  ctx.fillText(`${wordCount}`, cx, cy + fontSize * 0.6);
}
