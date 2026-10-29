"use client";

// Cards › Mix-ups: a map of the words the owner takes for each other (the
// owner's ask: "a visualized map of words I often confuse together"), from
// the notes written after a Forgot and lookups comparing two words
// (app/api/chongfuxi/mixups.ts). Words joined through others are drawn as one
// small network; a pair on its own is a row of two words and a line.

import { useEffect, useMemo, useState } from "react";
import * as wordpage from "@chongfuxi/lib/wordpage";
import type { MixupCluster, MixupEdge, MixupMap, MixupNode } from "@chongfuxi/lib/api";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { get } from "@chongfuxi/lib/client";
import { Loading, message } from "./shared";

/** What is picked on a map: a word, or the line between two. */
type Pick = { word: string } | { pair: [string, string] } | null;

const WIDTH = 328;
/** A node's radius: room for its characters, a little more for words missed more. */
const radiusOf = (n: MixupNode) => Math.max(20, [...n.word].length * 8.5 + 6) + Math.min(n.misses, 8) * 0.9;
/** A line's width by how often the two were mixed up. */
const strokeOf = (e: MixupEdge) => Math.min(1.5 + e.weight * 0.8, 7);
const noteBacked = (e: MixupEdge) => e.notes.length > 0;
const same = (e: MixupEdge, a: string, b: string) => (e.a === a && e.b === b) || (e.a === b && e.b === a);

/**
 * Where each word sits: a small force layout (words push apart, lines pull
 * together, heavier lines shorter), the same every time for the same words
 * (seeded on a circle in a fixed order), then fitted into the box.
 */
function layout(c: MixupCluster): { at: Map<string, { x: number; y: number }>; height: number } {
  const nodes = [...c.nodes].sort((a, b) => a.word.localeCompare(b.word));
  const n = nodes.length;
  const height = Math.min(440, 150 + n * 26);
  const p = nodes.map((_, i) => ({ x: Math.cos((2 * Math.PI * i) / n) * 80, y: Math.sin((2 * Math.PI * i) / n) * 80 }));
  const index = new Map(nodes.map((nd, i) => [nd.word, i]));
  const r = nodes.map(radiusOf);
  for (let step = 0; step < 400; step++) {
    const cool = 1 - step / 400;
    const f = p.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = p[i].x - p[j].x || 0.01;
        const dy = p[i].y - p[j].y || 0.01;
        const d = Math.max(Math.hypot(dx, dy), 1);
        const push = (2600 + (r[i] + r[j]) * 40) / (d * d);
        f[i].x += (dx / d) * push;
        f[i].y += (dy / d) * push;
        f[j].x -= (dx / d) * push;
        f[j].y -= (dy / d) * push;
      }
    }
    for (const e of c.edges) {
      const i = index.get(e.a)!;
      const j = index.get(e.b)!;
      const dx = p[j].x - p[i].x;
      const dy = p[j].y - p[i].y;
      const d = Math.max(Math.hypot(dx, dy), 1);
      const want = r[i] + r[j] + Math.max(34, 70 - e.weight * 4);
      const pull = (d - want) * 0.06;
      f[i].x += (dx / d) * pull;
      f[i].y += (dy / d) * pull;
      f[j].x -= (dx / d) * pull;
      f[j].y -= (dy / d) * pull;
    }
    for (let i = 0; i < n; i++) {
      f[i].x -= p[i].x * 0.01;
      f[i].y -= p[i].y * 0.01;
      p[i].x += Math.max(-12, Math.min(12, f[i].x)) * cool;
      p[i].y += Math.max(-12, Math.min(12, f[i].y)) * cool;
    }
  }
  // Fit: the widest spread to the box, labels kept inside.
  const pad = (i: number) => r[i] + 6;
  const minX = Math.min(...p.map((q, i) => q.x - pad(i)));
  const maxX = Math.max(...p.map((q, i) => q.x + pad(i)));
  const minY = Math.min(...p.map((q, i) => q.y - pad(i)));
  const maxY = Math.max(...p.map((q, i) => q.y + pad(i) + 14));
  const scale = Math.min(1.4, WIDTH / (maxX - minX), height / (maxY - minY));
  const ox = (WIDTH - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale) / 2;
  const at = new Map(nodes.map((nd, i) => [nd.word, { x: ox + (p[i].x - minX) * scale, y: oy + (p[i].y - minY) * scale }]));
  return { at, height };
}

function ClusterMap({ c, pick, onPick }: { c: MixupCluster; pick: Pick; onPick: (p: Pick) => void }) {
  const { at, height } = useMemo(() => layout(c), [c]);
  const picked = pick && "word" in pick ? pick.word : null;
  const pickedPair = pick && "pair" in pick ? pick.pair : null;
  const lit = (e: MixupEdge) => (picked ? e.a === picked || e.b === picked : pickedPair ? same(e, pickedPair[0], pickedPair[1]) : true);
  const near = new Set(picked ? c.edges.filter(lit).flatMap((e) => [e.a, e.b]) : pickedPair ?? c.nodes.map((n) => n.word));
  return (
    <svg className="cf-mx-map" viewBox={`0 0 ${WIDTH} ${height}`} role="group" aria-label={`Mix-ups: ${c.nodes.map((n) => n.word).join(", ")}`}>
      {c.edges.map((e) => {
        const a = at.get(e.a)!;
        const b = at.get(e.b)!;
        return (
          <g key={`${e.a}|${e.b}`} className={`cf-mx-edge${noteBacked(e) ? "" : " is-lookup"}${lit(e) ? "" : " is-dim"}`}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={strokeOf(e)} />
            {/* A wider line nobody sees, so a finger finds it. */}
            <line
              className="cf-mx-hit"
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              role="button"
              aria-label={`${e.a} and ${e.b}`}
              onClick={() => onPick({ pair: [e.a, e.b] })}
            />
          </g>
        );
      })}
      {c.nodes.map((n) => {
        const p = at.get(n.word)!;
        const r = radiusOf(n);
        return (
          <g
            key={n.word}
            className={`cf-mx-node is-${n.standing}${picked === n.word ? " is-picked" : ""}${near.has(n.word) ? "" : " is-dim"}`}
            transform={`translate(${p.x} ${p.y})`}
            role="button"
            aria-label={n.word}
            onClick={() => onPick(picked === n.word ? null : { word: n.word })}
          >
            <circle r={r} />
            <text className="cf-mx-zh" dy="0.36em">
              {n.word}
            </text>
            {n.pinyin && (
              <text className="cf-mx-py" y={r + 12}>
                {displayPinyin(n.pinyin)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** A word as a line: the word, its reading and meaning, where it stands; opening its page. */
function WordLine({ n }: { n: MixupNode | undefined }) {
  if (!n) return null;
  return (
    <button className="cf-mx-word" onClick={() => wordpage.openWordPage(n.word)}>
      <span className="cf-zh cf-mx-word-zh">{n.word}</span>
      <span className="cf-mx-word-body">
        {n.pinyin && <span className="cf-mx-word-py">{displayPinyin(n.pinyin)}</span>}
        {n.gloss && <span className="cf-mx-word-gloss">{n.gloss}</span>}
      </span>
      <span className={`cf-mx-standing is-${n.standing}`}>
        {n.standing === "deck" ? (n.misses ? `${n.misses}× missed` : "in deck") : n.standing === "listed" ? "on a list" : "not yours"}
      </span>
    </button>
  );
}

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const KIND = { read: "Read", produce: "Recall", sentence: "Sentence" } as const;

/** Why two words are joined: each note, Muse's difference, each lookup. */
function PairDetail({ e, nodes }: { e: MixupEdge; nodes: Map<string, MixupNode> }) {
  return (
    <div className="cf-mx-detail">
      <WordLine n={nodes.get(e.a)} />
      <WordLine n={nodes.get(e.b)} />
      <ul className="cf-mx-evidence">
        {e.notes.map((n) => (
          <li key={n.id}>
            <p className="cf-mx-ev-head">
              {KIND[n.kind]} card{n.word ? <> · <span className="cf-zh">{n.word}</span></> : null} · {day(n.at)}
            </p>
            {n.sentence && <p className="cf-zh cf-mx-ev-sent">{n.sentence}</p>}
            <p className="cf-mx-ev-note">“{n.note}”</p>
            {n.difference && (
              <p className="cf-mx-ev-muse">
                <span className="cf-mx-ev-by">Muse</span> {n.difference}
              </p>
            )}
          </li>
        ))}
        {e.lookups.map((l) => (
          <li key={l.query} className="is-lookup">
            <p className="cf-mx-ev-head">Looked up · {day(l.at)}</p>
            <p className="cf-mx-ev-note">{l.query}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A word picked: the word, then each word it was taken for, strongest first. */
function WordDetail({ word, c, nodes, onPair }: { word: string; c: MixupCluster; nodes: Map<string, MixupNode>; onPair: (a: string, b: string) => void }) {
  const mine = c.edges.filter((e) => e.a === word || e.b === word);
  return (
    <div className="cf-mx-detail">
      <WordLine n={nodes.get(word)} />
      <p className="cf-mx-with">Mixed up with</p>
      <ul className="cf-mx-partners">
        {mine.map((e) => {
          const other = e.a === word ? e.b : e.a;
          return (
            <li key={other}>
              <button onClick={() => onPair(word, other)}>
                <span className="cf-zh">{other}</span>
                <span className="cf-mx-count">
                  {e.notes.length ? `${e.notes.length} note${e.notes.length > 1 ? "s" : ""}` : ""}
                  {e.notes.length && e.lookups.length ? " · " : ""}
                  {e.lookups.length ? `${e.lookups.length} lookup${e.lookups.length > 1 ? "s" : ""}` : ""}
                </span>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Cluster({ c }: { c: MixupCluster }) {
  const [pick, setPick] = useState<Pick>(null);
  const nodes = useMemo(() => new Map(c.nodes.map((n) => [n.word, n])), [c]);
  const edge = pick && "pair" in pick ? c.edges.find((e) => same(e, pick.pair[0], pick.pair[1])) : undefined;
  return (
    <section className="cf-mx-cluster">
      <ClusterMap c={c} pick={pick} onPick={setPick} />
      {!pick && <p className="cf-mx-tap">Tap a word or a line</p>}
      {pick && "word" in pick && <WordDetail word={pick.word} c={c} nodes={nodes} onPair={(a, b) => setPick({ pair: [a, b] })} />}
      {edge && <PairDetail e={edge} nodes={nodes} />}
    </section>
  );
}

/** A pair on its own: two words and the line between, opening why. */
function PairRow({ c }: { c: MixupCluster }) {
  const [open, setOpen] = useState(false);
  const e = c.edges[0];
  const nodes = useMemo(() => new Map(c.nodes.map((n) => [n.word, n])), [c]);
  return (
    <li className={`cf-mx-pair${open ? " is-open" : ""}`}>
      <button className="cf-mx-pair-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="cf-zh cf-mx-pair-w">{e.a}</span>
        <span className={`cf-mx-pair-line${noteBacked(e) ? "" : " is-lookup"}`} style={{ height: strokeOf(e) }} aria-hidden="true" />
        <span className="cf-zh cf-mx-pair-w">{e.b}</span>
        <span className="cf-mx-count">{e.weight > 2 ? `×${e.notes.length + e.lookups.length}` : ""}</span>
      </button>
      {open && <PairDetail e={e} nodes={nodes} />}
    </li>
  );
}

export function MixupsPanel() {
  const [map, setMap] = useState<MixupMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    get<MixupMap>("mixups")
      .then(setMap)
      .catch((e) => setError(message(e)));
  }, []);
  if (error) return <p className="cf-error">{error}</p>;
  if (!map) return <Loading label="Finding the words you take for each other…" />;
  const webs = map.clusters.filter((c) => c.nodes.length > 2);
  const pairs = map.clusters.filter((c) => c.nodes.length === 2);
  return (
    <div className="cf-mx">
      <p className="cf-muted cf-mx-about">
        Words you took for each other, from what you wrote after a Forgot and what you looked up. {map.pairs} pair{map.pairs === 1 ? "" : "s"} from{" "}
        {map.notes} note{map.notes === 1 ? "" : "s"}.
      </p>
      {map.clusters.length === 0 ? (
        <p className="cf-muted cf-mx-empty">
          Nothing yet. When you get a card wrong, swipe Forgot up and say which word you took it for (“thought it was 发现”): each note joins the two words here.
        </p>
      ) : (
        <>
          <p className="cf-mx-key" aria-label="Key">
            <span>
              <i className="cf-mx-key-line" /> a note
            </span>
            <span>
              <i className="cf-mx-key-line is-lookup" /> a lookup
            </span>
            <span>
              <i className="cf-mx-key-dot is-deck" /> in deck
            </span>
            <span>
              <i className="cf-mx-key-dot is-listed" /> not yet
            </span>
          </p>
          {webs.map((c) => (
            <Cluster key={c.nodes.map((n) => n.word).sort().join("|")} c={c} />
          ))}
          {pairs.length > 0 && (
            <section className="cf-mx-pairs">
              <h3 className="cf-h3">Pairs</h3>
              <ul className="cf-slist">
                {pairs.map((c) => (
                  <PairRow key={`${c.edges[0].a}|${c.edges[0].b}`} c={c} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
