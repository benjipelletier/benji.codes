"use client";

import { useEffect, useRef, useState } from "react";
import type { BankEntry } from "@longku/lib/store";
import {
  coverageByTier,
  freqTierOf,
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
  /** The headline: share of syllables with at least one of your words. */
  playable: { before: number; after: number };
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
    playable: { before: share(startsBefore.size), after: share(startsAfter.size) },
    tiers,
    unlocked,
    onward,
  };
}

/** A share as a percentage, with enough places that a small move still shows. */
function pct(x: number): string {
  const p = x * 100;
  return `${p < 10 ? p.toFixed(2) : p.toFixed(1)}%`;
}

/** The change, in points, to the same precision as the figures beside it. */
function delta(before: number, after: number): string {
  const d = (after - before) * 100;
  return `+${after * 100 < 10 ? d.toFixed(2) : d.toFixed(1)}`;
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
  const moved = added.playable.after > added.playable.before;

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
        {moved && (
          <div className="longku-toast-stat is-headline">
            <span className="longku-toast-label">syllables</span>
            <span className="longku-toast-from">{pct(added.playable.before)}</span>
            <span className="longku-toast-arrow">→</span>
            <span className="longku-toast-to">{pct(added.playable.after)}</span>
            <span className="longku-toast-delta">
              {delta(added.playable.before, added.playable.after)}
            </span>
          </div>
        )}
        {added.tiers.map((t) => (
          <div key={t.id} className={`longku-toast-stat tier-${t.id}`}>
            <span className="longku-toast-label">{t.label} usage</span>
            <span className="longku-toast-from">{pct(t.before)}</span>
            <span className="longku-toast-arrow">→</span>
            <span className="longku-toast-to">{pct(t.after)}</span>
            <span className="longku-toast-delta">{delta(t.before, t.after)}</span>
          </div>
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
