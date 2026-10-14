"use client";

// The shell: who is here, where the deck stands, and which screen is up.
//
// Everything is in the database. This page asks for what it shows and reports
// what the owner does; it holds no copy of the corpus. The owner, signed in,
// reviews. Anyone else sees the same screens with nothing that changes them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnkiSync, Summary } from "@chongfuxi/lib/api";
import { get, today } from "@chongfuxi/lib/client";
import { CardsPanel } from "./CardsPanel";
import { ImportPanel } from "./ImportPanel";
import { BugButton } from "./BugReport";
import { SyncPage } from "./SyncPage";
import { TabIcon } from "./TabIcon";
import { ReviewPanel } from "./ReviewPanel";
import { StatsPanel } from "./StatsPanel";
import * as back from "@chongfuxi/lib/back";
import * as outbox from "@chongfuxi/lib/outbox";
import { Waiting, fmt, message, useBackLayer, useOutbox, type Shell } from "./shared";

type Tab = "review" | "cards" | "stats" | "import";

// Each icon carries a character of the tab's Chinese name: 复习, 卡片, 统计, 导入.
const OFFLINE = "No connection: these counts may be out of date.";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "review", label: "Review" },
  { key: "cards", label: "Cards" },
  { key: "stats", label: "Stats" },
  { key: "import", label: "Import" },
];

export function ChongfuxiApp() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  // A review session takes the whole screen.
  const [focus, setFocus] = useState(false);
  // A sync that added words and hasn't been looked at yet: its page opens by itself, oldest first.
  const [arrival, setArrival] = useState<number | null>(null);

  const refresh = useCallback(() => {
    get<Summary>("summary", today())
      .then((s) => {
        setSummary(s);
        setError(null);
      })
      // Offline, the counts on screen stay as they were and say so.
      .catch((e) => setError(e instanceof TypeError ? OFFLINE : message(e)));
  }, []);

  useEffect(() => {
    refresh();
    // The counts move with the clock too: cards fall due, the day turns over.
    const seen = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", seen);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", seen);
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);

  // Answers kept on the device while offline go when there is a way out; the
  // counts follow once they have.
  const { sending, pending } = useOutbox();
  const wasSending = useRef(sending);
  useEffect(() => {
    if (wasSending.current && !sending) refresh();
    wasSending.current = sending;
  }, [sending, refresh]);
  useEffect(() => outbox.start(), []);
  // The phone's back button moves through the app (lib/back.ts); from any
  // other tab it comes to Review, and from Review it leaves.
  useEffect(() => back.install(), []);
  useBackLayer(tab !== "review", () => setTab("review"));

  const canWrite = Boolean(summary?.viewer.isOwner);

  const checkArrivals = useCallback(() => {
    get<{ syncs: AnkiSync[] }>("anki-log")
      .then((r) => {
        // Only a sync that changed something: one that brought nothing new stays in the log.
        const waiting = r.syncs.filter((s) => !s.seen && s.processed && s.additionId !== null && !s.undone);
        setArrival(waiting.length ? waiting[waiting.length - 1].id : null);
      })
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
        {/* At a glance: words and characters known, and how much of the corpus they read. */}
        <Glance summary={summary} />
      </header>

      <main className="cf-main">
        {/* Offline with answers waiting, the waiting line says it all. */}
        {error && !(error === OFFLINE && pending) && <p className="cf-error">{error}</p>}
        {!focus && <Waiting />}
        {!summary && !error && <p className="cf-muted cf-pad">Loading…</p>}
        {summary && !summary.viewer.configured && tab !== "import" && (
          <p className="cf-muted cf-pad">This deployment has no database set up, so there is nothing to show.</p>
        )}
        {summary?.viewer.configured && tab === "review" && <ReviewPanel shell={shell} onImport={() => go("import")} />}
        {summary?.viewer.configured && tab === "cards" && <CardsPanel shell={shell} />}
        {summary?.viewer.configured && tab === "stats" && <StatsPanel shell={shell} />}
        {summary && tab === "import" && <ImportPanel shell={shell} />}
      </main>

      {canWrite && arrival !== null && !focus && (
        <SyncPage
          key={arrival}
          syncId={arrival}
          canWrite
          onDone={() => {
            setArrival(null);
            refresh();
            checkArrivals();
          }}
        />
      )}

      {/* The owner files a bug from wherever they are. */}
      {canWrite && <BugButton screen={focus ? "a review session" : `the ${TABS.find((t) => t.key === tab)?.label ?? tab} tab`} />}

      {/* At the bottom, where a thumb reaches on a phone. */}
      <nav className="cf-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`cf-tab${tab === t.key ? " is-on" : ""}`}
            aria-current={tab === t.key ? "page" : undefined}
            onClick={() => go(t.key)}
          >
            <span className="cf-tab-icon">
              <TabIcon kind={t.key} />
            </span>
            <span className="cf-tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/**
 * The header's figures: the words in the deck and the characters across them,
 * each beside its own mark (词, 字), and the sentences as one bar: readable,
 * one word away, and still locked, with the share readable called out.
 */
function Glance({ summary: s }: { summary: Summary | null }) {
  const total = s ? s.readable + s.oneAway + s.locked : 0;
  const share = (n: number) => (total ? (100 * n) / total : 0);
  const pct = s ? Math.round(share(s.readable)) : null;
  return (
    <div className="cf-glance" aria-label="Where the deck stands">
      <div className="cf-glance-row">
        <span className="cf-glance-stat is-words" title="Words in the deck, each with a Read card">
          <i aria-hidden="true">词</i>
          <span>
            <b>{s ? fmt(s.words) : "—"}</b>
            <small>words</small>
          </span>
        </span>
        <span className="cf-glance-stat is-chars" title="Different characters across those words">
          <i aria-hidden="true">字</i>
          <span>
            <b>{s ? fmt(s.characters) : "—"}</b>
            <small>characters</small>
          </span>
        </span>
        <span className="cf-glance-stat is-sentences" title="Of all the sentences, those every word of which is known">
          <i aria-hidden="true">句</i>
          <span>
            <b>{pct === null ? "—" : `${pct}%`}</b>
            <small>readable</small>
          </span>
        </span>
      </div>
      <div
        className="cf-glance-bar"
        role="img"
        aria-label={
          s
            ? `${fmt(s.readable)} of ${fmt(total)} sentences readable, ${fmt(s.oneAway)} one word away, ${fmt(s.locked)} locked`
            : "Sentences"
        }
      >
        {s && (
          <>
            <i className="is-readable" style={{ width: `${share(s.readable)}%` }} />
            <i className="is-near" style={{ width: `${share(s.oneAway)}%` }} />
          </>
        )}
      </div>
      <p className="cf-glance-key">
        <span>
          <i className="is-readable" />
          {s ? fmt(s.readable) : "—"} readable
        </span>
        <span>
          <i className="is-near" />
          {s ? fmt(s.oneAway) : "—"} one away
        </span>
        <span>
          <i className="is-locked" />
          {s ? fmt(s.locked) : "—"} locked
        </span>
      </p>
    </div>
  );
}
