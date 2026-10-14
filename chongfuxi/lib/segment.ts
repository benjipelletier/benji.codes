// Splitting a sentence card into words.
//
// The sentence decks already mark word breaks: their pinyin puts a space before
// each new word ("ke1@xue2 @he2 @ji4@shu4" is 科学 和 技术), so the first choice
// is to read the words straight off it. That pinyin can't be trusted blindly —
// in the 18k deck a few hundred cards carry the pinyin of a different sentence,
// shifted rows from however the deck was built — so it is only used when it has
// one syllable per character and those syllables are readings the characters
// actually have. Otherwise the sentence is split by forward maximum matching
// against every word the backup knows about.

import { isHan, toneless, normaliseWord } from "./hanzi";

export interface Segmented {
  /** Words in order, Han characters only; punctuation, digits and Latin dropped. */
  words: string[];
  /** Toneless reading per character of each word, when the pinyin was used. */
  readings: Array<string[] | null>;
  source: "pleco" | "dictionary";
}

export interface SegmentContext {
  /** Toneless readings each character is known to have, from the word cards. */
  charReadings: Map<string, Set<string>>;
  /** Every word worth matching when the pinyin can't be used. */
  vocab: Set<string>;
  /** Longest entry in vocab, so matching never looks further than it could hit. */
  maxLen: number;
}

/** Share of checkable characters whose syllable must be one of their readings. */
const MIN_AGREEMENT = 0.8;

/**
 * Words as the card's own pinyin marks them, or null when that pinyin doesn't
 * fit the characters. Needs only charReadings, so it can run before vocab is
 * complete — the corpus uses the words it yields to build vocab.
 */
export function segmentByPinyin(hw: string, pron: string, ctx: Pick<SegmentContext, "charReadings">): Segmented | null {
  const text = hw.replace(/@/g, "");
  const chars = [...text].filter(isHan);
  if (!chars.length || !pron) return null;

  const groups: string[][] = [];
  for (const chunk of pron.split(" ")) {
    const syllables = chunk
      .split("@")
      .map(toneless)
      .filter((s) => s.length > 0);
    if (syllables.length) groups.push(syllables);
  }
  const count = groups.reduce((n, g) => n + g.length, 0);
  if (count !== chars.length) return null;

  let checked = 0;
  let agreed = 0;
  let i = 0;
  for (const g of groups) {
    for (const syl of g) {
      const known = ctx.charReadings.get(chars[i]);
      if (known) {
        checked++;
        // Erhua is written as a bare "r" syllable on 儿.
        if (known.has(syl) || (syl === "r" && chars[i] === "儿")) agreed++;
      }
      i++;
    }
  }
  if (checked && agreed / checked < MIN_AGREEMENT) return null;

  const words: string[] = [];
  const readings: string[][] = [];
  i = 0;
  for (const g of groups) {
    const w = chars.slice(i, i + g.length).join("");
    i += g.length;
    // Erhua given its own "word" (心眼 @儿) is a suffix, not something to learn.
    if (w === "儿" && g[0] === "r") continue;
    words.push(normaliseWord(w, g));
    readings.push(g);
  }
  return { words, readings, source: "pleco" };
}

export function segmentByDictionary(hw: string, ctx: SegmentContext): Segmented {
  const words = byDictionary(hw.replace(/@/g, ""), ctx);
  return { words, readings: words.map(() => null), source: "dictionary" };
}

export function segmentCard(hw: string, pron: string, ctx: SegmentContext): Segmented {
  return segmentByPinyin(hw, pron, ctx) ?? segmentByDictionary(hw, ctx);
}

/** Forward maximum matching over each run of Han characters. */
function byDictionary(text: string, ctx: SegmentContext): string[] {
  const out: string[] = [];
  const runs = text.split(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/).filter(Boolean);
  for (const run of runs) {
    const chars = [...run];
    let i = 0;
    while (i < chars.length) {
      let len = Math.min(ctx.maxLen, chars.length - i);
      for (; len > 1; len--) {
        if (ctx.vocab.has(chars.slice(i, i + len).join(""))) break;
      }
      out.push(chars.slice(i, i + len).join(""));
      i += len;
    }
  }
  return out;
}
