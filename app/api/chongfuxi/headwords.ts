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

/** Every entry, by headword: for indexes built over the whole dictionary (synonyms.ts). */
export function allEntries(): ReadonlyMap<string, ReadonlyArray<{ p: string; senses: string }>> {
  if (!entries) load();
  return entries!;
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

/** Every entry of a headword: its reading and senses. Empty when it isn't one. */
export function dictEntries(word: string): Array<{ p: string; senses: string[] }> {
  if (!entries) load();
  return (entries!.get(word) ?? []).map((e) => ({ p: e.p, senses: e.senses.split("/").filter(Boolean) }));
}

/**
 * Headwords whose senses say this English word or phrase, best first: a sense
 * that is exactly it ("to develop"), then one that starts with it, then one
 * that has it as a whole word somewhere. Names and pointer senses are skipped.
 * For "what do I say here": the candidates before the corpus decides.
 */
/** Every English sense, once, and which senses each English word (lower case) is in: englishToChinese's index. */
interface Sense {
  word: string;
  p: string;
  raw: string;
  /** Lower case, brackets and a leading "to " taken off. */
  bare: string;
}
let senses: Sense[] | null = null;
let byToken: Map<string, number[]> | null = null;

function indexSenses() {
  if (!entries) load();
  senses = [];
  byToken = new Map();
  for (const [word, list] of entries!) {
    for (const e of list) {
      if (/^[A-Z]/.test(e.p)) continue;
      for (const raw of e.senses.split("/")) {
        if (!raw || POINTER.test(raw)) continue;
        const i = senses.push({ word, p: e.p, raw, bare: raw.toLowerCase().replace(/\([^)]*\)/g, "").replace(/^to /, "").trim() }) - 1;
        for (const t of new Set(raw.toLowerCase().match(/[a-z0-9]+/g) ?? [])) {
          const at = byToken.get(t);
          if (at) at.push(i);
          else byToken.set(t, [i]);
        }
      }
    }
  }
}

export function englishToChinese(english: string, limit = 40): Array<{ word: string; p: string; sense: string; score: number }> {
  if (!senses) indexSenses();
  const phrase = english.trim().toLowerCase().replace(/\s+/g, " ");
  if (!phrase) return [];
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const whole = new RegExp(`\\b${escaped}`, "i");
  // Every sense that could match starts a word with the phrase's first word
  // ("develop" in "developing"), so only those are scored, not all 200k.
  // A phrase that doesn't start with a letter or digit is scored against all.
  const first = phrase.match(/^[a-z0-9]+/)?.[0];
  let pool: Iterable<number>;
  if (first) {
    const hits = new Set<number>();
    for (const [t, at] of byToken!) if (t.startsWith(first)) for (const i of at) hits.add(i);
    // In dictionary order, as a full pass would meet them, so ties come out the same.
    pool = [...hits].sort((x, y) => x - y);
  } else {
    pool = senses!.keys();
  }
  const best = new Map<string, { word: string; p: string; sense: string; score: number }>();
  for (const i of pool) {
    const { word, p, raw, bare } = senses![i];
    const score = bare === phrase ? 3 : bare.startsWith(phrase) ? 2 : whole.test(raw) ? 1 : 0;
    if (!score) continue;
    const had = best.get(word);
    // Shorter senses say it more squarely: "to develop" over "to develop a film".
    if (!had || score > had.score || (score === had.score && raw.length < had.sense.length)) best.set(word, { word, p, sense: raw, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || [...a.word].length - [...b.word].length).slice(0, limit);
}
