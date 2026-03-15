# Galaxy Word Explorer — Design Spec

**Date:** 2026-03-15
**Project:** tongyizuo (同义词星图)
**Status:** Approved

---

## Overview

Replace the current flat force-directed graph with a **Galaxy Explorer**: a zoom-adaptive canvas where Chinese synonym clusters appear as glowing constellation blobs at distance, resolve into individual labeled word nodes as you zoom in, and reveal connecting gloss labels when you select a word. On-demand loading keeps the initial payload small while letting you roam the entire dictionary.

---

## User Experience

### Zoom Level 1 — Galaxy View (`globalScale < 0.5`)

- Each cluster renders as a **soft glowing ellipse** (convex hull of its word positions), filled with the cluster's hue at low opacity, outlined with the same hue at medium opacity
- A gloss label floats at the cluster centroid (e.g. "fall", "happy")
- A small word-count badge sits below the label
- Individual word nodes exist in the simulation but are too small to read — the blob dominates visually
- Faint dashed lines connect clusters that share overlapping gloss tokens

### Zoom Level 2 — Neighborhood View (`0.5 ≤ globalScale < 1.5`)

- The hull outline fades to subtle; the gloss label fades to 30% opacity
- Individual word nodes become visible as colored circles with Chinese characters
- Edges between words are visible but unlabeled
- Distant clusters remain as blobs

### Zoom Level 3 — Close-Up View (`globalScale ≥ 1.5`)

- Hull is nearly invisible (4% fill, 12% stroke)
- Full word nodes: Chinese character + pinyin below
- Edges visible at 25% opacity, width proportional to shared-gloss weight
- **Click a word node:**
  - That node gets a dashed gold selection ring
  - Its edges highlight to 90% opacity
  - Gloss pills appear floating on each of its edges (e.g. "fall", "drop", "slip")
  - All other nodes dim to 30% opacity; unconnected edges drop to 6%
  - An info card appears (bottom-left) showing: large character, pinyin, cluster label, core\_scene, "Explore this cluster →" button
  - Click empty space to deselect

### On-Demand Loading

- **Initial load:** top 30 clusters by word\_count (~120 words) — loads in one API call, force sim settles
- **Progressive loading:** when the user pans so that less than 40% of the viewport is occupied by loaded nodes, the next batch of 30 clusters is fetched and quietly added to the simulation (nodes fade+drift in)
- Loaded clusters are cached in a client-side `Map<clusterId, ClusterBatch>` — never re-fetched
- A batch counter tracks offset; loading stops when the API returns an empty array

### Navigation

- **"Explore this cluster →"** button in the info card → `router.push('/cluster/:word')` — navigates to the existing rich cluster page (collocations, challenge mode)
- Search bar in the top overlay still works for direct navigation

---

## Architecture

### New API Route: `GET /api/galaxy?offset=0&limit=30`

Returns a self-contained batch of cluster data.

**Query flow:**
1. Fetch clusters ordered by `word_count DESC` with `LIMIT 30 OFFSET $offset`
2. For each cluster batch, fetch member words (`simplified`, `pinyin`, `degree` from synonym\_edge count)
3. Fetch intra-cluster edges with gloss: `synonym_edges` joined to `gloss_tokens` → `{ source, target, gloss }`

**Response shape:**
```ts
{
  clusters: Array<{
    id: number
    label: string        // e.g. "fall"
    hue: number          // 0-359, pre-computed from label hash
    words: Array<{
      id: string         // simplified character(s)
      pinyin: string
      degree: number     // synonym edge count (for node sizing)
    }>
    edges: Array<{
      source: string     // simplified
      target: string     // simplified
      gloss: string      // connecting gloss token, e.g. "fall"
    }>
  }>
  hasMore: boolean
}
```

Cache: `revalidate: 3600`. No auth required.

### Modified Component: `GlobalGraph.tsx` → `GalaxyGraph.tsx`

Client-only (`'use client'` + `dynamic(..., { ssr: false })`).

**State:**
- `batches: ClusterBatch[]` — accumulated loaded data
- `selectedNodeId: string | null`
- `dims: { width, height }`
- `loadingMore: boolean`
- `hasMore: boolean`
- `offset: number`

**Force simulation tuning (via `graphRef.current.d3Force`):**
- `forceLink`: distance `40`, strength `0.8` — tight intra-cluster edges
- `forceManyBody`: strength `-60` — mild global repulsion
- `forceCluster` (custom): each node is pulled toward its cluster centroid with strength `0.12` — keeps clusters visually grouped
- `forceCollide`: radius = `nodeRadius + 6`

**Custom cluster force:**
```ts
function forceCluster(nodes, alpha) {
  // compute centroids per cluster
  // nudge each node toward its cluster centroid * alpha * 0.12
}
```
Applied via `graphRef.current.d3Force('cluster', forceCluster)`.

**Hull rendering (`onRenderFramePre`):**
- For each loaded cluster, collect the `(x, y)` positions of its word nodes
- Compute convex hull using `d3.polygonHull` (already available via d3-polygon, a transitive dep of d3-force)
- Expand hull outward by `hullPad = 20` pixels
- At `globalScale < 0.5`: fill = `hsla(hue, 55%, 55%, 0.18)`, stroke = `hsla(hue, 55%, 55%, 0.4)`, draw label
- At `0.5 ≤ globalScale < 1.5`: fill `0.06`, stroke `0.2`, label at 30% opacity
- At `globalScale ≥ 1.5`: fill `0.04`, stroke `0.12`, no label

**Node rendering (`nodeCanvasObject`):**
- Radius: `Math.max(8, Math.log2(degree + 1) * 2.5)` (graph-space units, not screen-space — no more inverse-scale trick which caused visual popping)
- At `globalScale < 0.5`: draw only a tiny dot (3px), no label — the hull is the visual
- At `0.5 ≤ globalScale < 1.5`: circle + Chinese character
- At `globalScale ≥ 1.5`: circle + character + pinyin below
- If `selectedNodeId` is set: non-selected nodes render at 30% opacity; selected node gets a dashed ring

**Edge rendering:**
- `linkColor`: if no selection → `hsla(hue, 55%, 55%, 0.25)`; if selection active and edge doesn't touch selected node → `rgba(217,164,65,0.06)`; if edge touches selected node → `rgba(217,164,65,0.9)`
- `linkWidth`: `Math.log(weight + 1) * 0.6`
- Gloss pills drawn in `onRenderFramePost` (after nodes) for selected node's edges only

**Gloss pill rendering (`onRenderFramePost`):**
- For each edge touching `selectedNodeId`:
  - Compute midpoint `(mx, my)`
  - Draw rounded rect background: `rgba(10,8,6,0.95)` fill, `#d9a441` stroke
  - Draw gloss text: `#d9a441`, monospace, 10px

**Info card (React overlay, `position: fixed`, bottom-left):**
- Shown when `selectedNodeId !== null`
- Fetches `core_scene` from the already-loaded batch data (no extra API call needed if core\_scene is included in the galaxy API response — add it)
- Contains: large character (32px, gold), pinyin, cluster label, core\_scene (italic, muted), "Explore this cluster →" button
- Dismiss on empty-canvas click (handled in `onBackgroundClick` prop)

**Viewport-based load trigger:**
- On every `onRenderFramePre` call (throttled to once per 2s): compute the fraction of the viewport that contains loaded nodes
- If `< 0.4` and `!loadingMore` and `hasMore`: trigger `loadMore()`
- `loadMore()` increments offset, fetches next batch, merges into simulation

### Updated `page.tsx`

- Import `GalaxyGraph` (renamed from `GlobalGraph`)
- No other changes — top overlay bar stays identical

### File Changes Summary

| File | Action |
|------|--------|
| `src/components/GlobalGraph.tsx` | Rename → `GalaxyGraph.tsx`, full rewrite |
| `src/app/page.tsx` | Update import only |
| `src/app/api/galaxy/route.ts` | New file |
| `src/app/api/graph/route.ts` | Keep (still used by nothing now, can deprecate later) |

---

## Data Constraints

- `core_scene` may be `null` for unenriched words — info card shows the raw gloss label as fallback
- Clusters with only 1 member after filtering still appear (hull is a circle)
- The `d3.polygonHull` function returns `null` for < 3 points — fall back to circle hull for 1-2 node clusters
- Word nodes that belong to multiple clusters get colored by their highest-degree cluster

---

## Out of Scope

- Touch/mobile pinch-zoom (react-force-graph-2d handles this natively)
- User progress tracking on the galaxy view
- Fog-of-war / visited state persistence
- Animations between zoom levels (LOD switching is immediate)
