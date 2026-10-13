"use client";

// Every text in the corpus, by how close it is to readable. The words still
// blocking a text are listed under it; tapping one shows what knowing it would
// do, across all texts, before you mark it.

import { useMemo, useState } from "react";
import type { Text } from "@chongfuxi/lib/corpus";
import { WordActions, type AppApi } from "./shared";

type Filter = "readable" | "one" | "locked";
const PAGE = 40;

export function SentencesPanel({ api }: { api: AppApi }) {
  const { corpus, derived } = api.state;
  const [filter, setFilter] = useState<Filter>("readable");
  const [pool, setPool] = useState<number | "all">("all");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<{ id: number; word: string } | null>(null);

  const pools = useMemo(() => {
    if (!corpus) return [];
    const names = new Map(corpus.categories.map((c) => [c.id, c.name]));
    const counts = new Map<number, number>();
    for (const t of corpus.texts) for (const p of t.pools) counts.set(p, (counts.get(p) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({ id, name: names.get(id) ?? `#${id}`, n }));
  }, [corpus]);

  const rows = useMemo(() => {
    if (!corpus || !derived) return [] as Array<{ text: Text; blocking: string[] }>;
    const out: Array<{ text: Text; blocking: string[] }> = [];
    corpus.texts.forEach((text, i) => {
      if (pool !== "all" && !text.pools.includes(pool)) return;
      const blocking = derived.blocking[i];
      const kind: Filter = blocking.length === 0 ? "readable" : blocking.length === 1 ? "one" : "locked";
      if (kind === filter) out.push({ text, blocking });
    });
    // Shortest first: the easiest wins, and the quickest to scan.
    out.sort((a, b) => a.text.zh.length - b.text.zh.length);
    return out;
  }, [corpus, derived, filter, pool]);

  if (!corpus || !derived) return null;
  const c = derived.counts;
  const tabs: Array<{ key: Filter; label: string; n: number }> = [
    { key: "readable", label: "Readable", n: c.unlocked },
    { key: "one", label: "One word away", n: c.oneAway },
    { key: "locked", label: "Locked", n: c.locked },
  ];

  return (
    <div className="cf-panel">
      <div className="cf-filters">
        <div className="cf-seg" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={filter === t.key}
              className={`cf-seg-btn${filter === t.key ? " is-on" : ""}`}
              onClick={() => {
                setFilter(t.key);
                setShown(PAGE);
                setOpen(null);
              }}
            >
              {t.label} <span className="cf-seg-n">{t.n.toLocaleString("en-US")}</span>
            </button>
          ))}
        </div>
        <select
          className="cf-select"
          value={pool}
          onChange={(e) => {
            setPool(e.target.value === "all" ? "all" : Number(e.target.value));
            setShown(PAGE);
          }}
        >
          <option value="all">All sources</option>
          {pools.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.n.toLocaleString("en-US")})
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 && <p className="cf-muted cf-pad">No sentences here.</p>}
      <ul className="cf-list">
        {rows.slice(0, shown).map(({ text, blocking }) => (
          <li key={text.id} className="cf-sentence">
            <div className="cf-zh">{text.zh}</div>
            {text.en && <div className="cf-en">{text.en}</div>}
            <div className="cf-sentence-meta">
              {blocking.map((w) => (
                <button
                  key={w}
                  className={`cf-blocker${open?.id === text.id && open.word === w ? " is-on" : ""}`}
                  onClick={() => setOpen(open?.id === text.id && open.word === w ? null : { id: text.id, word: w })}
                >
                  {w}
                </button>
              ))}
              {text.studied && <span className="cf-tag">studied in Pleco</span>}
              {text.source === "dictionary" && (
                <span className="cf-tag" title="This card's pinyin didn't match its characters, so it was split with the dictionary">
                  dictionary split
                </span>
              )}
            </div>
            {open?.id === text.id && <WordActions api={api} word={open.word} />}
          </li>
        ))}
      </ul>
      {shown < rows.length && (
        <button className="cf-more" onClick={() => setShown(shown + PAGE)}>
          Show more ({(rows.length - shown).toLocaleString("en-US")} left)
        </button>
      )}
    </div>
  );
}
