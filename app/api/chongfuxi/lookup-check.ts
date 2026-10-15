// The check after the model, for Look up. Nothing the model says is shown as
// fact unless the evidence backs it:
//
// - Every option must be a CC-CEDICT headword, or made of headwords; one that
//   isn't is kept but marked.
// - Pinyin comes from our readings code, never from the model.
// - A count it cites must be one a tool returned for that word or pair, in
//   this lookup; otherwise the point is shown as the model's own.
// - An example must be one of the owner's sentences a tool returned, by id;
//   any other is dropped. Sentences the model wrote are kept apart, labelled.

import type { LookupAnswer, LookupKind, LookupPoint, LookupSentence, LookupSource } from "@chongfuxi/lib/api";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import type { Seen } from "./lookup-evidence";

/** The answer as the model gives it (ANSWER_SCHEMA in lookup.ts). */
export interface ModelAnswer {
  reading: { parts: Array<{ text: string; asked: boolean }>; kind: LookupKind; note: string };
  frame: string;
  senses: Array<{ label: string; words: string[] }>;
  gist: string;
  options: Array<{
    zh: string;
    label: string;
    fits: boolean;
    verdict: string;
    points: Array<{ point: LookupPoint; says: string; source: LookupSource; count: number }>;
    examples: number[];
    wrong: string;
    right: string;
  }>;
  written: Array<{ zh: string; en: string }>;
  summary: string;
}

export interface CheckDeps {
  /** A headword's usual reading and short meaning, or undefined when it isn't one. */
  entry(word: string): { p: string; gloss: string | null } | undefined;
  /** The owner's sentences the answer cites, fetched by id. */
  sentences: Map<number, LookupSentence>;
}

const HAN = /[㐀-鿿]/;

/** Cut a run of characters into headwords, longest first; null when some part isn't one. */
function headwordsOf(text: string, deps: CheckDeps): string[] | null {
  const chars = [...text.replace(/[^㐀-鿿]/g, "")];
  const out: string[] = [];
  for (let i = 0; i < chars.length; ) {
    let found = 0;
    for (let n = Math.min(4, chars.length - i); n > 0; n--) {
      if (deps.entry(chars.slice(i, i + n).join(""))) {
        found = n;
        break;
      }
    }
    if (!found) return null;
    out.push(chars.slice(i, i + found).join(""));
    i += found;
  }
  return out.length ? out : null;
}

/**
 * Whether a tool's count was about this word: the word itself, a pair with it
 * in, or part of it (得 for 得了: the model often counts the verb alone).
 */
const about = (key: string, word: string) => key.split("+").some((part) => part === word || word.includes(part) || part.includes(word));

/** Whether a tool returned this count for something about this word. */
function countSeen(seen: Seen, word: string, n: number): boolean {
  for (const [key, counts] of seen.counts) if (about(key, word) && counts.has(n)) return true;
  return false;
}

const aboutWord = (seen: Seen, word: string) => [...seen.counts.keys()].some((k) => about(k, word));

export function checkAnswer(raw: ModelAnswer, seen: Seen, deps: CheckDeps): Omit<LookupAnswer, "query" | "model" | "at" | "usage"> {
  const checks: string[] = [];
  const options = raw.options.map((o) => {
    const zh = o.zh.trim();
    const whole = deps.entry(zh);
    const parts = whole ? [zh] : headwordsOf(zh, deps);
    // Nearly every character is a headword on its own, so a phrase only counts
    // as the dictionary's when it is one, when each piece of a pattern (越…越…)
    // is one, or when it splits into at least one real word (打 + 电话).
    const pieces = zh.split(/…+|\.{3}|_{2,}/).map((x) => x.trim()).filter(Boolean);
    const inDictionary =
      Boolean(whole) ||
      (pieces.length > 1 && pieces.every((x) => deps.entry(x))) ||
      Boolean(parts?.some((w) => [...w].length > 1));
    if (!inDictionary && HAN.test(zh)) checks.push(`${zh} is not a CC-CEDICT word, nor made of one.`);
    // Our own readings, whenever it can be split at all.
    const pinyin = parts ? parts.map((w) => displayPinyin(deps.entry(w)!.p)).join(" ") : null;

    const points = o.points.map((pt) => {
      const count = pt.count >= 0 ? pt.count : null;
      let source = pt.source;
      let checked = false;
      if (source === "corpus") {
        checked = count !== null ? countSeen(seen, zh, count) : aboutWord(seen, zh);
        if (!checked) checks.push(`${zh}: "${pt.says}" cites ${count ?? "the corpus"}, which no search returned; shown as the model's own.`);
      } else if (source === "dictionary") {
        checked = inDictionary;
        if (!checked) checks.push(`${zh}: "${pt.says}" cites the dictionary, which doesn't have it; shown as the model's own.`);
      } else if (source === "deck") {
        checked = aboutWord(seen, zh);
        if (!checked) checks.push(`${zh}: "${pt.says}" cites the deck without looking it up; shown as the model's own.`);
      }
      if (!checked && source !== "model") source = "model";
      return { point: pt.point, says: pt.says, source, count: checked ? count : null, checked };
    });

    const examples: LookupSentence[] = [];
    for (const id of o.examples) {
      const s = seen.sentences.has(id) ? deps.sentences.get(id) : undefined;
      if (s) examples.push(s);
      else checks.push(`${zh}: example #${id} was not among the sentences found, so it was left out.`);
    }

    return {
      zh,
      label: o.label,
      pinyin,
      gloss: whole?.gloss ?? null,
      inDictionary,
      fits: o.fits,
      verdict: o.verdict,
      points,
      examples,
      wrong: o.wrong,
      right: o.right,
    };
  });

  return {
    reading: raw.reading,
    frame: raw.frame,
    senses: raw.senses,
    gist: raw.gist,
    options,
    written: raw.written,
    summary: raw.summary,
    checks,
  };
}
