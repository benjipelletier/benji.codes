// Which of a word's definitions to show, where only one has room: the
// prompt of a Recall card, a tile's gloss, a word tapped in a sentence.
//
// A character often has several dictionary entries, one per reading or per
// traditional form it stands for (几 jī "small table" and jǐ "how many"; 咸
// "all" and 鹹 "salty"). The dictionary's order says nothing about which one
// the owner learnt, so the entry is chosen by the word's own reading, then by
// the owner's own Pleco definition. Within it, a sense the sentence on the
// card is about comes first (米 "meter" under 跑完了1000米, 本 "classifier for
// books" under 那本书).
//
// Pure, for the server and the browser alike.

import type { Definition } from "./dict";

/** Pinyin compared as the syllables alone: case and the marks between them aside. */
const bare = (p: string) => p.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Words too common, or too much CC-CEDICT's own shorthand, to say two meanings agree. */
const STOP = new Set(
  "the and for with from that this one sth someone something used form bound etc its his her their are was were not you into out off over such also very more most lit fig has have had who what can will may being been than then them they some any all".split(" "),
);

/** The English words of a text, stemmed a little (books → book, meters → meter), common ones aside. */
function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    if (STOP.has(w)) continue;
    out.add(w.replace(/ies$/, "y").replace(/(es|s)$/, "").replace(/(ing|ed)$/, ""));
  }
  return out;
}

const shares = (text: string, words: Set<string>) => [...wordsOf(text)].some((w) => words.has(w));

/**
 * An entry on the margins of the language: a sound, a classical or old use, a
 * variant, a character only used inside another word. Told by its first
 * sense (冬 "(onom.) beating a drum; rat-a-tat"), or by an old or literary
 * tag anywhere (年 "grain; harvest (old)").
 */
const MARGINAL_FIRST = /^\((onom\.|literary|classical|archaic|old|dialect|Tw)\)|^\(?(old )?variant of |^used in |^Taiwan pr\.|^surname /i;
const MARGINAL_ANY = /\((old|literary|classical|archaic)\)/i;
const marginal = (d: Definition) => MARGINAL_FIRST.test(d.senses[0] ?? "") || d.senses.some((s) => MARGINAL_ANY.test(s));

/**
 * How well an entry fits, by what the word's own record says: read as the
 * word is read (几 jǐ "how many", not jī "small table"); not a name's;
 * sharing a meaning with the owner's own definition (咸 "salty", not "all");
 * not marginal (云 "cloud", not "(classical) to say").
 */
function fit(d: Definition, pinyin: string | null, ownWords: Set<string>): number {
  return (
    (pinyin && bare(d.p) === bare(pinyin) ? 8 : 0) +
    // A capitalised reading is a name's (Xian2 "surname Xian").
    (/^[a-z]/.test(d.p) ? 4 : 0) +
    (d.senses.some((s) => shares(s, ownWords)) ? 2 : 0) +
    (marginal(d) ? 0 : 1)
  );
}

const ownWordsOf = (defs: Definition[]) => wordsOf(defs.filter((d) => d.own).flatMap((d) => d.senses).join(" "));

/**
 * The dictionary entries that fit best, in the order they are stored. More
 * than one when the record can't tell them apart (只 zhī: "grain that has
 * begun to ripen" and "classifier for birds"): the stored order decides,
 * which `orderDefs` on the server sets by the word's sentences.
 */
export function bestEntries(defs: Definition[], pinyin: string | null): Definition[] {
  const dict = defs.filter((d) => !d.own);
  const ownWords = ownWordsOf(defs);
  const top = Math.max(...dict.map((d) => fit(d, pinyin, ownWords)));
  return dict.filter((d) => fit(d, pinyin, ownWords) === top);
}

/**
 * Of entries that fit equally, the one the word's sentences are about: the
 * most translations sharing a word with its first senses. Only a clear
 * winner (three or more, and twice the next), else null.
 */
export function votedEntry(entries: Definition[], translations: string[]): Definition | null {
  const said = translations.map(wordsOf);
  const votes = entries.map((d) => {
    const words = wordsOf(d.senses.slice(0, 3).join(" "));
    return said.filter((t) => [...words].some((w) => t.has(w))).length;
  });
  const order = votes.map((v, i) => i).sort((a, b) => votes[b] - votes[a]);
  const [first, second] = order;
  return votes[first] >= 3 && votes[first] >= 2 * (votes[second] ?? 0) ? entries[first] : null;
}

/** The dictionary entry the word is learnt as; the owner's own definition when the dictionary has nothing. */
export function mainEntry(defs: Definition[], pinyin: string | null): Definition | null {
  if (!defs.some((d) => !d.own)) return defs[0] ?? null;
  return bestEntries(defs, pinyin)[0];
}

/**
 * The first `n` senses of the main entry: those that share a word with
 * `en` (the card's sentence, translated) first, then those the owner's own
 * definition shares a word with.
 */
export function mainSenses(defs: Definition[], pinyin: string | null, opts: { en?: string | null; n?: number } = {}): string[] {
  const senses = mainEntry(defs, pinyin)?.senses ?? [];
  const ownWords = ownWordsOf(defs);
  const context = opts.en ? wordsOf(opts.en) : null;
  // What the sentence is about first, then what the owner's own definition says (号 "number").
  const weight = (s: string) => (context && shares(s, context) ? 2 : 0) + (shares(s, ownWords) ? 1 : 0);
  return [...senses].sort((a, b) => weight(b) - weight(a)).slice(0, opts.n ?? 3);
}

/** All the entries, the main one first; the rest as the dictionary has them. */
export function mainFirst(defs: Definition[], pinyin: string | null): Definition[] {
  const main = mainEntry(defs, pinyin);
  return main ? [main, ...defs.filter((d) => d !== main)] : defs;
}
