'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { forceCollide } from 'd3-force';
import { forceCluster } from './galaxy/forceCluster';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

interface GraphNode {
  id: string;
  pinyin: string;
  degree: number;
  cluster: string;
  x?: number;
  y?: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: Array<{ source: string; target: string; weight: number }>;
}

function hash32(str: string): number {
  // FNV-1a-ish small hash for stable layout seeds
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function seedLayout(raw: GraphData): GraphData {
  const inputNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const inputLinks = Array.isArray(raw.links) ? raw.links : [];

  const clusters = Array.from(new Set(inputNodes.map((n) => n.cluster || '')))
    .filter(Boolean)
    .sort((a, b) => hash32(a) - hash32(b));

  const centers = new Map<string, { x: number; y: number }>();
  const total = Math.max(1, clusters.length);
  for (let i = 0; i < clusters.length; i++) {
    const angle = (i / total) * Math.PI * 2;
    // Spiral-ish ring: keeps many clusters from sitting on top of each other.
    const r = 260 + Math.sqrt(i) * 120;
    centers.set(clusters[i], { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }

  const nodes = inputNodes.map((n) => {
    const c = centers.get(n.cluster) ?? { x: 0, y: 0 };
    const rand = mulberry32(hash32(`${n.cluster}|${n.id}`));
    const a = rand() * Math.PI * 2;
    const jitter = 22 + Math.log2((n.degree ?? 1) + 1) * 10;
    const jr = rand() * jitter;
    return {
      ...n,
      x: c.x + Math.cos(a) * jr,
      y: c.y + Math.sin(a) * jr,
    };
  });

  return { nodes, links: inputLinks };
}

function clusterHue(label: string): number {
  let h = 0;
  for (const c of label) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return h % 360;
}

function hsla(hue: number, a: number): string {
  return `hsla(${hue}, 55%, 55%, ${a})`;
}

export default function GlobalGraph() {
  const router = useRouter();
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string>('');
  const [reloadToken, setReloadToken] = useState(0);
  const [tooltip, setTooltip] = useState<{ simplified: string; pinyin: string } | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const graphRef = useRef<any>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    setDims({ width: window.innerWidth, height: window.innerHeight });
    const onResize = () => setDims({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setData(null);
    fetch('/api/graph', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Graph API error ${r.status}`);
        }
        return r.json();
      })
      .then((raw: GraphData) => {
        if (cancelled) return;
        if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.links)) {
          throw new Error('Invalid graph data');
        }
        setData(seedLayout(raw));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Tune d3 forces once graph is ready
  useEffect(() => {
    if (!data || !graphRef.current) return;
    const fg = graphRef.current;
    // Tighter link distance so clusters stay together
    fg.d3Force('link')?.distance(45);
    // Moderate charge — enough to separate but not scatter
    fg.d3Force('charge')?.strength(-120);
    fg.d3Force(
      'collide',
      forceCollide<GraphNode>().radius((n: GraphNode) => Math.max(14, Math.log2((n.degree ?? 1) + 1) * 4) + 10)
    );
    // Pull nodes toward their cluster centroid for cleaner "constellations".
    fg.d3Force('cluster', forceCluster());
    fg.d3ReheatSimulation();
  }, [data]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      router.push('/cluster/' + encodeURIComponent(node.id));
    },
    [router]
  );

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setTooltip(node ? { simplified: node.id, pinyin: node.pinyin } : null);
    if (typeof document !== 'undefined') {
      document.body.style.cursor = node ? 'pointer' : 'default';
    }
  }, []);

  const handleEngineStop = useCallback(() => {
    if (!fittedRef.current && graphRef.current) {
      fittedRef.current = true;
      graphRef.current.zoomToFit(400, 80);
    }
  }, []);

  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      // Node radius in graph units — scales inversely with zoom so screen size stays constant
      const screenR = Math.max(14, Math.log2(node.degree + 1) * 4);
      const r = screenR / Math.max(globalScale, 0.3);
      const hue = clusterHue(node.cluster);

      // Soft glow ring
      const grd = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.2);
      grd.addColorStop(0, hsla(hue, 0.19));
      grd.addColorStop(1, hsla(hue, 0));
      ctx.beginPath();
      ctx.arc(x, y, r * 2.2, 0, 2 * Math.PI);
      ctx.fillStyle = grd;
      ctx.fill();

      // Circle body
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = hsla(hue, 0.8);
      ctx.fill();
      ctx.strokeStyle = hsla(hue, 1);
      ctx.lineWidth = r * 0.08;
      ctx.stroke();

      // Chinese character — always visible
      const fontSize = r * 1.15;
      ctx.font = `900 ${fontSize}px 'Noto Serif SC', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255, 248, 235, 0.95)';
      ctx.fillText(node.id, x, y);

      // Pinyin below when zoomed in enough (globalScale >= 1.5)
      if (globalScale >= 1.5) {
        const pSize = r * 0.48;
        ctx.font = `300 ${pSize}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = 'rgba(232,213,176,0.55)';
        ctx.fillText(node.pinyin, x, y + r + pSize * 0.8);
      }
    },
    []
  );

  const nodePointerAreaPaint = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const screenR = Math.max(14, Math.log2(node.degree + 1) * 4);
      const r = screenR / Math.max(globalScale, 0.3);
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  return (
    <>
      {data ? (
        <ForceGraph2D
          ref={graphRef}
          graphData={data}
          width={dims.width}
          height={dims.height}
          backgroundColor="#0a0806"
          nodeCanvasObject={nodeCanvasObject as any}
          nodePointerAreaPaint={nodePointerAreaPaint as any}
          linkColor={() => 'rgba(217,164,65,0.18)'}
          linkWidth={(link: any) => Math.log((link.weight ?? 1) + 1) * 0.6}
          onNodeClick={handleNodeClick as any}
          onNodeHover={handleNodeHover as any}
          cooldownTicks={200}
          onEngineStop={handleEngineStop}
          enableNodeDrag={false}
          nodeLabel={() => ''}
        />
      ) : (
        <div style={{
          position: 'fixed', inset: 0, background: '#0a0806',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <span style={{ color: 'rgba(217,164,65,0.35)', fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
              {error ? 'Star map unavailable' : 'Loading star map…'}
            </span>
            {error && (
              <>
                <span style={{ color: 'rgba(232,213,176,0.45)', letterSpacing: '0.02em', textTransform: 'none', fontSize: '12px', maxWidth: 720 }}>
                  {error}
                </span>
                <button
                  type="button"
                  onClick={() => setReloadToken((x) => x + 1)}
                  style={{
                    background: 'rgba(217,164,65,0.12)',
                    border: '1px solid rgba(217,164,65,0.35)',
                    borderRadius: '999px',
                    padding: '10px 14px',
                    color: '#d9a441',
                    fontSize: '12px',
                    fontFamily: "'JetBrains Mono', monospace",
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {tooltip && (
        <div style={{
          position: 'fixed', bottom: '28px', left: '28px', zIndex: 20,
          pointerEvents: 'none',
        }}>
          <span className="zh" style={{ fontSize: '32px', color: '#d9a441', display: 'block', lineHeight: 1 }}>
            {tooltip.simplified}
          </span>
          <span style={{ fontSize: '12px', color: 'rgba(232,213,176,0.5)', letterSpacing: '0.06em', marginTop: '4px', display: 'block' }}>
            {tooltip.pinyin}
          </span>
        </div>
      )}
    </>
  );
}
