// src/components/GalaxyGraph.tsx
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { forceCollide } from 'd3-force';
import { forceCluster } from './galaxy/forceCluster';
import { computeHull, drawHull, drawClusterLabel } from './galaxy/hull';
import { useGalaxyData } from './galaxy/useGalaxyData';
import { InfoCard } from './galaxy/InfoCard';
import { shortGloss, toneColor } from './SynonymGraph';
import type { GraphNode, GraphLink, ClusterMeta } from './galaxy/types';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const HULL_PAD = 22;
const LOAD_CHECK_INTERVAL_MS = 2000;

// Static star-field: generated once at module load (deterministic)
const STARS = (() => {
  const stars: { x: number; y: number; r: number; a: number }[] = [];
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 220; i++) {
    stars.push({ x: rand(), y: rand(), r: rand() * 0.8 + 0.3, a: rand() * 0.25 + 0.05 });
  }
  return stars;
})();

export default function GalaxyGraph() {
  const router = useRouter();
  const { graphData, clusterMetas, loading, error, loadingMore, loadMore, hasMore } = useGalaxyData();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [cardDismissing, setCardDismissing] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const graphRef = useRef<any>(null);
  const fittedRef = useRef(false);
  const lastCheckRef = useRef(0);
  const clusterMetasRef = useRef<ClusterMeta[]>([]);
  const graphDataRef = useRef(graphData);
  const selectedNodeIdRef = useRef<string | null>(null);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const selectedAtRef = useRef<number>(0);
  const [hoveredStarter, setHoveredStarter] = useState<string | null>(null);
  const loadMoreRef = useRef(loadMore);
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(false);
  const dimsRef = useRef(dims);

  function dismissCard() {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    setCardDismissing(true);
    dismissTimerRef.current = setTimeout(() => {
      setSelectedNodeId(null);
      setCardDismissing(false);
    }, 160);
  }

  // Keep refs in sync
  useEffect(() => { clusterMetasRef.current = clusterMetas; }, [clusterMetas]);
  useEffect(() => { graphDataRef.current = graphData; }, [graphData]);
  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
    if (selectedNodeId) selectedAtRef.current = Date.now();
  }, [selectedNodeId]);
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
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    setCardDismissing(false);
    setSelectedNodeId((prev) => prev === node.id ? null : node.id);
  }, []);

  const handleBackgroundClick = useCallback(() => {
    dismissCard();
  }, []);

  // Escape key to dismiss InfoCard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && selectedNodeId) dismissCard();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId]);

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    if (typeof document !== 'undefined') {
      document.body.style.cursor = node ? 'pointer' : 'default';
    }
    hoveredNodeIdRef.current = node?.id ?? null;
  }, []);

  // Hull + viewport-load-trigger drawn before nodes
  const onRenderFramePre = useCallback((ctx: CanvasRenderingContext2D, globalScale: number) => {
    const metas = clusterMetasRef.current;
    const nodes = graphDataRef.current.nodes;

    // Draw twinkling star-field in screen space
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cw = (ctx.canvas as HTMLCanvasElement).width;
    const ch = (ctx.canvas as HTMLCanvasElement).height;
    const t = Date.now() / 1000;
    for (const s of STARS) {
      // Each star twinkles at its own pace using its position as phase offset
      const phase = (s.x * 17.3 + s.y * 11.7) % (2 * Math.PI);
      const osc = 0.5 + 0.5 * Math.sin(t * (0.4 + s.a * 1.5) + phase);
      const alpha = s.a * (0.35 + 0.65 * osc);
      ctx.beginPath();
      ctx.arc(s.x * cw, s.y * ch, s.r, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(232,213,176,${alpha})`;
      ctx.fill();
    }
    ctx.restore();

    // Draw cluster hulls
    for (const meta of metas) {
      const pts = nodes
        .filter((n) => meta.wordIds.has(n.id) && n.x !== undefined)
        .map((n) => ({ x: n.x!, y: n.y! }));

      const hull = computeHull(pts, HULL_PAD);
      if (!hull) continue;

      // Smooth interpolation of hull/label visibility across zoom levels
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);
      // t1: 0 at zoom=0.4, 1 at zoom=0.7 — transition from "zoomed-out" to "mid"
      const t1 = clamp((globalScale - 0.4) / 0.3, 0, 1);
      // t2: 0 at zoom=1.2, 1 at zoom=1.8 — transition from "mid" to "zoomed-in"
      const t2 = clamp((globalScale - 1.2) / 0.6, 0, 1);
      const fillAlpha   = lerp(lerp(0.18, 0.06, t1), 0.04, t2);
      const strokeAlpha = lerp(lerp(0.40, 0.20, t1), 0.12, t2);
      const labelOpacity = lerp(lerp(1.0, 0.3, t1), 0.0, t2);

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
    const fadeAlpha = Math.min(1, (Date.now() - selectedAtRef.current) / 250);
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
      const hue = link.hue;

      const fontSize = 10 / globalScale;
      ctx.font = `400 ${fontSize}px 'JetBrains Mono', monospace`;
      const tw = ctx.measureText(glossText).width;
      const pw = tw + 8 / globalScale;
      const ph = fontSize * 1.6;

      ctx.fillStyle = `rgba(10,8,6,${0.95 * fadeAlpha})`;
      ctx.strokeStyle = `hsla(${hue}, 60%, 65%, ${fadeAlpha * 0.8})`;
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

      ctx.fillStyle = `hsla(${hue}, 60%, 72%, ${fadeAlpha})`;
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

    // Circle (with glow for selected)
    if (isSelected) {
      ctx.shadowColor = 'rgba(217,164,65,0.55)';
      ctx.shadowBlur = 18;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = `hsla(${hue}, 55%, 55%, ${alpha * 0.8})`;
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue}, 55%, 65%, ${alpha})`;
    ctx.lineWidth = r * 0.08;
    ctx.stroke();
    if (isSelected) {
      ctx.shadowBlur = 0;
    }

    // Hover ring
    if (hoveredNodeIdRef.current === node.id && !isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, 2 * Math.PI);
      ctx.strokeStyle = `hsla(${hue}, 65%, 70%, 0.5)`;
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();
    }

    // Selection ring — slowly rotating dashes
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, 2 * Math.PI);
      ctx.strokeStyle = '#d9a441';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.lineDashOffset = -(Date.now() / 80);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    // Character
    const fontSize = r * 1.1;
    ctx.font = `900 ${fontSize}px 'Noto Serif SC', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(255,248,235,${alpha * 0.95})`;
    ctx.fillText(node.id, x, y);

    // Pinyin below (close zoom only) — tone-colored
    if (globalScale >= 1.5) {
      const pSize = r * 0.5;
      ctx.font = `300 ${pSize}px 'JetBrains Mono', monospace`;
      const tc = toneColor(node.pinyin);
      // tc is a CSS color string; apply alpha by painting on an offscreen approach via globalAlpha
      ctx.globalAlpha = alpha * 0.72;
      ctx.fillStyle = tc;
      ctx.fillText(node.pinyin, x, y + r + pSize * 0.9);
      ctx.globalAlpha = 1;

      // Short gloss at very high zoom
      if (globalScale >= 2.8 && node.raw_glosses?.length > 0) {
        const gloss = shortGloss(node.raw_glosses[0]);
        if (gloss) {
          const gSize = r * 0.38;
          ctx.font = `300 ${gSize}px 'JetBrains Mono', monospace`;
          const glossAlpha = Math.min(1, (globalScale - 2.8) / 0.4);
          ctx.fillStyle = `rgba(232,213,176,${alpha * 0.35 * glossAlpha})`;
          ctx.fillText(gloss, x, y + r + pSize * 0.9 + gSize * 1.4);
        }
      }
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
      <div style={{ position: 'fixed', inset: 0, background: '#0a0806', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '28px' }}>
        <style>{`
          @keyframes glxTwinkle { 0%,100%{opacity:0.12} 50%{opacity:0.6} }
          @keyframes glxPulse { 0%,100%{transform:scale(1);opacity:0.55} 50%{transform:scale(1.55);opacity:1} }
          @keyframes glxFadeIn { from{opacity:0;transform:translateY(7px)} to{opacity:1;transform:translateY(0)} }
          .glx-loading { animation: glxFadeIn 0.65s cubic-bezier(0.22,1,0.36,1) both; }
          .glx-t1 { animation: glxTwinkle 2.1s ease-in-out infinite; }
          .glx-t2 { animation: glxTwinkle 1.8s ease-in-out infinite 0.5s; }
          .glx-t3 { animation: glxTwinkle 2.5s ease-in-out infinite 1.1s; }
          .glx-t4 { animation: glxTwinkle 1.6s ease-in-out infinite 0.3s; }
          .glx-t5 { animation: glxTwinkle 2.3s ease-in-out infinite 0.8s; }
          .glx-center { animation: glxPulse 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        `}</style>
        <svg className="glx-loading" width={280} height={90} viewBox="0 0 280 90" fill="none">
          <line x1="32" y1="20" x2="78" y2="48" stroke="#d9a441" strokeWidth="0.7" opacity="0.14"/>
          <line x1="78" y1="48" x2="132" y2="14" stroke="#d9a441" strokeWidth="0.7" opacity="0.14"/>
          <line x1="132" y1="14" x2="188" y2="52" stroke="#d9a441" strokeWidth="0.7" opacity="0.14"/>
          <line x1="188" y1="52" x2="248" y2="24" stroke="#d9a441" strokeWidth="0.7" opacity="0.14"/>
          <line x1="78" y1="48" x2="112" y2="74" stroke="#d9a441" strokeWidth="0.7" opacity="0.09"/>
          <line x1="188" y1="52" x2="212" y2="76" stroke="#d9a441" strokeWidth="0.7" opacity="0.09"/>
          <circle cx="50" cy="66" r="1" fill="#d9a441" opacity="0.2" className="glx-t3"/>
          <circle cx="162" cy="72" r="1" fill="#d9a441" opacity="0.2" className="glx-t5"/>
          <circle cx="258" cy="62" r="1" fill="#d9a441" opacity="0.15" className="glx-t2"/>
          <circle cx="32" cy="20" r="2" fill="#d9a441" opacity="0.45" className="glx-t1"/>
          <circle cx="78" cy="48" r="2.5" fill="#d9a441" opacity="0.5" className="glx-t2"/>
          <circle cx="132" cy="14" r="2" fill="#d9a441" opacity="0.4" className="glx-t4"/>
          <circle cx="188" cy="52" r="3" fill="#d9a441" opacity="0.7" className="glx-center"/>
          <circle cx="248" cy="24" r="2" fill="#d9a441" opacity="0.45" className="glx-t3"/>
          <circle cx="112" cy="74" r="1.5" fill="#d9a441" opacity="0.3" className="glx-t5"/>
          <circle cx="212" cy="76" r="1.5" fill="#d9a441" opacity="0.35" className="glx-t1"/>
        </svg>
        <span className="glx-loading" style={{ color: 'rgba(217,164,65,0.38)', fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase' as const, fontFamily: "'JetBrains Mono', monospace", animationDelay: '0.18s' }}>
          Loading star map…
        </span>
      </div>
    );
  }

  if (error || graphData.nodes.length === 0) {
    const starters = ['看','说','走','想','好','知道','觉得','认为','喜欢','听'];
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0a0806', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: '24px' }}>
        {/* Decorative constellation dots */}
        <svg width={300} height={80} style={{ opacity: 0.15 }}>
          {[
            [40,20],[80,50],[130,15],[190,45],[240,20],[270,55],
            [60,60],[150,60],[220,35]
          ].map(([x,y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 2.5 : 1.5} fill="#d9a441" />
          ))}
          {[[40,20],[80,50],[130,15],[190,45],[240,20]].reduce((acc: React.ReactElement[], _, i, arr) => {
            if (i < arr.length - 1) acc.push(
              <line key={i} x1={arr[i][0]} y1={arr[i][1]} x2={arr[i+1][0]} y2={arr[i+1][1]}
                stroke="#d9a441" strokeWidth={0.8} />
            );
            return acc;
          }, [])}
        </svg>
        <div style={{ textAlign: 'center' as const, display: 'flex', flexDirection: 'column' as const, gap: '8px' }}>
          <span style={{ color: 'rgba(217,164,65,0.5)', fontSize: '14px', letterSpacing: '0.1em', fontFamily: "'JetBrains Mono', monospace" }}>
            start exploring
          </span>
          <span style={{ color: 'rgba(217,164,65,0.2)', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.06em' }}>
            type any Chinese word above, or try:
          </span>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' as const, justifyContent: 'center' as const, maxWidth: '360px' }}>
          {starters.map(w => {
            const isHov = hoveredStarter === w;
            return (
              <button key={w}
                style={{
                  color: '#d9a441', fontSize: '22px', fontFamily: 'Noto Serif SC, serif', fontWeight: 900,
                  background: isHov ? 'rgba(217,164,65,0.14)' : 'rgba(217,164,65,0.06)',
                  border: `1px solid ${isHov ? 'rgba(217,164,65,0.45)' : 'rgba(217,164,65,0.2)'}`,
                  borderRadius: '8px', padding: '8px 14px', cursor: 'pointer',
                  transform: isHov ? 'translateY(-2px)' : 'none',
                  transition: 'background 0.15s, border-color 0.15s, transform 0.15s',
                }}
                onClick={() => {
                  const url = `/cluster/${encodeURIComponent(w)}`;
                  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
                    (document as any).startViewTransition(() => router.push(url));
                  } else {
                    router.push(url);
                  }
                }}
                onMouseEnter={() => setHoveredStarter(w)}
                onMouseLeave={() => setHoveredStarter(null)}
              >{w}</button>
            );
          })}
        </div>
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
          clusterHue={selectedNode.hue}
          core_scene={selectedNode.core_scene}
          raw_glosses={selectedNode.raw_glosses}
          onDismiss={dismissCard}
          dismissing={cardDismissing}
        />
      )}
      {loadingMore && (
        <div style={{
          position: 'fixed', bottom: '14px', right: '16px',
          display: 'flex', alignItems: 'center', gap: '6px',
          color: 'rgba(217,164,65,0.35)', fontSize: '10px',
          fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.1em',
          pointerEvents: 'none',
        }}>
          <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', transformOrigin: 'center' }}>✦</span>
          <span>expanding</span>
        </div>
      )}
    </>
  );
}
