// English keys: what links words with the same English (经历 and 经验 by
// "experience"). Each CC-CEDICT sense is cut into keys: "to experience; to
// undergo" gives experience and undergo. The owner asked for every word to be
// tied to the others sharing an English entry, and a page to explore how they
// differ (app/api/chongfuxi/synonyms.ts, components/Synonyms.tsx). Pure.

/** A key, and how early in its word's entry the sense giving it comes (0 first). */
export interface SenseKey {
  key: string;
  rank: number;
  sense: string;
}

/** Bumped when the cutting changes, so the stored keys are made again. */
export const KEY_VERSION = 1;
/** A key shared by more words than this says nothing about them (to be, thing, kind) and makes no group. */
export const MAX_GROUP = 40;
/** Pieces longer than this many English words are a phrase, not a meaning to share. */
const MAX_KEY_WORDS = 3;

/** Senses that only point elsewhere or name a function: no meaning to share. */
const SKIP = /^(see |used in|classifier for|surname |abbr\. |also written|also pr\.|taiwan pr\.|cl:|\(old\)|\(bound form\) used in)|variant of/i;
/** A preposition ending a phrase is dropped, so "become aware of" meets "become aware" and "experience for (oneself)" meets "experience". */
const TRAILING = / (of|for|to|with|on|in|at|about|from|into|upon)$/;
const STOP = new Set(["be", "do", "make", "have", "get", "go", "come", "one", "thing", "person", "people", "kind", "way", "time", "sb", "sth", "etc", "it", "this", "that"]);

/** A piece of a sense as a key: "to be careful" → careful, "experiences" → experience. */
export function keyOf(piece: string): string | null {
  let k = piece
    .toLowerCase()
    .replace(/\bcl:.*$/, " ")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\b(sb|sth|one's|oneself|sb's|sth's)\b/g, " ")
    .replace(/[^a-z' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(to be|to|a|an|the|be) /, "")
    .replace(/^(to be|to|a|an|the) /, "")
    .trim()
    .replace(TRAILING, "");
  if (!k || STOP.has(k)) return null;
  const words = k.split(" ");
  if (words.length > MAX_KEY_WORDS) return null;
  // A light stem on the last word, so plurals meet their singular.
  const last = words[words.length - 1];
  const stem = last.endsWith("ies") && last.length > 4 ? `${last.slice(0, -3)}y` : /[^su]s$/.test(last) && last.length > 3 && !/(ss|us|is|ics)$/.test(last) ? last.slice(0, -1) : last;
  words[words.length - 1] = stem;
  k = words.join(" ");
  return k.length >= 2 ? k : null;
}

/** The keys of a word's senses, in its entry's order, each once at its earliest. */
export function senseKeys(senses: string[]): SenseKey[] {
  const out = new Map<string, SenseKey>();
  senses.forEach((sense, rank) => {
    if (SKIP.test(sense.trim())) return;
    for (const piece of sense.split(/[;,/]/)) {
      const key = keyOf(piece);
      if (key && !out.has(key)) out.set(key, { key, rank, sense });
    }
  });
  return [...out.values()];
}
