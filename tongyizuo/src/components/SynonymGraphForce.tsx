'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { ClusterData } from '../../lib/types';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

const PALETTE = ['#d9a441', '#41b8d9', '#d94141', '#41d972', '#9b41d9', '#d97841'];

interface GNode {
  id: string;
  pinyin: string;
  clusterIdx: number;
  isFocus: boolean;
  degree: number;
  fx?: number;
  fy?: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GLink {
  source: string | GNode;
  target: string | GNode;
  gloss: string;
  clusterIdx: number;
  weight: number;
}

interface Props {
  clusters: ClusterData[];
  focusWord: string;
  activeClusterIdx?: number | null;
}

const NAV_H = 56;

function nr(n: GNode) {
  if (n.isFocus) return 44;
  return Math.max(18, Math.min(28, 18 + n.degree * 1.1));
}

function col(idx: number) { return PALETTE[idx % PALETTE.length]; }

// Place N nodes in an arc, returning their (x,y) positions
function placeArc(
  n: number, ccx: number, ccy: number,
  r: number, centerAngle: number, fanAngle: number,
): Array<{ x: number; y: number }> {
  const positions = [];
  for (let i = 0; i < n; i++) {
    const frac = n === 1 ? 0.5 : i / (n - 1);
    const angle = centerAngle - fanAngle / 2 + frac * fanAngle;
    positions.push({ x: ccx + r * Math.cos(angle), y: ccy + r * Math.sin(angle) });
  }
  return positions;
}

// Compute pinned positions for all nodes
function computeLayout(clusters: ClusterData[], focusWord: string, w: number, h: number) {
  const K = clusters.length;
  const cx = w / 2, cy = h / 2;
  const unit = Math.min(w, h);
  const clusterR = unit * 0.30;  // ring radius for cluster centers (larger → more space)

  const edgeDeg: Record<string, number> = {};
  for (const cl of clusters)
    for (const e of cl.edges) {
      edgeDeg[e.word1] = (edgeDeg[e.word1] || 0) + 1;
      edgeDeg[e.word2] = (edgeDeg[e.word2] || 0) + 1;
    }

  const nodes: GNode[] = [];
  const idx = new Map<string, GNode>();

  // Focus pinned at center
  const focus: GNode = {
    id: focusWord, pinyin: '', clusterIdx: -1, isFocus: true, degree: 99,
    fx: cx, fy: cy, x: cx, y: cy,
  };
  nodes.push(focus); idx.set(focusWord, focus);

  // Place cluster member nodes
  for (let ci = 0; ci < K; ci++) {
    const clusterAngle = (2 * Math.PI * ci / K) - Math.PI / 2;
    const ccx = cx + clusterR * Math.cos(clusterAngle);
    const ccy = cy + clusterR * Math.sin(clusterAngle);

    const members = clusters[ci].members
      .filter(m => m.simplified !== focusWord && !idx.has(m.simplified))
      .sort((a, b) => (edgeDeg[b.simplified] || 0) - (edgeDeg[a.simplified] || 0));

    const n = members.length;
    let positions: Array<{ x: number; y: number }>;

    if (n === 0) {
      positions = [];
    } else if (n <= 5) {
      // Single arc
      const r = unit * 0.18;
      const fanAngle = Math.min(Math.PI * 0.80, Math.PI * 0.32 * n);
      positions = placeArc(n, ccx, ccy, r, clusterAngle, fanAngle);
    } else {
      // Double ring: inner (most-connected, fewer) + outer (rest)
      // Keep inner small (max 3 nodes) so spacing is comfortable
      const nInner = Math.min(3, Math.floor(n * 0.35));
      const nOuter = n - nInner;
      const rOuter = unit * 0.22;
      const rInner = unit * 0.12;
      const fanOuter = Math.PI * 0.82;
      const fanInner = Math.PI * 0.50;
      // Inner = top nInner most-connected members
      // Outer = remaining nOuter less-connected members
      const innerPos = placeArc(nInner, ccx, ccy, rInner, clusterAngle, fanInner);
      const outerPos = placeArc(nOuter, ccx, ccy, rOuter, clusterAngle, fanOuter);
      // members[0..nInner-1] → inner positions, members[nInner..n-1] → outer positions
      positions = [...innerPos, ...outerPos];
    }

    positions.forEach((pos, mi) => {
      if (mi >= members.length) return;
      const m = members[mi];
      const node: GNode = {
        id: m.simplified,
        pinyin: m.pinyin_display ?? m.pinyin,
        clusterIdx: ci, isFocus: false,
        degree: edgeDeg[m.simplified] || 1,
        fx: pos.x, fy: pos.y, x: pos.x, y: pos.y,
      };
      nodes.push(node);
      idx.set(m.simplified, node);
    });
  }

  // Links
  const links: GLink[] = [];
  const seen = new Set<string>();
  for (let ci = 0; ci < K; ci++) {
    const pw: Record<string, number> = {};
    const pg: Record<string, string> = {};
    for (const e of clusters[ci].edges) {
      if (!idx.has(e.word1) || !idx.has(e.word2)) continue;
      const k = [e.word1, e.word2].sort().join('\0');
      pw[k] = (pw[k] || 0) + 1; pg[k] = e.gloss;
    }
    for (const [k, w2] of Object.entries(pw)) {
      const gk = `${ci}:${k}`;
      if (seen.has(gk)) continue; seen.add(gk);
      const [a, b] = k.split('\0');
      links.push({ source: a, target: b, gloss: pg[k], clusterIdx: ci, weight: w2 });
    }
  }

  return { nodes, links };
}

export default function SynonymGraphForce({ clusters, focusWord, activeClusterIdx = null }: Props) {
  const router = useRouter();
  const graphRef = useRef<any>(null);

  const [dims, setDims] = useState<{ w: number; h: number }>(() => {
    if (typeof window === 'undefined') return { w: 1200, h: 800 };
    return { w: window.innerWidth, h: window.innerHeight - NAV_H };
  });
  const dimsRef = useRef(dims);
  useEffect(() => { dimsRef.current = dims; }, [dims]);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight - NAV_H;
      dimsRef.current = { w, h };
      setDims({ w, h });
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

  const graphData = useMemo(() =>
    computeLayout(clusters, focusWord, dims.w, dims.h),
  [clusters, focusWord, dims.w, dims.h]);

  // Kill all forces — positions are pinned via fx/fy
  const handleEngineStart = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    g.d3Force('center', null);
    g.d3Force('charge', null);
    g.d3Force('link', null);
    g.d3Force('collide', null);
  }, []);

  useEffect(() => {
    handleEngineStart();
  }, [handleEngineStart, graphData]);

  // Zoom to fit all nodes with padding
  const handleEngineStop = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    g.zoomToFit(500, 80);
  }, []);

  // Fallback zoom-to-fit
  useEffect(() => {
    const t = setTimeout(() => {
      const g = graphRef.current;
      if (!g) return;
      g.zoomToFit(400, 80);
    }, 800);
    return () => clearTimeout(t);
  }, [graphData]);

  const activeId = selectedId ?? hoveredId;

  // --- Renderers ---

  const paintNode = useCallback((node: GNode, ctx: CanvasRenderingContext2D, gs: number) => {
    const r = nr(node);
    const x = node.x ?? 0, y = node.y ?? 0;
    const c = node.isFocus ? '#d9a441' : col(node.clusterIdx);

    let alpha = 1;
    if (activeClusterIdx !== null && !node.isFocus && node.clusterIdx !== activeClusterIdx) alpha = 0.08;
    if (activeId && !node.isFocus && node.id !== activeId) alpha = Math.min(alpha, 0.15);

    ctx.save();
    ctx.globalAlpha = alpha;

    if (node.isFocus) {
      // Glow rings
      for (let i = 4; i >= 1; i--) {
        ctx.beginPath(); ctx.arc(x, y, r + i * 10, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(217,164,65,${0.028 * i})`; ctx.fill();
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(217,164,65,0.16)'; ctx.fill();
      ctx.strokeStyle = 'rgba(217,164,65,0.9)'; ctx.lineWidth = 2.5 / gs; ctx.stroke();

      const fs = focusWord.length === 1 ? r * 0.88 : focusWord.length === 2 ? r * 0.7 : r * 0.54;
      ctx.font = `900 ${fs}px 'Noto Serif SC', serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(217,164,65,0.6)'; ctx.shadowBlur = 20;
      ctx.fillStyle = '#d9a441'; ctx.fillText(focusWord, x, y);
      ctx.shadowBlur = 0;
    } else {
      const isSel = node.id === selectedId;
      const isHov = node.id === hoveredId;

      if (isSel || isHov) {
        ctx.beginPath(); ctx.arc(x, y, r + 12, 0, Math.PI * 2);
        ctx.fillStyle = `${c}14`; ctx.fill();
      }
      if (isSel) {
        ctx.setLineDash([4 / gs, 3 / gs]);
        ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = c; ctx.lineWidth = 1.5 / gs; ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? `${c}22` : `${c}0f`; ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = (isSel ? 2.2 : 1.5) / gs; ctx.stroke();

      const len = node.id.length;
      const fs = len === 1 ? r * 0.86 : len === 2 ? r * 0.68 : r * 0.52;
      ctx.font = `900 ${fs}px 'Noto Serif SC', serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = isHov ? c : `${c}dd`;
      ctx.fillText(node.id, x, y);

      if (gs >= 0.7 || isSel || isHov) {
        const ps = Math.max(7, 9 / gs);
        ctx.font = `300 ${ps}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = `${c}66`;
        ctx.fillText(node.pinyin, x, y + r + ps + 3);
      }
    }
    ctx.restore();
  }, [focusWord, selectedId, hoveredId, activeClusterIdx, activeId]);

  const paintLink = useCallback((link: GLink, ctx: CanvasRenderingContext2D, gs: number) => {
    const s = link.source as GNode, t = link.target as GNode;
    if (!s.x || !s.y || !t.x || !t.y) return;
    const c = col(link.clusterIdx);
    let alpha = 0.28;
    if (activeId) alpha = (s.id === activeId || t.id === activeId) ? 0.92 : 0.04;
    if (activeClusterIdx !== null && link.clusterIdx !== activeClusterIdx) alpha *= 0.07;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
    ctx.strokeStyle = c;
    ctx.lineWidth = (0.6 + link.weight * 0.4) / gs;
    ctx.stroke(); ctx.restore();
  }, [activeId, activeClusterIdx]);

  const paintPre = useCallback((ctx: CanvasRenderingContext2D) => {
    // Cluster nebula halos — drawn behind nodes
    for (let ci = 0; ci < clusters.length; ci++) {
      const cns = graphData.nodes.filter(n => n.clusterIdx === ci);
      if (!cns.length) continue;
      const mx = cns.reduce((s, n) => s + (n.x ?? 0), 0) / cns.length;
      const my = cns.reduce((s, n) => s + (n.y ?? 0), 0) / cns.length;
      const maxDist = Math.max(...cns.map(n => Math.hypot((n.x ?? 0) - mx, (n.y ?? 0) - my)));
      const haloR = maxDist + 52;
      const c = col(ci);
      const dim = activeClusterIdx !== null && activeClusterIdx !== ci;

      ctx.save();
      ctx.globalAlpha = dim ? 0.04 : 0.9;
      const grad = ctx.createRadialGradient(mx, my, haloR * 0.1, mx, my, haloR);
      grad.addColorStop(0, `${c}18`);
      grad.addColorStop(0.5, `${c}09`);
      grad.addColorStop(1, `${c}00`);
      ctx.beginPath(); ctx.arc(mx, my, haloR, 0, Math.PI * 2);
      ctx.fillStyle = grad; ctx.fill();
      ctx.restore();
    }
  }, [clusters, graphData, activeClusterIdx]);

  const paintPost = useCallback((ctx: CanvasRenderingContext2D) => {
    // Cluster centroid labels (floating pill above cluster center-of-mass)
    for (let ci = 0; ci < clusters.length; ci++) {
      const cns = graphData.nodes.filter(n => n.clusterIdx === ci);
      if (!cns.length) continue;
      const mx = cns.reduce((s, n) => s + (n.x ?? 0), 0) / cns.length;
      const my = cns.reduce((s, n) => s + (n.y ?? 0), 0) / cns.length;
      const maxDist = Math.max(...cns.map(n => Math.hypot((n.x ?? 0) - mx, (n.y ?? 0) - my)));
      const c = col(ci);
      const dim = activeClusterIdx !== null && activeClusterIdx !== ci;
      const label = clusters[ci].label;

      ctx.save(); ctx.globalAlpha = dim ? 0.05 : 0.82;
      ctx.font = `400 11px 'JetBrains Mono', monospace`;
      const tw = ctx.measureText(label).width;
      const pw = tw + 18, ph = 20;
      const lx = mx, ly = my - maxDist - 24;

      ctx.fillStyle = 'rgba(10,8,6,0.92)';
      ctx.beginPath(); ctx.roundRect(lx - pw / 2, ly - ph / 2, pw, ph, ph / 2); ctx.fill();
      ctx.strokeStyle = `${c}66`; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.fillStyle = `${c}dd`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly); ctx.restore();
    }

    // Gloss pills along active edges
    if (!activeId) return;
    ctx.save();
    for (const lk of graphData.links) {
      const s = lk.source as GNode, t = lk.target as GNode;
      if (s.id !== activeId && t.id !== activeId) continue;
      if (!s.x || !s.y || !t.x || !t.y) continue;
      const c = col(lk.clusterIdx);
      const mx2 = (s.x + t.x) / 2, my2 = (s.y + t.y) / 2;
      ctx.font = `400 9px 'JetBrains Mono', monospace`;
      const tw = ctx.measureText(lk.gloss).width;
      const pw = tw + 12, ph = 16;
      ctx.globalAlpha = 0.97;
      ctx.fillStyle = 'rgba(10,8,6,0.95)';
      ctx.beginPath(); ctx.roundRect(mx2 - pw / 2, my2 - ph / 2, pw, ph, ph / 2); ctx.fill();
      ctx.strokeStyle = `${c}66`; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.fillStyle = `${c}ee`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(lk.gloss, mx2, my2);
    }
    ctx.restore();
  }, [clusters, graphData, activeId, activeClusterIdx]);

  const handleNodeClick = useCallback((node: GNode) => {
    if (node.isFocus) return;
    if (selectedId === node.id) router.push('/cluster/' + encodeURIComponent(node.id));
    else setSelectedId(node.id);
  }, [selectedId, router]);

  const handleHover = useCallback((node: GNode | null) => {
    setHoveredId(!node || node.isFocus ? null : node.id);
    if (typeof document !== 'undefined')
      document.body.style.cursor = node && !node.isFocus ? 'pointer' : 'default';
  }, []);

  const selNode = graphData.nodes.find(n => n.id === selectedId);
  const selCluster = selNode ? clusters[selNode.clusterIdx] : null;

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0a0806' }}>
	      {dims.w > 0 && (
	        <ForceGraph2D
	          ref={graphRef}
	          graphData={graphData as any}
	          width={dims.w}
	          height={dims.h}
	          backgroundColor="#0a0806"
	          nodeCanvasObject={paintNode as any}
	          nodeCanvasObjectMode={() => 'replace'}
	          linkCanvasObject={paintLink as any}
	          linkCanvasObjectMode={() => 'replace'}
	          onRenderFramePre={paintPre as any}
	          onRenderFramePost={paintPost as any}
	          onNodeClick={handleNodeClick as any}
	          onNodeHover={handleHover as any}
	          onBackgroundClick={() => setSelectedId(null)}
	          cooldownTicks={0}
	          onEngineStop={handleEngineStop}
	          enableNodeDrag={false}
	          minZoom={0.2}
	          maxZoom={8}
	          nodePointerAreaPaint={((node: GNode, c: string, ctx: CanvasRenderingContext2D) => {
	            ctx.fillStyle = c; ctx.beginPath();
	            ctx.arc(node.x ?? 0, node.y ?? 0, nr(node) + 8, 0, Math.PI * 2); ctx.fill();
	          }) as any}
	        />
	      )}

      {!selectedId && (
        <div style={{
          position: 'absolute', bottom: 20, right: 20,
          fontSize: '11px', color: 'rgba(232,213,176,0.18)',
          fontFamily: "'JetBrains Mono', monospace",
          pointerEvents: 'none', letterSpacing: '0.04em',
        }}>
          click · click again to explore
        </div>
      )}

      {selNode && selCluster && (
        <div style={{
          position: 'absolute', bottom: 24, left: 24,
          background: 'rgba(10,8,6,0.94)',
          border: `1px solid ${col(selNode.clusterIdx)}40`,
          borderRadius: '14px', padding: '18px 22px',
          display: 'flex', flexDirection: 'column', gap: '8px',
          maxWidth: '240px',
          backdropFilter: 'blur(12px)',
          boxShadow: `0 0 48px ${col(selNode.clusterIdx)}14`,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
            <span className="zh" style={{
              fontSize: '44px', lineHeight: 1,
              color: col(selNode.clusterIdx),
              textShadow: `0 0 24px ${col(selNode.clusterIdx)}50`,
            }}>{selNode.id}</span>
            <span style={{ fontSize: '13px', color: 'rgba(232,213,176,0.45)', fontFamily: "'JetBrains Mono', monospace" }}>
              {selNode.pinyin}
            </span>
          </div>
          <div style={{ fontSize: '11px', letterSpacing: '0.07em', color: `${col(selNode.clusterIdx)}88`, fontFamily: "'JetBrains Mono', monospace" }}>
            {selCluster.label}
          </div>
          <button onClick={() => router.push('/cluster/' + encodeURIComponent(selNode.id))} style={{
            marginTop: '4px',
            background: `${col(selNode.clusterIdx)}14`,
            border: `1px solid ${col(selNode.clusterIdx)}44`,
            borderRadius: '7px', padding: '7px 14px',
            color: col(selNode.clusterIdx),
            fontSize: '11px', fontFamily: "'JetBrains Mono', monospace",
            cursor: 'pointer', letterSpacing: '0.04em',
          }}>
            Explore this cluster →
          </button>
        </div>
      )}
    </div>
  );
}
