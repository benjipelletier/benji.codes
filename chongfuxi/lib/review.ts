// The rules of a review that aren't the scheduler's: how a sentence retires,
// which words lapse when a sentence is forgotten, how the queue is mixed.
// Pure, so the server applies them and the check script can hold them to account.

import type { Grade } from "./schedule";

/** A sentence is done with after this many clean reads, each on a different day. */
export const CLEAN_READS_TO_RETIRE = 2;
/** One brought back by a forgotten word has this many already: one more clean read retires it again. */
export const REVIVED_CLEAN_READS = 1;

export interface SentenceProgress {
  cleanReads: number;
  /** The study day of the last clean read. */
  lastCleanDay: string | null;
  retired: boolean;
}

/**
 * A sentence after being read. A clean read counts once per day, so two in one
 * sitting are one. Forgetting it starts the count again.
 */
export function readSentence(p: SentenceProgress, grade: Grade, day: string): SentenceProgress {
  if (grade === "forgot") return { cleanReads: 0, lastCleanDay: null, retired: false };
  if (p.lastCleanDay === day) return p;
  const cleanReads = p.cleanReads + 1;
  return { cleanReads, lastCleanDay: day, retired: cleanReads >= CLEAN_READS_TO_RETIRE };
}

/** Every run of two or more characters inside the given words, and the words themselves. */
export function piecesOf(words: string[]): string[] {
  const out = new Set<string>();
  for (const w of words) {
    const chars = [...w];
    for (let i = 0; i < chars.length; i++) {
      for (let j = i + 1; j <= chars.length; j++) out.add(chars.slice(i, j).join(""));
    }
  }
  return [...out];
}

/**
 * The deck words that lapse when these words are tapped in a forgotten
 * sentence. A tapped word that is in the deck lapses itself. One that isn't —
 * 孩子们 is read from 孩子 and 们 — passes the lapse to the deck words it is
 * made of, longest first from the left.
 */
export function lapseTargets(tapped: string[], deck: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const word of tapped) {
    if (deck.has(word)) {
      out.add(word);
      continue;
    }
    const chars = [...word];
    let i = 0;
    while (i < chars.length) {
      let len = chars.length - i;
      for (; len > 0; len--) {
        if (deck.has(chars.slice(i, i + len).join(""))) break;
      }
      if (len > 0) {
        out.add(chars.slice(i, i + len).join(""));
        i += len;
      } else i++;
    }
  }
  return [...out];
}

/** The longest headword looked for around a word (chengyu are four). */
const COMPOUND_MAX = 4;

/**
 * How well a sentence serves as a word's context, judged where the word first
 * appears (the place a card highlights or blanks). `bound`: there it is part
 * of a longer dictionary word (手 in 住手, 日 in 周日), so the sentence shows
 * the compound, not the word. `repeated`: one of its characters is written
 * again elsewhere (月 in 下个月是二月), which gives a blank away.
 */
export function contextFit(zh: string, word: string, isHeadword: (w: string) => boolean): { bound: boolean; repeated: boolean } {
  const at = zh.indexOf(word);
  if (at < 0 || !word) return { bound: false, repeated: false };
  const end = at + word.length;
  let bound = false;
  for (let len = word.length + 1; len <= COMPOUND_MAX && !bound; len++) {
    for (let start = Math.max(0, end - len); start <= at && !bound; start++) {
      if (start + len > zh.length) break;
      bound = isHeadword(zh.slice(start, start + len));
    }
  }
  const rest = zh.slice(0, at) + zh.slice(end);
  return { bound, repeated: [...word].some((ch) => rest.includes(ch)) };
}

/** A sentence with a word blanked out, or null when the word isn't written in it as such. */
export function blankOut(zh: string, word: string): string | null {
  const at = zh.indexOf(word);
  if (at < 0) return null;
  return `${zh.slice(0, at)}${"＿".repeat(Math.max(2, [...word].length))}${zh.slice(at + word.length)}`;
}

/** The mix of a session: two words for every sentence due, and a new sentence every fourth card. */
export const CYCLE = ["word", "sentence", "word", "new"] as const;
/** While cards are due, a batch takes one new sentence for every this many due. */
export const DUE_PER_NEW = 3;
/** Cards a session fetches at a time, and how few left in hand before it fetches more. */
export const SESSION_BATCH = 10;
export const REFILL_AT = 3;
/**
 * Word cards missed last time (their latest answer a Forgot) have the lowest
 * recall odds, so they would all come first, a wall of them. Instead at most
 * one in every this many word cards is one, the others between them; they
 * still come early (the owner chose this over keeping them all first).
 */
export const MISS_EVERY = 3;

/**
 * Word cards never answered (a Recall card just opened): at most one in this
 * many, so a backlog of them doesn't hold back the cards already on a schedule.
 */
export const UNANSWERED_EVERY = 2;

/** Spread the picked cards through the others, at most one in every `every`, keeping each group's order. */
export function spreadEvery<T>(cards: T[], picked: (c: T) => boolean, every: number): T[] {
  const some = cards.filter(picked);
  const others = cards.filter((c) => !picked(c));
  const out: T[] = [];
  while (some.length || others.length) {
    if (some.length) out.push(some.shift()!);
    for (let k = 1; k < every && others.length; k++) out.push(others.shift()!);
    if (!others.length) out.push(...some.splice(0));
  }
  return out;
}

/** Spread the missed cards through the others, one in every MISS_EVERY, keeping each group's order. */
export const spreadMisses = <T,>(cards: T[], missed: (c: T) => boolean): T[] => spreadEvery(cards, missed, MISS_EVERY);
/** Due word cards read per batch, as a multiple of the batch, before one card per word is kept. */
export const WORD_POOL_FACTOR = 4;
/** A word card rotates through this many of its readable sentences, best first. */
export const CONTEXT_POOL = 12;
/** Ranked in SQL before the ones that fit badly (contextFit) are sent to the back. */
export const CONTEXT_CANDIDATES = 40;
/** Shorter than this is a scrap (我哥哥。), shown under a word only when the word has nothing longer. */
export const CONTEXT_MIN_HAN = 5;
/** The length a context sentence is best at: long enough to say something, short enough to read at a glance. */
export const CONTEXT_IDEAL_HAN = 9;
/** A rescued word's hook stays on its cards until this many Goods in a row after the rescue. */
export const RESCUE_CLEAR = 2;

/**
 * One queue out of three, each already in its own order. `position` is how
 * many cards the session has dealt so far, so the mix carries on from batch to
 * batch instead of starting over.
 */
export function interleave<T>(lists: { word: T[]; sentence: T[]; new: T[] }, position: number, limit: number): T[] {
  const at = { word: 0, sentence: 0, new: 0 };
  const out: T[] = [];
  for (let step = position; out.length < limit; step++) {
    let dealt = false;
    // The kind whose turn it is, or the next one that still has cards.
    for (let k = 0; k < CYCLE.length && !dealt; k++) {
      const kind = CYCLE[(step + k) % CYCLE.length];
      if (at[kind] < lists[kind].length) {
        out.push(lists[kind][at[kind]++]);
        dealt = true;
      }
    }
    if (!dealt) break;
  }
  return out;
}
