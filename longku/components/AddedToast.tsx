"use client";

import { useEffect, useRef, useState } from "react";
import type { BankEntry } from "@longku/lib/store";
import {
  coverageByTier,
  freqTierOf,
  playabilityOf,
  type TierCount,
  type TierMass,
} from "@longku/lib/frequency";
import { TierPill } from "./AddChengyu";

/** A syllable the add opened up: the first of your words to start with it. */
interface Unlocked {
  syl: string;
  /** Your words ending on it, which a chain can now carry on from. */
  arriving: string[];
  /** Corpus words ending on it — every way a chain could arrive. */
  ending: number;
}

export interface Added {
  /** Distinguishes one add from the next, so a new one restarts the popup. */
  key: number;
  words: BankEntry[];
  /** The headline: the chance of a reply to a chengyu someone plays — see playabilityOf. */
  playability: { before: number; after: number };
  /** Share of syllables with at least one of your words. */
  syllables: { before: number; after: number };
  /** Usage coverage of each tier the added words fall in. */
  tiers: Array<{ id: string; label: string; before: number; after: number }>;
  unlocked: Unlocked[];
  /** Where a single added word leads: how many of yours start on its last syllable. */
  onward: { syl: string; count: number } | null;
}

/**
 * What an add changed, measured against the bank before it.
 *
 * Computed from the two banks rather than at each place a word can be added —
 * the rail, a syllable's view, the learn list, a bridge in the chain — so none
 * of them has to remember to announce it.
 */
export function measureAdd(
  before: Record<string, BankEntry>,
  after: Record<string, BankEntry>,
  added: string[],
  corpus: Array<{ syl: string; ending: number }>,
  corpusSyllables: number,
  endingMass: Record<string, number>,
  tierMass: TierMass,
  tierWords: TierCount,
): Omit<Added, "key"> {
  const prev = Object.values(before);
  const next = Object.values(after);
  const words = added.map((w) => after[w]).filter(Boolean);

  const startsBefore = new Set(prev.map((e) => e.fs));
  const startsAfter = new Set(next.map((e) => e.fs));
  const share = (n: number) => (corpusSyllables > 0 ? n / corpusSyllables : 0);

  const covBefore = coverageByTier(prev, tierMass, tierWords);
  const covAfter = coverageByTier(next, tierMass, tierWords);
  const touched = new Set(
    words.filter((e) => !e.offCorpus && e.f !== undefined).map((e) => freqTierOf(e.f!)),
  );
  const tiers = covAfter
    .filter((t) => touched.has(t.id as ReturnType<typeof freqTierOf>))
    .map((t) => ({
      id: t.id,
      label: t.label,
      before: covBefore.find((b) => b.id === t.id)?.share ?? 0,
      after: t.share,
    }));

  const endingBySyl = new Map(corpus.map((c) => [c.syl, c.ending]));
  const unlocked = [...new Set(words.map((e) => e.fs))]
    .filter((syl) => !startsBefore.has(syl))
    .map((syl) => ({
      syl,
      arriving: next
        .filter((e) => e.ls === syl && !added.includes(e.w))
        .map((e) => e.w),
      ending: endingBySyl.get(syl) ?? 0,
    }));

  const one = words.length === 1 ? words[0] : null;
  const onward =
    one && one.ls
      ? { syl: one.ls, count: next.filter((e) => e.fs === one.ls && e.w !== one.w).length }
      : null;

  return {
    words,
    playability: { before: playabilityOf(prev, endingMass), after: playabilityOf(next, endingMass) },
    syllables: { before: share(startsBefore.size), after: share(startsAfter.size) },
    tiers,
    unlocked,
    onward,
  };
}

/**
 * Decimal places for a before → after pair: two under 10%, one above, and
 * more if that's what it takes for the move to show — a word opening a rare
 * ending adds hundredths of a point to playability, and "+0.0" would read as
 * nothing.
 */
function places(before: number, after: number): number {
  const d = Math.abs(after - before) * 100;
  let n = after * 100 < 10 ? 2 : 1;
  while (n < 3 && d > 0 && Number(d.toFixed(n)) === 0) n++;
  return n;
}

/** A share as a percentage, to `n` places. */
function pct(x: number, n: number): string {
  return `${(x * 100).toFixed(n)}%`;
}

/** The change, in points, to the same places as the figures beside it. */
function delta(before: number, after: number, n: number): string {
  const d = (after - before) * 100;
  return Number(d.toFixed(n)) === 0 ? `+<${(10 ** -n).toFixed(n)}` : `+${d.toFixed(n)}`;
}

/** One before → after row. */
function Stat({
  label,
  before,
  after,
  className = "",
}: {
  label: string;
  before: number;
  after: number;
  className?: string;
}) {
  const n = places(before, after);
  return (
    <div className={`longku-toast-stat ${className}`}>
      <span className="longku-toast-label">{label}</span>
      <span className="longku-toast-from">{pct(before, n)}</span>
      <span className="longku-toast-arrow">→</span>
      <span className="longku-toast-to">{pct(after, n)}</span>
      <span className="longku-toast-delta">{delta(before, after, n)}</span>
    </div>
  );
}

/**
 * The popup after an add: what it moved, and — when it was the first word on a
 * syllable — what that opened. Stays longer for an unlock, pauses while the
 * pointer is on it, and gives way to the next add.
 */
export function AddedToast({ added, onClose }: { added: Added; onClose: () => void }) {
  const [hover, setHover] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const unlock = added.unlocked.length > 0;
  const life = unlock ? 9000 : 5500;

  // A new add restarts the clock; hovering holds it.
  useEffect(() => {
    setLeaving(false);
  }, [added.key]);
  useEffect(() => {
    if (hover) return;
    const out = setTimeout(() => setLeaving(true), life);
    const gone = setTimeout(() => closeRef.current(), life + 220);
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [hover, life, added.key]);

  const head = added.words[0];
  const more = added.words.length - 1;
  const { playability, syllables } = added;
  const opened = playability.after > playability.before;

  return (
    <div
      key={added.key}
      className={`longku-toast ${unlock ? "is-unlock" : ""} ${leaving ? "is-leaving" : ""}`}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {unlock && (
        <span className="longku-toast-seal" aria-hidden>
          新
        </span>
      )}
      <div className="longku-toast-head">
        <span className="longku-toast-spark" aria-hidden>
          ✦
        </span>
        <span className="longku-toast-word">{head?.w}</span>
        {head && <TierPill f={head.f} offCorpus={head.offCorpus} />}
        {more > 0 && <span className="longku-toast-more">+{more} more</span>}
        <button type="button" className="longku-toast-close" onClick={onClose} aria-label="Dismiss">
          ✕
        </button>
      </div>

      <div className="longku-toast-stats">
        {/* Always shown: an add that leaves playability where it was says
            so, and why, rather than going quiet about the number that counts. */}
        {opened ? (
          <Stat
            label="playability"
            before={playability.before}
            after={playability.after}
            className="is-headline"
          />
        ) : (
          <div className="longku-toast-stat is-headline">
            <span className="longku-toast-label">playability</span>
            <span className="longku-toast-same">
              {pct(playability.after, places(playability.after, playability.after))} —{" "}
              {unlock
                ? `nothing in the corpus ends on ${added.unlocked.map((u) => u.syl).join(", ")}`
                : `you already start on ${more > 0 ? "these syllables" : head?.fs}`}
            </span>
          </div>
        )}
        {syllables.after > syllables.before && (
          <Stat label="syllables" before={syllables.before} after={syllables.after} />
        )}
        {added.tiers.map((t) => (
          <Stat
            key={t.id}
            label={`${t.label} usage`}
            before={t.before}
            after={t.after}
            className={`tier-${t.id}`}
          />
        ))}
      </div>

      {added.unlocked.map((u) => (
        <div key={u.syl} className="longku-toast-unlock">
          <div className="longku-toast-unlock-head">
            unlocked <strong>{u.syl}</strong>
          </div>
          {u.arriving.length > 0 ? (
            <div className="longku-toast-unlock-body">
              <b>{u.arriving.length}</b> of yours end on {u.syl} and can chain on now
              <div className="longku-toast-arriving">
                {u.arriving.slice(0, 6).map((w) => (
                  <span key={w}>{w}</span>
                ))}
                {u.arriving.length > 6 && <span>+{u.arriving.length - 6}</span>}
              </div>
            </div>
          ) : (
            <div className="longku-toast-unlock-body">
              none of yours end on {u.syl} yet — {u.ending} idioms do
            </div>
          )}
        </div>
      ))}

      {added.onward && (
        <div className={`longku-toast-onward ${added.onward.count > 0 ? "is-on" : ""}`}>
          leads to {added.onward.syl} —{" "}
          {added.onward.count > 0
            ? `${added.onward.count} of yours carry on from there`
            : "nothing of yours starts there yet"}
        </div>
      )}
    </div>
  );
}
