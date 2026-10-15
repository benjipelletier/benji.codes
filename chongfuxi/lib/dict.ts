// Definitions from CC-CEDICT, for the back of a card.
//
// The data is chongfuxi/data/cedict.txt (built by scripts/build-dict.ts): one
// entry per line, exactly as the dictionary has it. What is worth showing is
// decided here. A word usually has several entries — a surname, an old variant
// and the word itself, for 时 — and several senses in each.
//
// Only the server reads the dictionary: definitions are copied onto the word
// rows when a Pleco file is turned into rows, so the browser never loads it.

import { toneless } from "./hanzi";

export interface Definition {
  /** Numbered pinyin, "@" between syllables, as the rest of the app writes it. */
  p: string;
  senses: string[];
  /** The definition typed into the owner's own Pleco card, not a dictionary's. */
  own?: boolean;
}

export interface Dict {
  /** Every entry for a simplified headword, the useful ones first. */
  lookup(word: string): Definition[];
  /** Whether the dictionary has this as a headword at all. */
  has(word: string): boolean;
  /** Every pinyin syllable the dictionary uses, toneless: what a run of pinyin can be cut into. */
  syllables: Set<string>;
  /** The toneless readings each character has, from every entry it appears in. */
  readings: Map<string, Set<string>>;
  /** Headwords of up to this many characters, for splitting text with no word breaks. */
  headwords(maxLength: number): Set<string>;
  size: number;
}

/** "ta1 men5" → "ta1@men5". Marks between syllables of a name (·, ,) are dropped. */
function pinyinOf(source: string): string {
  return source
    .split(/\s+/)
    .filter((s) => /[a-zA-Z]/.test(s))
    .join("@");
}

/** Senses that only point somewhere else, or only name a measure word. */
export const POINTER = /^(?:(?:old |archaic |erhua |Japanese |Taiwan )?variant of |see (?:also )?[^a-z]|CL:|also written |also pr\. |abbr\. for [^a-z])/;

function rank(d: Definition): number {
  // Names and surnames (capitalised pinyin) after the word itself; entries
  // that are nothing but pointers last of all.
  if (!d.senses.length) return 2;
  return /^[A-Z]/.test(d.p) ? 1 : 0;
}

export function parseDict(text: string): Dict {
  const entries = new Map<string, Definition[]>();
  const syllables = new Set<string>();
  const readings = new Map<string, Set<string>>();
  let size = 0;
  for (const line of text.split("\n")) {
    if (!line || line[0] === "#") continue;
    const [simp, , pinyin, senses] = line.split("\t");
    if (!simp || !senses) continue;
    const chars = [...simp];
    const sounds = pinyin.split(/\s+/).map(toneless).filter(Boolean);
    for (const s of sounds) syllables.add(s);
    // One syllable per character is the only case where it is clear whose reading is whose.
    if (sounds.length === chars.length) {
      chars.forEach((ch, i) => {
        const set = readings.get(ch);
        if (set) set.add(sounds[i]);
        else readings.set(ch, new Set([sounds[i]]));
      });
    }
    const kept = senses.split("/").filter((s) => s && !POINTER.test(s));
    const d: Definition = { p: pinyinOf(pinyin), senses: kept };
    const list = entries.get(simp);
    if (list) list.push(d);
    else entries.set(simp, [d]);
    size++;
  }
  return {
    size,
    syllables,
    readings,
    has: (word) => entries.has(word),
    headwords(maxLength) {
      const out = new Set<string>();
      for (const w of entries.keys()) if ([...w].length <= maxLength) out.add(w);
      return out;
    },
    lookup(word) {
      const found = entries.get(word);
      if (!found) return [];
      return found.filter((d) => d.senses.length).sort((a, b) => rank(a) - rank(b));
    },
  };
}

const sameReading = (a: string, b: string) =>
  a.split(/[@ ]+/).map(toneless).filter(Boolean).join(" ") === b.split(/[@ ]+/).map(toneless).filter(Boolean).join(" ");

/** The owner's own definition can be a whole pasted entry; a card wants the start of it. */
const OWN_LIMIT = 280;

/**
 * What a word's card shows: the owner's own definition if their Pleco card had
 * one, then the dictionary's entries, the one read the way the owner's card
 * reads it first.
 */
export function definitionsFor(dict: Dict, word: string, pron: string | null, own: string | null): Definition[] {
  const found = dict.lookup(word);
  const sorted = pron ? [...found.filter((d) => sameReading(d.p, pron)), ...found.filter((d) => !sameReading(d.p, pron))] : found;
  const mine = own?.trim();
  return [
    ...(mine ? [{ p: pron ?? "", senses: [mine.length > OWN_LIMIT ? `${mine.slice(0, OWN_LIMIT).trimEnd()}…` : mine], own: true }] : []),
    ...sorted,
  ];
}

/** Every dictionary sense of a word, lower-cased: how two words are found to share a meaning. */
export function glossesOf(defs: Definition[]): string[] {
  const out = new Set<string>();
  for (const d of defs) {
    if (d.own) continue;
    for (const s of d.senses) out.add(s.toLowerCase());
  }
  return [...out];
}
