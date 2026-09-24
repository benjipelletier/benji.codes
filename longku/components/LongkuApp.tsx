"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bootstrap, hydrate, type BankEntry, type Mode, type State } from "@longku/lib/store";
import { stats as bankStats, unused } from "@longku/lib/chains";
import {
  coverageByTier,
  tierCounts,
  usageCoverage,
  type TierCount,
  type TierMass,
} from "@longku/lib/frequency";
import { SyllableGrid, type SyllableSummary } from "./SyllableGrid";
import { DrillModal } from "./DrillModal";
import { ChainView } from "./ChainView";
import { ChainPlay } from "./ChainPlay";
import { Rail, type View } from "./Rail";
import { signInWithGoogle, signOut } from "@longku/lib/auth-client";
import { StatsSheet } from "./StatsSheet";
import { ProgressStrip } from "./ProgressStrip";
import { LearnNext } from "./LearnNext";
import { WordList } from "./WordList";
import { AddedToast, measureAdd, type Added } from "./AddedToast";

interface Props {
  syllables: SyllableSummary[];
  /** Sum of every corpus frequency — the denominator for usage coverage. */
  corpusMass: number;
  /** Corpus frequency mass per tier — the denominator for each tier's bar. */
  tierMass: TierMass;
  /** Corpus word count per tier — the denominator for each tier's mine/corpus. */
  tierWords: TierCount;
}

export function LongkuApp({ syllables, corpusMass, tierMass, tierWords }: Props) {
  const [state, setState] = useState<State>({
    bank: {},
    sweep: [],
    chains: [],
    reviews: [],
  });
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<Mode>("local");
  const [email, setEmail] = useState<string | null>(null);
  const [activeSyl, setActiveSyl] = useState<string | null>(null);
  const [view, setView] = useState<View>("wall");
  const [sheetOpen, setSheetOpen] = useState(false);
  // Whether the chain game is showing. Remembered, because a dock that
  // reopened on every reload would be worse than not being able to close it.
  const [dockOpen, setDockOpen] = useState(true);
  const [startAt, setStartAt] = useState<{ syl: string; nonce: number }>({ syl: "", nonce: 0 });
  const topRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem("longku:dock") === "closed") setDockOpen(false);
    } catch {
      // Storage unavailable; the dock just starts open.
    }
  }, []);

  function setDock(open: boolean) {
    setDockOpen(open);
    try {
      localStorage.setItem("longku:dock", open ? "open" : "closed");
    } catch {
      // Persistence is a nicety; the state is already applied.
    }
  }

  useEffect(() => {
    let cancelled = false;
    bootstrap().then((b) => {
      if (cancelled) return;
      setState(b.state);
      setMode(b.mode);
      setEmail(b.email);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Words migrated from v1 carry no ending syllable and no frequency, which
  // would keep them out of every chain and out of usage coverage. Resolve those
  // once against the corpus.
  useEffect(() => {
    if (!hydrated || mode === "spectator") return;
    const missing = Object.values(state.bank)
      .filter((e) => e.ls === null || (e.f === undefined && !e.offCorpus))
      .map((e) => e.w);
    if (missing.length === 0) return;
    let cancelled = false;
    fetch("/api/longku/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runs: missing }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const readings = [
          ...(d.found ?? []).map((x: { w: string; fs: string; ls: string; f: number }) => ({
            w: x.w,
            fs: x.fs,
            ls: x.ls,
            f: x.f,
          })),
          ...(d.unmatched ?? []).map((u: { w: string; fs: string; ls: string | null }) => ({
            w: u.w,
            fs: u.fs,
            ls: u.ls,
          })),
        ];
        if (readings.length > 0) setState(hydrate(readings));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Runs once per hydration; the bank identity changes on every write, so
    // depending on it would re-fire the fetch after each recall.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, mode]);

  // The sticky header's height varies — the rail wraps on narrow screens and
  // the spectator banner comes and goes — so publish it as a custom property
  // instead of hard-coding an offset the row letters would eventually get wrong.
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--lg-top-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hydrated, mode]);

  // Same trick for the dock, which sticks over the bottom of the canvas. Its
  // height is anything but fixed — the chain log grows with the sweep, the
  // reveal opens under it, and on a phone the whole thing stacks — so the
  // padding that keeps the last wall rows reachable has to be measured. The
  // token had a hard-coded 92px, which hid the bottom ~150px of the wall.
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--lg-dock-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hydrated]);

  // Announce adds. Diffing the bank catches every way a word gets in — the
  // rail, a syllable's view, the learn list, a bridge banked mid-chain —
  // without each of them having to report it. The first bank seen is the
  // load, not an add.
  const [added, setAdded] = useState<Added | null>(null);
  const lastBank = useRef<Record<string, BankEntry> | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const before = lastBank.current;
    // A copy, not the object: the store adds to its current bank in place
    // before committing a new one, so a kept reference would already hold
    // the word by the time it's compared.
    lastBank.current = { ...state.bank };
    if (!before) return;
    const fresh = Object.keys(state.bank).filter((w) => !before[w]);
    if (fresh.length === 0) return;
    setAdded({
      key: Date.now(),
      ...measureAdd(before, state.bank, fresh, syllables, syllables.length, tierMass, tierWords),
    });
    // Only the bank's contents matter here; the corpus props never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.bank, hydrated]);

  const bankArr = useMemo(() => Object.values(state.bank), [state]);
  const dueCount = useMemo(() => unused(state).length, [state]);
  const s = useMemo(() => bankStats(state), [state]);
  const cov = useMemo(() => usageCoverage(bankArr, corpusMass), [bankArr, corpusMass]);
  const byTier = useMemo(
    () => coverageByTier(bankArr, tierMass, tierWords),
    [bankArr, tierMass, tierWords],
  );
  const tiers = useMemo(() => tierCounts(bankArr), [bankArr]);
  const sylCovered = useMemo(() => new Set(bankArr.map((e) => e.fs)).size, [bankArr]);
  const corpusWords = useMemo(
    () => syllables.reduce((n, x) => n + x.count, 0),
    [syllables],
  );

  function startChainFrom(syl: string) {
    setStartAt((p) => ({ syl, nonce: p.nonce + 1 }));
    setActiveSyl(null);
    setDock(true);
  }

  return (
    <div className="longku">
      <div className="longku-top" ref={topRef}>
        <Rail
          state={state}
          onChange={setState}
          stats={s}
          view={view}
          onView={setView}
          onOpenStats={() => setSheetOpen(true)}
          readOnly={mode === "spectator"}
          ownerEmail={mode === "server" ? email : null}
        />
        {mode === "spectator" && <SpectatorBanner email={email} />}
      </div>

      <main className="longku-canvas">
        {hydrated && (
          <ProgressStrip
            playable={syllables.length > 0 ? sylCovered / syllables.length : 0}
            syllablesCovered={sylCovered}
            corpusSyllables={syllables.length}
            byTier={byTier}
            offCorpusCount={tiers.offcorpus}
            stats={s}
            onOpenStats={() => setSheetOpen(true)}
          />
        )}
        {!hydrated ? (
          <p className="longku-wall-empty">Loading…</p>
        ) : view === "wall" ? (
          <SyllableGrid
            syllables={syllables}
            state={state}
            onPick={(syl) => setActiveSyl(syl)}
            onStartChain={startChainFrom}
          />
        ) : view === "graph" ? (
          <ChainView state={state} />
        ) : view === "learn" ? (
          <LearnNext
            state={state}
            onChange={setState}
            readOnly={mode === "spectator"}
          />
        ) : (
          <WordList
            state={state}
            onChange={setState}
            onPickSyllable={(syl) => setActiveSyl(syl)}
            readOnly={mode === "spectator"}
          />
        )}
      </main>

      <div className={`longku-dock ${dockOpen ? "" : "is-closed"}`} ref={dockRef}>
        {!dockOpen ? (
          <button
            className="longku-dock-reopen"
            onClick={() => setDock(true)}
            title="Show the chain game"
          >
            <span className="longku-dock-label">接龙</span>
            <span className="longku-dock-reopen-sub">
              {s.total > 0 ? `${dueCount} due` : "play"}
            </span>
            <span aria-hidden>⌃</span>
          </button>
        ) : (
          hydrated && (
            <ChainPlay
              state={state}
              onChange={setState}
              startAt={startAt}
              onCollapse={() => setDock(false)}
            />
          )
        )}
      </div>

      {activeSyl && (
        <DrillModal
          syllable={activeSyl}
          corpus={syllables.find((x) => x.syl === activeSyl)}
          state={state}
          onClose={() => setActiveSyl(null)}
          onChange={setState}
          onStartChain={startChainFrom}
          readOnly={mode === "spectator"}
        />
      )}

      {added && <AddedToast added={added} onClose={() => setAdded(null)} />}

      {sheetOpen && (
        <StatsSheet
          stats={s}
          coverage={cov.share}
          byTier={byTier}
          tierCounts={tiers}
          corpusWords={corpusWords}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Spectators see the owner's corpus and can chain against it; nothing they do
 * is written back. Saying so up front beats letting them add a word and quietly
 * losing it on reload.
 *
 * Also the only door into the app: the owner signs in from here, via the same
 * site-wide Neon Auth mount jazz uses, so one Google sign-in covers both.
 */
function SpectatorBanner({ email }: { email: string | null }) {
  return (
    <div className="longku-spectator">
      <span className="longku-spectator-dot" aria-hidden />
      <span className="longku-spectator-text">
        {email ? (
          <>
            Signed in as <strong>{email}</strong>, which doesn&rsquo;t own this
            corpus — you can play the chains, but additions and recalls stay in
            this tab.
          </>
        ) : (
          <>
            Viewing a read-only corpus. You can play the chains, but additions
            and recalls stay in this tab.
          </>
        )}
      </span>
      <button
        className="longku-btn longku-spectator-cta"
        onClick={email ? signOut : signInWithGoogle}
      >
        {email ? "Sign out" : "Sign in"}
      </button>
    </div>
  );
}
