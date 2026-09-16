"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { type State } from "@longku/lib/store";

interface NodeShape {
  id: string;
  label: string;
  fs: string;
  ls: string;
}

interface LinkShape {
  source: string;
  target: string;
}

// react-force-graph-2d depends on browser-only APIs; load it client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d").then((m) => m.default), {
  ssr: false,
});

interface Props {
  state: State;
}

interface ChengyuLite {
  w: string;
  fs: string;
  ls: string;
}

export function ChainView({ state }: Props) {
  const known = useMemo(() => Object.keys(state.bank), [state]);
  // v1 had to fetch readings per word; the bank now stores fs/ls directly, so
  // the graph builds straight from local state. Words without a known ending
  // syllable are omitted — they can't form an outgoing edge.
  const details = useMemo(() => {
    const m = new Map<string, ChengyuLite>();
    for (const e of Object.values(state.bank)) {
      if (e.ls === null) continue;
      m.set(e.w, { w: e.w, fs: e.fs, ls: e.ls });
    }
    return m;
  }, [state]);
  const [size, setSize] = useState({ w: 800, h: 560 });

  // The graph paints to canvas, so it can't inherit CSS custom properties the
  // way the rest of the UI does. Resolve the tokens once and re-resolve when
  // the theme changes, otherwise a dark-mode switch leaves a paper-coloured
  // canvas behind.
  const [palette, setPalette] = useState({
    bg: "#ece5d6",
    link: "rgba(74, 93, 140, 0.45)",
    node: "#4a5d8c",
    nodeInk: "#fbf7ed",
  });

  useEffect(() => {
    function readTokens() {
      const cs = getComputedStyle(document.documentElement);
      const pick = (name: string, fallback: string) =>
        cs.getPropertyValue(name).trim() || fallback;
      setPalette({
        bg: pick("--lg-canvas-bg", "#ece5d6"),
        link: pick("--lg-canvas-link", "rgba(74, 93, 140, 0.45)"),
        node: pick("--lg-accent", "#4a5d8c"),
        nodeInk: pick("--lg-on-accent", "#fbf7ed"),
      });
    }
    readTokens();
    window.addEventListener("longku:themechange", readTokens);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", readTokens);
    return () => {
      window.removeEventListener("longku:themechange", readTokens);
      mq.removeEventListener("change", readTokens);
    };
  }, []);


  useEffect(() => {
    const el = document.querySelector(".longku-chain-canvas") as HTMLDivElement | null;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { graph, stats } = useMemo(() => {
    const nodes: NodeShape[] = [];
    const links: LinkShape[] = [];
    const idSet = new Set<string>();
    for (const w of known) {
      const d = details.get(w);
      if (!d) continue;
      nodes.push({ id: w, label: w, fs: d.fs, ls: d.ls });
      idSet.add(w);
    }
    // Edge: A → B if last syllable of A matches first syllable of B.
    const byFirst = new Map<string, ChengyuLite[]>();
    for (const n of nodes) {
      const d = details.get(n.id)!;
      if (!byFirst.has(d.fs)) byFirst.set(d.fs, []);
      byFirst.get(d.fs)!.push(d);
    }
    let edgeCount = 0;
    let outgoing = new Set<string>();
    for (const n of nodes) {
      const d = details.get(n.id)!;
      const targets = byFirst.get(d.ls) ?? [];
      for (const t of targets) {
        if (t.w === n.id) continue;
        links.push({ source: n.id, target: t.w });
        edgeCount++;
        outgoing.add(n.id);
      }
    }
    const longest = longestPath(nodes, links);
    return {
      graph: { nodes, links },
      stats: {
        nodes: nodes.length,
        edges: edgeCount,
        connected: outgoing.size,
        density: nodes.length > 0 ? outgoing.size / nodes.length : 0,
        longest,
      },
    };
  }, [known, details]);

  if (known.length === 0) {
    return (
      <div className="longku-chain-wrap">
        <div className="longku-chain-empty">
          Add chengyus to your bank to build the chain graph.<br />
          Each word in your bank becomes a node; arrows form where one word's last syllable matches another's first.
        </div>
      </div>
    );
  }

  return (
    <div className="longku-chain-wrap">
      <div className="longku-stats" style={{ marginBottom: 14 }}>
        <Stat label="Nodes" value={String(stats.nodes)} sub="words in your bank" />
        <Stat label="Edges" value={String(stats.edges)} sub="chain connections" />
        <Stat
          label="Connectedness"
          value={`${Math.round(stats.density * 100)}%`}
          sub={`${stats.connected} of ${stats.nodes} chain forward`}
        />
        <Stat
          label="Longest chain"
          value={String(stats.longest.length)}
          sub={stats.longest.length > 1 ? stats.longest.join(" → ") : "single node"}
        />
      </div>
      <div className="longku-chain-canvas">
        {graph.nodes.length > 0 && (
          <ForceGraph2D
            graphData={graph}
            width={size.w}
            height={size.h}
            backgroundColor={palette.bg}
            nodeLabel={(n: any) => `${n.label} (${n.fs} → ${n.ls})`}
            linkColor={() => palette.link}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={0.85}
            nodeCanvasObject={(node: any, ctx, globalScale) => {
              const label = node.label as string;
              const fontSize = 11 / globalScale;
              ctx.font = `${fontSize}px "Iowan Old Style", "Songti SC", Georgia, serif`;
              const padX = 4 / globalScale;
              const padY = 2 / globalScale;
              const textW = ctx.measureText(label).width;
              const w = textW + padX * 2;
              const h = fontSize + padY * 2;
              ctx.fillStyle = palette.node;
              ctx.fillRect(node.x - w / 2, node.y - h / 2, w, h);
              ctx.fillStyle = palette.nodeInk;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(label, node.x, node.y);
            }}
            nodePointerAreaPaint={(node: any, color, ctx) => {
              const fontSize = 11;
              ctx.font = `${fontSize}px "Iowan Old Style", Georgia, serif`;
              const w = ctx.measureText(node.label).width + 8;
              const h = fontSize + 4;
              ctx.fillStyle = color;
              ctx.fillRect(node.x - w / 2, node.y - h / 2, w, h);
            }}
          />
        )}
      </div>
    </div>
  );
}

function longestPath(nodes: NodeShape[], links: LinkShape[]): string[] {
  // Cycles are possible in chengyu chains, so we cap DFS depth and use a
  // visited set per path. With <500 nodes this is fine for v1.
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const l of links) adj.get(l.source as string)?.push(l.target as string);

  let best: string[] = [];
  const cap = 10000;
  let steps = 0;

  function dfs(id: string, path: string[], visited: Set<string>) {
    if (steps++ > cap) return;
    if (path.length > best.length) best = path.slice();
    for (const nxt of adj.get(id) ?? []) {
      if (visited.has(nxt)) continue;
      visited.add(nxt);
      path.push(nxt);
      dfs(nxt, path, visited);
      path.pop();
      visited.delete(nxt);
    }
  }

  for (const n of nodes) {
    if (steps > cap) break;
    const visited = new Set([n.id]);
    dfs(n.id, [n.id], visited);
  }
  return best;
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="longku-stat">
      <div className="longku-stat-label">{label}</div>
      <div className="longku-stat-value">{value}</div>
      <div className="longku-stat-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {sub}
      </div>
    </div>
  );
}
