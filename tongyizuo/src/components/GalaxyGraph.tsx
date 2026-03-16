// src/components/GalaxyGraph.tsx
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { forceCollide } from 'd3-force';
import { forceCluster } from './galaxy/forceCluster';
import { computeHull, drawHull, drawClusterLabel } from './galaxy/hull';
import { useGalaxyData } from './galaxy/useGalaxyData';
import { InfoCard } from './galaxy/InfoCard';
import type { GraphNode, GraphLink, ClusterMeta } from './galaxy/types';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const HULL_PAD = 22;
const LOAD_CHECK_INTERVAL_MS = 2000;

export default function GalaxyGraph() {
  const { graphData, clusterMetas, loading, error, loadingMore, loadMore, hasMore } = useGalaxyData();
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
    fg.d3Force('collide', forceCollide<GraphNode>().radius((n: GraphNode) => Math.max(8, Math.log2(n.degree + 1) * 2.5) + 6));
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
        <span style={{ color: 'rgba(217,164,65,0.35)', fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase' as const }}>
          Loading star map…
        </span>
      </div>
    );
  }

  if (error || graphData.nodes.length === 0) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0a0806', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
        <span style={{ color: 'rgba(217,164,65,0.2)', fontSize: '48px' }}>✦</span>
        <span style={{ color: 'rgba(217,164,65,0.45)', fontSize: '14px', letterSpacing: '0.08em' }}>
          星图暂时无法加载
        </span>
        <span style={{ color: 'rgba(217,164,65,0.2)', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.06em' }}>
          Search a word above to explore its cluster
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
