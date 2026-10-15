// CC-CEDICT's headwords and their entries, read once per server instance,
// lazily: the headwords tell a word from part of a compound when picking the
// sentences a word card is shown in (contextFit in chongfuxi/lib/review.ts);
// the entries give a sentence's words a reading and a meaning when the deck
// has none (lib/readings.ts). Lighter than `loadDict`, which ranks and splits
// every entry for an import.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POINTER } from "@chongfuxi/lib/dict";
import type { Looked } from "@chongfuxi/lib/readings";

interface Entry {
  /** Numbered pinyin, "@" between syllables. */
  p: string;
  /** The senses as the file has them, "/" between. */
  senses: string;
}

let headwords: Set<string> | null = null;
let entries: Map<string, Entry[]> | null = null;
/** The reading a word gets when nothing asks for a particular one. */
let readings: Map<string, string> | null = null;

function load() {
  headwords = new Set();
  entries = new Map();
  readings = new Map();
  /** How often a character has a reading inside a longer word. */
  const inWords = new Map<string, number>();
  try {
    const text = readFileSync(join(process.cwd(), "chongfuxi", "data", "cedict.txt"), "utf8");
    // simplified \t traditional \t numbered pinyin, syllables spaced \t senses
    for (const m of text.matchAll(/^([^#\t\n][^\t\n]*)\t[^\t\n]*\t([^\t\n]*)\t([^\n]*)$/gm)) {
      const [, word, pinyin, senses] = m;
      headwords.add(word);
      const syllables = pinyin.trim().split(/\s+/);
      const p = syllables.join("@");
      const list = entries.get(word);
      if (list) list.push({ p, senses });
      else entries.set(word, [{ p, senses }]);
      const had = readings.get(word);
      // The first entry, unless it is a name (Zhong1, Du1) and a later one isn't.
      if (had === undefined || (/^[A-Z]/.test(had) && /^[a-z]/.test(p))) readings.set(word, p);
      const chars = [...word];
      if (chars.length > 1 && chars.length === syllables.length && /^[a-z]/.test(p))
        chars.forEach((ch, i) => inWords.set(ch + syllables[i], (inWords.get(ch + syllables[i]) ?? 0) + 1));
    }
  } catch {
    // Without the dictionary every sentence counts as free-standing, and
    // words the deck doesn't have go without a reading.
  }
  // A character with several readings takes the one most of its words use:
  // the dictionary lists 跑 páo (to paw) before pǎo (to run), and 重 chóng
  // before zhòng.
  for (const [word, list] of entries) {
    if ([...word].length !== 1) continue;
    const ps = [...new Set(list.map((e) => e.p).filter((p) => /^[a-z]/.test(p)))];
    if (ps.length < 2) continue;
    const uses = (p: string) => inWords.get(word + p) ?? 0;
    readings.set(word, ps.reduce((best, p) => (uses(p) > uses(best) ? p : best)));
  }
}

/** Every simplified headword in chongfuxi/data/cedict.txt; empty if the file can't be read. */
export function loadHeadwords(): Set<string> {
  if (!headwords) load();
  return headwords!;
}

/**
 * A headword's reading and first two senses: the entry with the reading
 * asked for, else its usual one (the first entry, a name's last, a lone
 * character's commonest).
 */
export function dictEntry(word: string, want?: string): Looked | undefined {
  if (!entries) load();
  const list = entries!.get(word);
  if (!list) return undefined;
  const p = want && list.some((e) => e.p === want) ? want : readings!.get(word)!;
  const senses = list.filter((e) => e.p === p).flatMap((e) => e.senses.split("/").filter(Boolean));
  const kept = senses.filter((s) => !POINTER.test(s));
  return { p, gloss: (kept.length ? kept : senses).slice(0, 2).join("; ") || null };
}
