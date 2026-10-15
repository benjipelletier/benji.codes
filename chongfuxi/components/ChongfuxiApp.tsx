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
import { ImportPanel, type ImportPage } from "./ImportPanel";
import { LookupPanel } from "./LookupPanel";
import { Account } from "./Account";
import { BugButton } from "./BugReport";
import { SyncPage } from "./SyncPage";
import { TabIcon } from "./TabIcon";
import { ReviewPanel } from "./ReviewPanel";
import { StatsPanel } from "./StatsPanel";
import * as back from "@chongfuxi/lib/back";
import * as outbox from "@chongfuxi/lib/outbox";
import { Waiting, fmt, message, useBackLayer, useOutbox, type Shell } from "./shared";

type Tab = "review" | "cards" | "lookup" | "stats" | "import";

// Each icon carries a character of the tab's Chinese name: 复习, 卡片, 查, 统计, 导入.
const OFFLINE = "No connection: these counts may be out of date.";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "review", label: "Review" },
  { key: "cards", label: "Cards" },
  // The owner's only: every lookup asks a model.
  { key: "lookup", label: "Look up" },
  { key: "stats", label: "Stats" },
  { key: "import", label: "Import" },
];

export function ChongfuxiApp() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  // Which page Import opens on: Review's "Import a Pleco backup" goes straight to it.
  const [importPage, setImportPage] = useState<ImportPage | undefined>(undefined);
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
  // The header's height, for what holds itself just under it (Cards' switch).
  const top = useRef<HTMLElement>(null);
  const [topH, setTopH] = useState(0);
  useEffect(() => {
    const el = top.current;
    if (!el) return;
    const seen = new ResizeObserver(() => setTopH(el.offsetHeight));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  const shell: Shell = useMemo(() => ({ summary, canWrite, refresh, setFocus }), [summary, canWrite, refresh]);
  const go = (t: Tab, page?: ImportPage) => {
    setTab(t);
    setImportPage(page);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className={`cfx${focus ? " is-focus" : ""}`} style={{ "--cf-top-h": `${topH}px` } as React.CSSProperties}>
      <header className="cf-top" ref={top}>
        <div className="cf-title">
          <h1>
            重复习 <span className="cf-title-py">chóngfùxí</span>
            {/* Which release this is (counted at build time, next.config.ts), and its commit. */}
            <span className="cf-version" title={process.env.NEXT_PUBLIC_CHONGFUXI_COMMIT}>
              v{process.env.NEXT_PUBLIC_CHONGFUXI_VERSION}
            </span>
          </h1>
          {/* Who is here, and signing in or out. */}
          {summary && <Account viewer={summary.viewer} />}
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
        {summary?.viewer.configured && tab === "review" && <ReviewPanel shell={shell} onImport={() => go("import", "pleco")} />}
        {summary?.viewer.configured && tab === "cards" && <CardsPanel shell={shell} />}
        {summary?.viewer.configured && tab === "lookup" && <LookupPanel shell={shell} />}
        {summary?.viewer.configured && tab === "stats" && <StatsPanel shell={shell} />}
        {summary && tab === "import" && <ImportPanel shell={shell} start={importPage} />}
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
        {TABS.filter((t) => t.key !== "lookup" || canWrite).map((t) => (
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
 * The header's figures, in one quiet line: the words in the deck (词), the
 * distinct characters across them (字), and the share of sentences readable
 * (句). Figures only: no bars.
 */
function Glance({ summary: s }: { summary: Summary | null }) {
  const total = s ? s.readable + s.oneAway + s.locked : 0;
  const pct = s && total ? (100 * s.readable) / total : null;
  const detail = s
    ? `${fmt(s.readable)} of ${fmt(total)} sentences readable; ${fmt(s.oneAway)} one word away, ${fmt(s.locked)} further off`
    : undefined;
  return (
    <div className="cf-glance" aria-label="Where the deck stands">
      <p className="cf-glance-line">
        <span className="is-words" title="Words in the deck">
          {s ? fmt(s.words) : "—"}
          <i>词</i>
        </span>
        <span className="is-chars" title="Different characters across those words">
          {s ? fmt(s.characters) : "—"}
          <i>字</i>
        </span>
        <span className="is-sentences" title={detail} aria-label={detail}>
          {pct === null ? "—" : `${Math.round(pct)}%`}
          <i>句</i>
          <small>readable</small>
        </span>
      </p>
    </div>
  );
}
