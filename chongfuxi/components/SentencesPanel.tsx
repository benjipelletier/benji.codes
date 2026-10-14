"use client";

// Every sentence, by how close it is to readable, shortest first. Readable
// ones say where their card stands; the rest show the words still in the way.
// The last choice turns it round: the words that would unlock the most.

import { useEffect, useState } from "react";
import type { SentenceRow } from "@chongfuxi/lib/api";
import { get } from "@chongfuxi/lib/client";
import { UnlockPanel } from "./UnlockPanel";
import { fmt, message, type Shell } from "./shared";

type Show = "readable" | "one" | "locked" | "unlock";
const PAGE = 40;

const CARD_LABEL = {
  new: "not yet introduced",
  reading: "in rotation",
  retired: "retired",
} as const;

export function SentencesPanel({ shell }: { shell: Shell }) {
  const [show, setShow] = useState<Show>("readable");
  const [rows, setRows] = useState<SentenceRow[]>([]);
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = (which: Show, offset: number) => {
    if (which === "unlock") return;
    setLoading(true);
    get<{ sentences: SentenceRow[] }>("sentences", {
      show: which,
      offset,
      limit: PAGE,
    })
      .then((r) => {
        setRows((prev) => (offset ? [...prev, ...r.sentences] : r.sentences));
        setMore(r.sentences.length === PAGE);
        setError(null);
      })
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => load(show, 0), [show]);

  const s = shell.summary;
  const tabs: Array<{ key: Show; label: string; n: number | null }> = [
    { key: "readable", label: "Readable", n: s?.readable ?? null },
    { key: "one", label: "One away", n: s?.oneAway ?? null },
    { key: "locked", label: "Locked", n: s?.locked ?? null },
    { key: "unlock", label: "Unlock next", n: null },
  ];

  return (
    <>
      <div className="cf-filters">
        <div className="cf-seg" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={show === t.key}
              className={`cf-seg-btn${show === t.key ? " is-on" : ""}`}
              onClick={() => setShow(t.key)}
            >
              {t.label}{" "}
              {t.n !== null && <span className="cf-seg-n">{fmt(t.n)}</span>}
            </button>
          ))}
        </div>
      </div>

      {show === "unlock" && <UnlockPanel shell={shell} />}
      {show !== "unlock" && (
        <>
          {error && <p className="cf-error">{error}</p>}
          {!loading && rows.length === 0 && (
            <p className="cf-muted cf-pad">No sentences here.</p>
          )}
          <ul className="cf-list">
            {rows.map((r) => (
              <li key={r.id} className="cf-sentence">
                <div className="cf-zh">{r.zh}</div>
                {r.en && <div className="cf-en">{r.en}</div>}
                <div className="cf-sentence-meta">
                  {r.blockers.map((w) => (
                    <span key={w} className="cf-blocker">
                      {w}
                    </span>
                  ))}
                  {r.card && (
                    <span className="cf-tag">{CARD_LABEL[r.card]}</span>
                  )}
                  {r.sources.map((src) => (
                    <span key={src} className="cf-tag">
                      {src}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {loading && <p className="cf-muted cf-pad">Loading…</p>}
          {!loading && more && rows.length > 0 && (
            <button className="cf-more" onClick={() => load(show, rows.length)}>
              Show more
            </button>
          )}
        </>
      )}
    </>
  );
}
