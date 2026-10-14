"use client";

// The shell: who is here, where the deck stands, and which screen is up.
//
// Everything is in the database. This page asks for what it shows and reports
// what the owner does; it holds no copy of the corpus. The owner, signed in,
// reviews. Anyone else sees the same screens with nothing that changes them.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Addition, Summary } from "@chongfuxi/lib/api";
import { get, today } from "@chongfuxi/lib/client";
import { CardsPanel } from "./CardsPanel";
import { ImportPanel } from "./ImportPanel";
import { NewWordsScreen } from "./NewWords";
import { ReviewPanel } from "./ReviewPanel";
import { StatsPanel } from "./StatsPanel";
import { fmt, message, type Shell } from "./shared";

type Tab = "review" | "cards" | "stats" | "import";

const TABS: Array<{ key: Tab; label: string; zh: string }> = [
  { key: "review", label: "Review", zh: "复习" },
  { key: "cards", label: "Cards", zh: "卡片" },
  { key: "stats", label: "Stats", zh: "统计" },
  { key: "import", label: "Import", zh: "导入" },
];

export function ChongfuxiApp() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  // A review session takes the whole screen.
  const [focus, setFocus] = useState(false);
  // Words that joined the deck since the owner last looked, shown once, oldest first.
  const [arrivals, setArrivals] = useState<Addition[]>([]);

  const refresh = useCallback(() => {
    get<Summary>("summary", today())
      .then((s) => {
        setSummary(s);
        setError(null);
      })
      .catch((e) => setError(message(e)));
  }, []);

  useEffect(() => {
    refresh();
    // The counts move with the clock too: cards fall due, the day turns over.
    const seen = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, [refresh]);

  const canWrite = Boolean(summary?.viewer.isOwner);

  const checkArrivals = useCallback(() => {
    get<{ additions: Addition[] }>("additions")
      .then((r) => setArrivals(r.additions.filter((a) => !a.seen && !a.undone).reverse()))
      .catch(() => {
        // Nothing to show if it can't be fetched; it will be next time.
      });
  }, []);
  // On opening, and whenever the app comes back into view (after a sync on the phone).
  useEffect(() => {
    if (!canWrite) return;
    checkArrivals();
    const seen = () => document.visibilityState === "visible" && checkArrivals();
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, [canWrite, checkArrivals]);
  const shell: Shell = useMemo(() => ({ summary, canWrite, refresh, setFocus }), [summary, canWrite, refresh]);
  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className={`cfx${focus ? " is-focus" : ""}`}>
      <header className="cf-top">
        <div className="cf-title">
          <h1>
            重复习 <span className="cf-title-py">chóngfùxí</span>
          </h1>
          {summary && summary.viewer.configured && !canWrite && (
            <button className="cf-tag-btn" title="You're looking at Benji's deck; only he can review it" onClick={() => go("import")}>
              <span className="cf-tag">read-only</span>
            </button>
          )}
        </div>
        {/* Cards, said as cards: how many there are of each kind, and how many sentences are still locked. */}
        <div className="cf-state" aria-label="Where the deck stands">
          <div title="A Read card for every word, plus the Recall cards opened so far">
            <small>Words</small>
            <b>{summary ? fmt(summary.wordCards) : "—"}</b>
            <span>word cards</span>
          </div>
          <div title="Sentences whose every word is known. Each has a sentence card.">
            <small>Sentences</small>
            <b>{summary ? fmt(summary.readable) : "—"}</b>
            <span>unlocked cards</span>
          </div>
          <div title={summary ? `${fmt(summary.oneAway)} of them are one word away` : undefined}>
            <small>Sentences</small>
            <b>{summary ? fmt(summary.oneAway + summary.locked) : "—"}</b>
            <span>locked</span>
          </div>
        </div>
      </header>

      <main className="cf-main">
        {error && <p className="cf-error">{error}</p>}
        {!summary && !error && <p className="cf-muted cf-pad">Loading…</p>}
        {summary && !summary.viewer.configured && tab !== "import" && (
          <p className="cf-muted cf-pad">This deployment has no database set up, so there is nothing to show.</p>
        )}
        {summary?.viewer.configured && tab === "review" && <ReviewPanel shell={shell} onImport={() => go("import")} />}
        {summary?.viewer.configured && tab === "cards" && <CardsPanel shell={shell} />}
        {summary?.viewer.configured && tab === "stats" && <StatsPanel shell={shell} />}
        {summary && tab === "import" && <ImportPanel shell={shell} />}
      </main>

      {canWrite && arrivals[0] && !focus && (
        <NewWordsScreen
          key={arrivals[0].id}
          addition={arrivals[0]}
          onDone={() => {
            setArrivals((list) => list.slice(1));
            refresh();
          }}
        />
      )}

      {/* At the bottom, where a thumb reaches on a phone. */}
      <nav className="cf-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`cf-tab${tab === t.key ? " is-on" : ""}`}
            aria-current={tab === t.key ? "page" : undefined}
            onClick={() => go(t.key)}
          >
            <span className="cf-tab-zh">{t.zh}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
