# Galaxy Word Explorer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat force-directed graph on the home page with a zoom-adaptive galaxy explorer where synonym clusters appear as glowing blobs, resolve into labeled word nodes on zoom, and reveal connecting gloss labels when a word is selected.

**Architecture:** Single `react-force-graph-2d` canvas with a custom cluster-cohesion force keeps words grouped. Hull overlays drawn in `onRenderFramePre` provide the "blob" visual at low zoom. On-demand loading fetches the next 30 clusters when the user pans toward empty space. A React overlay (`InfoCard`) shows selected word detail without leaving the canvas.

**Tech Stack:** Next.js 15 App Router, TypeScript, react-force-graph-2d, @vercel/postgres, d3-polygon (new), inline CSS (no Tailwind)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/api/galaxy/route.ts` | Create | DB queries → paginated cluster batches with words, edges, glosses |
| `src/components/galaxy/forceCluster.ts` | Create | Custom d3 force factory: pulls words toward their cluster centroid |
| `src/components/galaxy/hull.ts` | Create | Convex hull computation + canvas drawing utilities |
| `src/components/galaxy/useGalaxyData.ts` | Create | Data fetching hook: initial load + progressive load trigger |
| `src/components/galaxy/InfoCard.tsx` | Create | Fixed React overlay showing selected word detail |
| `src/components/GalaxyGraph.tsx` | Create | Main canvas component: wires all utilities + force graph |
| `src/components/GlobalGraph.tsx` | Delete | Replaced by GalaxyGraph.tsx |
| `src/app/page.tsx` | Modify | Swap GlobalGraph import for GalaxyGraph |

---

## Chunk 1: API Route

### Task 1: Install d3-polygon

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install d3-polygon and its types**

Run from the project root (`tongyizuo/`):

```bash
npm install d3-polygon && npm install --save-dev @types/d3-polygon
```

Expected output: `added N packages` with no errors.

- [ ] **Step 2: Verify import works**

```bash
node -e "const { polygonHull } = require('d3-polygon'); console.log(typeof polygonHull)"
```

Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add d3-polygon dependency"
```

---

### Task 2: Create `/api/galaxy` route

**Files:**
- Create: `src/app/api/galaxy/route.ts`

This route returns a paginated batch of clusters with their member words (including `core_scene`), aggregated intra-cluster edges (with all gloss tokens), and a `hasMore` flag.

- [ ] **Step 1: Create the file**

```typescript
// src/app/api/galaxy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const revalidate = 3600;

function labelToHue(label: string): number {
  let h = 0;
  for (const c of label) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return h % 360;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '30', 10)));

  // 1. Fetch cluster batch
  const clusterRows = await sql`
    SELECT id, label, word_count
    FROM synonym_clusters
    ORDER BY word_count DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  if (clusterRows.rows.length === 0) {
    return NextResponse.json({ clusters: [], hasMore: false });
  }

  const clusterIds = clusterRows.rows.map((r) => r.id);

  // 2. Fetch member words with degree (synonym edge count) and core_scene
  const wordRows = await sql`
    SELECT
      cm.cluster_id,
      w.simplified,
      w.pinyin,
      w.core_scene,
      (
        SELECT COUNT(*)::int FROM synonym_edges
        WHERE word1_id = w.id OR word2_id = w.id
      ) AS degree
    FROM cluster_members cm
    JOIN words w ON w.id = cm.word_id
    WHERE cm.cluster_id = ANY(${clusterIds as any}::int[])
  `;

  // 3. Fetch intra-cluster edges, aggregated per word pair with all glosses
  const edgeRows = await sql`
    SELECT
      se.cluster_id,
      w1.simplified AS source,
      w2.simplified AS target,
      array_agg(DISTINCT gt.token ORDER BY gt.token) AS glosses,
      COUNT(*)::int AS weight
    FROM synonym_edges se
    JOIN words w1 ON w1.id = se.word1_id
    JOIN words w2 ON w2.id = se.word2_id
    JOIN gloss_tokens gt ON gt.id = se.gloss_id
    WHERE se.cluster_id = ANY(${clusterIds as any}::int[])
    GROUP BY se.cluster_id, w1.simplified, w2.simplified
  `;

  // 4. Check if more clusters exist
  const countRow = await sql`SELECT COUNT(*)::int AS total FROM synonym_clusters`;
  const total = countRow.rows[0].total;
  const hasMore = offset + limit < total;

  // Assemble response
  const wordsByCluster: Record<number, typeof wordRows.rows> = {};
  for (const r of wordRows.rows) {
    if (!wordsByCluster[r.cluster_id]) wordsByCluster[r.cluster_id] = [];
    wordsByCluster[r.cluster_id].push(r);
  }

  const edgesByCluster: Record<number, typeof edgeRows.rows> = {};
  for (const r of edgeRows.rows) {
    if (!edgesByCluster[r.cluster_id]) edgesByCluster[r.cluster_id] = [];
    edgesByCluster[r.cluster_id].push(r);
  }

  const clusters = clusterRows.rows.map((c) => ({
    id: c.id,
    label: c.label,
    hue: labelToHue(c.label),
    words: (wordsByCluster[c.id] ?? []).map((w) => ({
      id: w.simplified,
      pinyin: w.pinyin ?? '',
      degree: w.degree ?? 1,
      core_scene: w.core_scene ?? null,
    })),
    edges: (edgesByCluster[c.id] ?? []).map((e) => ({
      source: e.source,
      target: e.target,
      glosses: e.glosses as string[],
      weight: e.weight,
    })),
  }));

  return NextResponse.json({ clusters, hasMore });
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "galaxy/route"
```

Expected: no output (no errors in this file).

- [ ] **Step 3: Smoke-test the route**

Start dev server (`npm run dev`) and visit:
`http://localhost:3000/api/galaxy?offset=0&limit=5`

Expected: JSON with `clusters` array (length ≤ 5), each cluster having `id`, `label`, `hue` (0–359), `words` array, `edges` array, and `hasMore: true/false`.

Verify one cluster manually: `hue` should be a number (0–359), `words[0]` should have `id` (Chinese chars), `pinyin`, `degree` (integer ≥ 1), `core_scene` (string or null). Also verify `edges[0].glosses` is an array (not null) — `array_agg` returns null when no rows match, which would break gloss pill rendering.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/galaxy/route.ts
git commit -m "feat: add /api/galaxy paginated cluster endpoint"
```

---

## Chunk 2: Canvas Utilities

### Task 3: Create `forceCluster.ts`

**Files:**
- Create: `src/components/galaxy/forceCluster.ts`

A D3-compatible custom force factory. Pulls each node toward the centroid of its cluster, keeping clusters visually grouped.

- [ ] **Step 1: Create the file**

```typescript
// src/components/galaxy/forceCluster.ts

export interface ClusteredNode {
  cluster: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

/**
 * D3 force factory: attracts nodes toward their cluster centroid.
 * Strength 0.12 — enough to group clusters without fighting other forces.
 * Usage: simulation.force('cluster', forceCluster())
 */
export function forceCluster<N extends ClusteredNode>() {
  let nodes: N[] = [];

  function force(alpha: number) {
    // Compute centroid per cluster
    const centroids: Record<string, { x: number; y: number; n: number }> = {};
    for (const n of nodes) {
      const c =
        centroids[n.cluster] ?? (centroids[n.cluster] = { x: 0, y: 0, n: 0 });
      c.x += n.x ?? 0;
      c.y += n.y ?? 0;
      c.n++;
    }
    for (const c of Object.values(centroids)) {
      c.x /= c.n;
      c.y /= c.n;
    }

    // Nudge each node toward its cluster centroid
    const strength = 0.12 * alpha;
    for (const n of nodes) {
      const c = centroids[n.cluster];
      if (!c) continue;
      n.vx = (n.vx ?? 0) + (c.x - (n.x ?? 0)) * strength;
      n.vy = (n.vy ?? 0) + (c.y - (n.y ?? 0)) * strength;
    }
  }

  force.initialize = (n: N[]) => {
    nodes = n;
  };

  return force;
}
```

- [ ] **Step 2: Verify with a quick node script**

```bash
node -e "
const { forceCluster } = require('./src/components/galaxy/forceCluster');
// Simulate 2 nodes in same cluster
const nodes = [
  { cluster: 'a', x: 0, y: 0, vx: 0, vy: 0 },
  { cluster: 'a', x: 10, y: 0, vx: 0, vy: 0 },
];
const f = forceCluster();
f.initialize(nodes);
f(1.0); // alpha = 1
// Both nodes should be pulled toward centroid (5, 0)
// node[0].vx should be positive (pulled right toward centroid)
console.log('node[0].vx > 0:', nodes[0].vx > 0);
console.log('node[1].vx < 0:', nodes[1].vx < 0);
"
```

> Note: this requires the file to be CommonJS-compatible. If the project is ESM-only, run the TypeScript check instead:

```bash
npx tsc --noEmit 2>&1 | grep "forceCluster"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/galaxy/forceCluster.ts
git commit -m "feat: add forceCluster d3 force utility"
```

---

### Task 4: Create `hull.ts`

**Files:**
- Create: `src/components/galaxy/hull.ts`

Convex hull computation (via d3-polygon) and canvas drawing utilities. Handles the <3-point fallback and hull outward expansion.

- [ ] **Step 1: Create the file**

```typescript
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
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "hull"
```

Expected: no errors. If `@types/d3-polygon` is missing, install it:
```bash
npm install --save-dev @types/d3-polygon
```

- [ ] **Step 3: Verify computeHull behaviour**

```bash
node -e "
// Quick sanity: hull of a triangle should return 3 points (expanded)
const { computeHull } = require('./src/components/galaxy/hull');
const pts = [{x:0,y:0},{x:10,y:0},{x:5,y:10}];
const h = computeHull(pts, 5);
console.log('hull length >= 3:', h && h.length >= 3);
console.log('expanded outward:', h && h[0].x < 0); // first pt moved left of origin
"
```

> If ESM issues arise, use `npx tsc --noEmit` only.

- [ ] **Step 4: Commit**

```bash
git add src/components/galaxy/hull.ts
git commit -m "feat: add hull computation and drawing utilities"
```

---

## Chunk 3: React Components

### Task 5: Create `useGalaxyData.ts`

**Files:**
- Create: `src/components/galaxy/useGalaxyData.ts`

Manages all data fetching: initial load, progressive load triggering (viewport-based), and accumulated state.

- [ ] **Step 1: Define shared types first**

Create `src/components/galaxy/types.ts`:

```typescript
// src/components/galaxy/types.ts

export interface GalaxyWord {
  id: string;           // simplified characters — used as node id
  pinyin: string;
  degree: number;
  core_scene: string | null;
}

export interface GalaxyEdge {
  source: string;
  target: string;
  glosses: string[];
  weight: number;
}

export interface GalaxyCluster {
  id: number;
  label: string;
  hue: number;
  words: GalaxyWord[];
  edges: GalaxyEdge[];
}

export interface GalaxyBatchResponse {
  clusters: GalaxyCluster[];
  hasMore: boolean;
}

/** Node shape passed to react-force-graph-2d */
export interface GraphNode extends GalaxyWord {
  cluster: string;      // cluster id as string (for forceCluster key)
  hue: number;
  clusterLabel: string;
  // d3-force adds these at runtime:
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

/** Link shape passed to react-force-graph-2d */
export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  glosses: string[];
  weight: number;
  hue: number;          // inherited from cluster for coloring
}

/** Per-cluster metadata kept for hull rendering */
export interface ClusterMeta {
  id: number;
  label: string;
  hue: number;
  wordCount: number;
  wordIds: Set<string>;
}
```

- [ ] **Step 2: Create the hook**

```typescript
// src/components/galaxy/useGalaxyData.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  GalaxyBatchResponse,
  GraphNode,
  GraphLink,
  ClusterMeta,
} from './types';

const BATCH_SIZE = 30;

export interface GalaxyGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface UseGalaxyDataReturn {
  graphData: GalaxyGraphData;
  clusterMetas: ClusterMeta[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

export function useGalaxyData(): UseGalaxyDataReturn {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [clusterMetas, setClusterMetas] = useState<ClusterMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const loadedClusterIds = useRef(new Set<number>());

  const mergeBatch = useCallback((data: GalaxyBatchResponse) => {
    const newNodes: GraphNode[] = [];
    const newLinks: GraphLink[] = [];
    const newMetas: ClusterMeta[] = [];

    for (const cluster of data.clusters) {
      if (loadedClusterIds.current.has(cluster.id)) continue;
      loadedClusterIds.current.add(cluster.id);

      const wordIds = new Set(cluster.words.map((w) => w.id));
      newMetas.push({
        id: cluster.id,
        label: cluster.label,
        hue: cluster.hue,
        wordCount: cluster.words.length,
        wordIds,
      });

      for (const word of cluster.words) {
        // If this word is already in the graph from another cluster, skip
        // (multi-cluster words use their first-seen cluster for coloring)
        newNodes.push({
          ...word,
          cluster: String(cluster.id),
          hue: cluster.hue,
          clusterLabel: cluster.label,
        });
      }

      for (const edge of cluster.edges) {
        newLinks.push({
          ...edge,
          hue: cluster.hue,
        });
      }
    }

    setNodes((prev) => {
      const existingIds = new Set(prev.map((n) => n.id));
      return [...prev, ...newNodes.filter((n) => !existingIds.has(n.id))];
    });
    setLinks((prev) => [...prev, ...newLinks]);
    setClusterMetas((prev) => [...prev, ...newMetas]);
    setHasMore(data.hasMore);
  }, []);

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetch(`/api/galaxy?offset=0&limit=${BATCH_SIZE}`)
      .then((r) => r.json())
      .then((data: GalaxyBatchResponse) => {
        offsetRef.current = BATCH_SIZE;
        mergeBatch(data);
      })
      .finally(() => setLoading(false));
  }, [mergeBatch]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const offset = offsetRef.current;
    // Advance offset before fetch to prevent double-trigger if loadMore is called again
    offsetRef.current = offset + BATCH_SIZE;
    fetch(`/api/galaxy?offset=${offset}&limit=${BATCH_SIZE}`)
      .then((r) => r.json())
      .then((data: GalaxyBatchResponse) => {
        mergeBatch(data);
      })
      .finally(() => setLoadingMore(false));
  }, [loadingMore, hasMore, mergeBatch]);

  return {
    graphData: { nodes, links },
    clusterMetas,
    loading,
    loadingMore,
    hasMore,
    loadMore,
  };
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -E "useGalaxyData|types"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/galaxy/
git commit -m "feat: add galaxy data types and useGalaxyData hook"
```

---

### Task 6: Create `InfoCard.tsx`

**Files:**
- Create: `src/components/galaxy/InfoCard.tsx`

Fixed React overlay showing the selected word's character, pinyin, cluster label, core_scene, and a navigation button. Rendered outside the canvas so it stays interactive.

- [ ] **Step 1: Create the component**

```typescript
// src/components/galaxy/InfoCard.tsx
'use client';

import { useRouter } from 'next/navigation';

interface InfoCardProps {
  simplified: string;
  pinyin: string;
  clusterLabel: string;
  core_scene: string | null;
}

export function InfoCard({ simplified, pinyin, clusterLabel, core_scene }: InfoCardProps) {
  const router = useRouter();

  return (
    <div style={s.card}>
      <span className="zh" style={s.char}>{simplified}</span>
      <span style={s.pinyin}>{pinyin}</span>
      <span style={s.cluster}>{clusterLabel}</span>
      {core_scene
        ? <p style={s.scene}>{core_scene}</p>
        : <p style={s.scene}>{clusterLabel}</p>
      }
      <button
        style={s.btn}
        onClick={() => router.push(`/cluster/${encodeURIComponent(simplified)}`)}
      >
        Explore this cluster →
      </button>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    position: 'fixed',
    bottom: '28px',
    left: '28px',
    zIndex: 20,
    background: 'rgba(10,8,6,0.88)',
    border: '1px solid rgba(217,164,65,0.35)',
    borderRadius: '12px',
    padding: '18px 20px',
    minWidth: '200px',
    maxWidth: '280px',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  char: {
    fontSize: '40px',
    color: '#d9a441',
    lineHeight: 1,
    display: 'block',
  },
  pinyin: {
    fontSize: '13px',
    color: 'rgba(232,213,176,0.6)',
    fontFamily: "'JetBrains Mono', monospace",
    display: 'block',
    marginTop: '2px',
  },
  cluster: {
    fontSize: '11px',
    color: 'rgba(217,164,65,0.5)',
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    display: 'block',
    marginTop: '4px',
  },
  scene: {
    fontSize: '12px',
    color: 'rgba(232,213,176,0.55)',
    lineHeight: 1.5,
    fontStyle: 'italic',
    marginTop: '8px',
    marginBottom: '0',
  },
  btn: {
    marginTop: '14px',
    padding: '8px 14px',
    background: 'rgba(217,164,65,0.12)',
    border: '1px solid rgba(217,164,65,0.35)',
    borderRadius: '6px',
    color: '#d9a441',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'pointer',
    textAlign: 'left',
  },
};
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "InfoCard"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/galaxy/InfoCard.tsx
git commit -m "feat: add InfoCard overlay component"
```

---

### Task 7: Create `GalaxyGraph.tsx`

**Files:**
- Create: `src/components/GalaxyGraph.tsx`

Main canvas component. Wires together `useGalaxyData`, `forceCluster`, hull rendering, and the `InfoCard` overlay. Handles selection state, gloss pill rendering, and viewport-based load triggering.

- [ ] **Step 1: Create the component**

```typescript
// src/components/GalaxyGraph.tsx
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { forceCluster } from './galaxy/forceCluster';
import { computeHull, drawHull, drawClusterLabel } from './galaxy/hull';
import { useGalaxyData } from './galaxy/useGalaxyData';
import { InfoCard } from './galaxy/InfoCard';
import type { GraphNode, GraphLink, ClusterMeta } from './galaxy/types';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const HULL_PAD = 22;
const LOAD_CHECK_INTERVAL_MS = 2000;

export default function GalaxyGraph() {
  const { graphData, clusterMetas, loading, loadingMore, loadMore, hasMore } = useGalaxyData();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const graphRef = useRef<any>(null);
  const fittedRef = useRef(false);
  const lastCheckRef = useRef(0);
  const clusterMetasRef = useRef<ClusterMeta[]>([]);
  const graphDataRef = useRef(graphData);
  const selectedNodeIdRef = useRef<string | null>(null);
  const loadMoreRef = useRef(loadMore);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(false);
  const dimsRef = useRef(dims);

  // Keep refs in sync
  useEffect(() => { clusterMetasRef.current = clusterMetas; }, [clusterMetas]);
  useEffect(() => { graphDataRef.current = graphData; }, [graphData]);
  useEffect(() => { selectedNodeIdRef.current = selectedNodeId; }, [selectedNodeId]);
  useEffect(() => { loadMoreRef.current = loadMore; }, [loadMore]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { loadingMoreRef.current = loadingMore; }, [loadingMore]);
  useEffect(() => { dimsRef.current = dims; }, [dims]);

  // Window dimensions
  useEffect(() => {
    setDims({ width: window.innerWidth, height: window.innerHeight });
    const onResize = () => setDims({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Apply custom forces after graph data loads
  useEffect(() => {
    if (!graphRef.current || graphData.nodes.length === 0) return;
    const fg = graphRef.current;
    fg.d3Force('link')?.distance(40).strength(0.8);
    fg.d3Force('charge')?.strength(-60);
    fg.d3Force('collide')?.radius((n: GraphNode) => Math.max(8, Math.log2(n.degree + 1) * 2.5) + 6);
    fg.d3Force('cluster', forceCluster());
    fg.d3ReheatSimulation();
  }, [graphData.nodes.length]);

  const handleEngineStop = useCallback(() => {
    if (!fittedRef.current && graphRef.current) {
      fittedRef.current = true;
      graphRef.current.zoomToFit(400, 80);
    }
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNodeId((prev) => prev === node.id ? null : node.id);
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    if (typeof document !== 'undefined') {
      document.body.style.cursor = node ? 'pointer' : 'default';
    }
  }, []);

  // Hull + viewport-load-trigger drawn before nodes
  const onRenderFramePre = useCallback((ctx: CanvasRenderingContext2D, globalScale: number) => {
    const metas = clusterMetasRef.current;
    const nodes = graphDataRef.current.nodes;

    // Draw cluster hulls
    for (const meta of metas) {
      const pts = nodes
        .filter((n) => meta.wordIds.has(n.id) && n.x !== undefined)
        .map((n) => ({ x: n.x!, y: n.y! }));

      const hull = computeHull(pts, HULL_PAD);
      if (!hull) continue;

      let fillAlpha: number, strokeAlpha: number, labelOpacity: number;
      if (globalScale < 0.5) {
        fillAlpha = 0.18; strokeAlpha = 0.4; labelOpacity = 1;
      } else if (globalScale < 1.5) {
        fillAlpha = 0.06; strokeAlpha = 0.2; labelOpacity = 0.3;
      } else {
        fillAlpha = 0.04; strokeAlpha = 0.12; labelOpacity = 0;
      }

      drawHull(
        ctx, hull,
        `hsla(${meta.hue}, 55%, 55%, ${fillAlpha})`,
        `hsla(${meta.hue}, 55%, 55%, ${strokeAlpha})`,
        1 / globalScale,
      );

      if (labelOpacity > 0) {
        drawClusterLabel(ctx, pts, meta.label, meta.wordCount, meta.hue, globalScale, labelOpacity);
      }
    }

    // Viewport-based load trigger (throttled)
    const now = Date.now();
    if (
      now - lastCheckRef.current > LOAD_CHECK_INTERVAL_MS &&
      !loadingMoreRef.current &&
      hasMoreRef.current &&
      graphRef.current
    ) {
      lastCheckRef.current = now;
      const fg = graphRef.current;
      const { width, height } = dimsRef.current;
      const tl = fg.screen2GraphCoords(0, 0);
      const br = fg.screen2GraphCoords(width, height);
      const total = nodes.length;
      if (total > 0) {
        const inView = nodes.filter(
          (n) =>
            n.x !== undefined &&
            n.x >= tl.x && n.x <= br.x &&
            n.y !== undefined &&
            n.y >= tl.y && n.y <= br.y,
        ).length;
        if (inView / total < 0.4) {
          loadMoreRef.current();
        }
      }
    }
  }, []);

  // Gloss pills drawn after nodes
  const onRenderFramePost = useCallback((ctx: CanvasRenderingContext2D, globalScale: number) => {
    const sel = selectedNodeIdRef.current;
    if (!sel || globalScale < 0.8) return;

    const links = graphDataRef.current.links as GraphLink[];
    for (const link of links) {
      const src = link.source as GraphNode;
      const tgt = link.target as GraphNode;
      if (src?.x === undefined || tgt?.x === undefined) continue;
      if (src.id !== sel && tgt.id !== sel) continue;

      const mx = (src.x + tgt.x) / 2;
      const my = (src.y! + tgt.y!) / 2;
      const glossText = link.glosses.slice(0, 2).join(' · ');

      const fontSize = 10 / globalScale;
      ctx.font = `400 ${fontSize}px 'JetBrains Mono', monospace`;
      const tw = ctx.measureText(glossText).width;
      const pw = tw + 8 / globalScale;
      const ph = fontSize * 1.6;

      ctx.fillStyle = 'rgba(10,8,6,0.95)';
      ctx.strokeStyle = '#d9a441';
      ctx.lineWidth = 0.8 / globalScale;
      const rx = 3 / globalScale;
      // Rounded rect
      ctx.beginPath();
      ctx.moveTo(mx - pw / 2 + rx, my - ph / 2);
      ctx.lineTo(mx + pw / 2 - rx, my - ph / 2);
      ctx.arcTo(mx + pw / 2, my - ph / 2, mx + pw / 2, my - ph / 2 + rx, rx);
      ctx.lineTo(mx + pw / 2, my + ph / 2 - rx);
      ctx.arcTo(mx + pw / 2, my + ph / 2, mx + pw / 2 - rx, my + ph / 2, rx);
      ctx.lineTo(mx - pw / 2 + rx, my + ph / 2);
      ctx.arcTo(mx - pw / 2, my + ph / 2, mx - pw / 2, my + ph / 2 - rx, rx);
      ctx.lineTo(mx - pw / 2, my - ph / 2 + rx);
      ctx.arcTo(mx - pw / 2, my - ph / 2, mx - pw / 2 + rx, my - ph / 2, rx);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#d9a441';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glossText, mx, my);
    }
  }, []);

  const nodeCanvasObject = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const r = Math.max(8, Math.log2(node.degree + 1) * 2.5);
    const sel = selectedNodeIdRef.current;
    const isSelected = sel === node.id;
    const dimmed = sel !== null && !isSelected;
    const alpha = dimmed ? 0.3 : 1;
    const hue = node.hue;

    if (globalScale < 0.5) {
      // Far: tiny dot only
      ctx.beginPath();
      ctx.arc(x, y, 3 / globalScale, 0, 2 * Math.PI);
      ctx.fillStyle = `hsla(${hue}, 55%, 55%, ${alpha * 0.7})`;
      ctx.fill();
      return;
    }

    // Circle
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = `hsla(${hue}, 55%, 55%, ${alpha * 0.8})`;
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue}, 55%, 65%, ${alpha})`;
    ctx.lineWidth = r * 0.08;
    ctx.stroke();

    // Selection ring
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
      ctx.strokeStyle = '#d9a441';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Character
    const fontSize = r * 1.1;
    ctx.font = `900 ${fontSize}px 'Noto Serif SC', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(255,248,235,${alpha * 0.95})`;
    ctx.fillText(node.id, x, y);

    // Pinyin below (close zoom only)
    if (globalScale >= 1.5) {
      const pSize = r * 0.5;
      ctx.font = `300 ${pSize}px 'JetBrains Mono', monospace`;
      ctx.fillStyle = `rgba(232,213,176,${alpha * 0.5})`;
      ctx.fillText(node.pinyin, x, y + r + pSize * 0.9);
    }
  }, []);

  const nodePointerAreaPaint = useCallback((node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
    const r = Math.max(8, Math.log2(node.degree + 1) * 2.5) + 4;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }, []);

  const linkColor = useCallback((link: GraphLink) => {
    const sel = selectedNodeIdRef.current;
    if (!sel) return `hsla(${link.hue}, 55%, 55%, 0.25)`;
    const src = link.source as GraphNode;
    const tgt = link.target as GraphNode;
    if (src?.id === sel || tgt?.id === sel) return 'rgba(217,164,65,0.9)';
    return 'rgba(217,164,65,0.06)';
  }, []);

  const linkWidth = useCallback((link: GraphLink) => Math.log(link.weight + 1) * 0.6, []);

  // Find selected node data for InfoCard
  const selectedNode = selectedNodeId
    ? graphData.nodes.find((n) => n.id === selectedNodeId) ?? null
    : null;

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0a0806', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'rgba(217,164,65,0.35)', fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Loading star map…
        </span>
      </div>
    );
  }

  return (
    <>
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={dims.width}
        height={dims.height}
        backgroundColor="#0a0806"
        nodeCanvasObject={nodeCanvasObject as any}
        nodePointerAreaPaint={nodePointerAreaPaint as any}
        linkColor={linkColor as any}
        linkWidth={linkWidth as any}
        onNodeClick={handleNodeClick as any}
        onNodeHover={handleNodeHover as any}
        onBackgroundClick={handleBackgroundClick}
        onRenderFramePre={onRenderFramePre as any}
        onRenderFramePost={onRenderFramePost as any}
        cooldownTicks={200}
        onEngineStop={handleEngineStop}
        enableNodeDrag={false}
        nodeLabel={() => ''}
      />
      {selectedNode && (
        <InfoCard
          simplified={selectedNode.id}
          pinyin={selectedNode.pinyin}
          clusterLabel={selectedNode.clusterLabel}
          core_scene={selectedNode.core_scene}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep -v "lib/db.ts"
```

Expected: no errors (pre-existing lib/db.ts errors are excluded).

- [ ] **Step 3: Commit**

```bash
git add src/components/GalaxyGraph.tsx
git commit -m "feat: add GalaxyGraph canvas component"
```

---

### Task 8: Wire up `page.tsx` and clean up

**Files:**
- Modify: `src/app/page.tsx`
- Delete: `src/components/GlobalGraph.tsx`

- [ ] **Step 1: Read the current page.tsx to confirm the exact strings**

```bash
cat src/app/page.tsx | head -10
```

Confirm it contains a line like:
```typescript
const GlobalGraph = dynamic(() => import('../components/GlobalGraph'), { ssr: false });
```
and a JSX line `<GlobalGraph />`.

- [ ] **Step 2: Update the import and usage in page.tsx**

In `src/app/page.tsx`, replace:
```typescript
const GlobalGraph = dynamic(() => import('../components/GlobalGraph'), { ssr: false });
```
with:
```typescript
const GalaxyGraph = dynamic(() => import('../components/GalaxyGraph'), { ssr: false });
```

And replace the JSX usage `<GlobalGraph />` with `<GalaxyGraph />`.

- [ ] **Step 3: Delete GlobalGraph.tsx**

```bash
rm src/components/GlobalGraph.tsx
```

- [ ] **Step 4: TypeScript check (full)**

```bash
npx tsc --noEmit 2>&1 | grep -v "lib/db.ts"
```

Expected: no errors.

- [ ] **Step 5: Build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes with no errors (warnings about `any` are acceptable).

- [ ] **Step 6: Browser verification**

Start dev server: `npm run dev`

Visit `http://localhost:3000` and verify:

1. **Loading state:** "Loading star map…" text appears briefly
2. **Galaxy view (zoom out):** Colored glowing blobs visible, each labeled with a gloss word (e.g. "fall", "speak"), with a small word count below
3. **Neighborhood view (zoom mid):** Individual word nodes with Chinese characters become visible inside the hulls
4. **Close-up view (zoom in):** Characters + pinyin visible; click a node → dashed gold ring appears, its edges highlight gold, gloss pills float on those edges, InfoCard appears bottom-left
5. **InfoCard:** Shows large character, pinyin, cluster label, core_scene (if available), "Explore this cluster →" button
6. **Navigation:** Clicking "Explore this cluster →" navigates to `/cluster/:word`
7. **Deselect:** Clicking empty canvas dismisses the InfoCard
8. **Progressive loading:** Pan away from initial cluster — after ~2 seconds, new clusters appear at the edges of the graph

- [ ] **Step 7: Final commit**

```bash
git add src/app/page.tsx
git rm src/components/GlobalGraph.tsx
git commit -m "feat: wire GalaxyGraph into home page, remove GlobalGraph"
```
