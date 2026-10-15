// The check after the model, for Look up. The model composes an answer from
// blocks (ANSWER_SCHEMA in lookup.ts); nothing in any block is shown as fact
// unless the evidence backs it:
//
// - Every word a block puts forward (a candidate, an entry, a word compared or
//   placed on a scale) must be a CC-CEDICT headword, a pattern of them, or
//   split into at least one real word; one that isn't is kept but marked.
//   Its pinyin and meaning come from our readings code, never from the model.
// - A count must be one a tool returned in this lookup, for that word, a pair
//   with it, or part of it; otherwise it is dropped (a judgment is then shown
//   as the model's own).
// - A sentence cited by id must be one a tool returned; it is shown as stored.
//   Sentences the model wrote are labelled as such.
//
// It also gives blocks a stable order, and turns answers kept in the first
// shape (options) into blocks, so one screen draws both.

import type {
  LookupAnswer,
  LookupAnswerV1,
  LookupBlock,
  LookupJudgment,
  LookupKind,
  LookupPoint,
  LookupSentence,
  LookupSource,
  LookupWord,
} from "@chongfuxi/lib/api";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import type { Seen } from "./lookup-evidence";

type ModelPoint = { point: LookupPoint; says: string; source: LookupSource; count: number };

/** A block as the model gives it: sentences by id (-1 for one it wrote), counts as -1 when it has none. */
export type ModelBlock =
  | { type: "gap"; frame: string; options: Array<{ zh: string; label: string; fits: boolean; why: string }> }
  | { type: "sense"; items: Array<{ zh: string; label: string; why: string; points: ModelPoint[]; examples: number[] }> }
  | { type: "contrast"; words: string[]; rows: Array<{ aspect: string; cells: Array<{ text: string; mark: "yes" | "no" | "none" }> }> }
  | { type: "scale"; left: string; middle: string; right: string; points: Array<{ zh: string; gloss: string; at: number }> }
  | {
      type: "pattern";
      template: string;
      slots: Array<{ name: string; note: string }>;
      fillings: Array<{ id: number; zh: string; en: string; marks: string[] }>;
    }
  | { type: "family"; head: string; rule: string; members: Array<{ zh: string; count: number }> }
  | { type: "wrong-right"; wrong: string; right: string; why: string }
  | { type: "example"; id: number; zh: string; en: string };

/** The answer as the model gives it. */
export interface ModelAnswer {
  reading: { parts: Array<{ text: string; asked: boolean }>; kind: LookupKind; note: string };
  blocks: ModelBlock[];
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

/** Our reading and meaning for a word, and whether the dictionary stands behind it. */
function lookWord(zh: string, deps: CheckDeps): LookupWord {
  const whole = deps.entry(zh);
  const parts = whole ? [zh] : headwordsOf(zh, deps);
  // Nearly every character is a headword on its own, so a phrase only counts
  // as the dictionary's when it is one, when each piece of a pattern (越…越…)
  // is one, or when it splits into at least one real word (打 + 电话).
  const pieces = zh.split(/…+|\.{3}|_{2,}/).map((x) => x.trim()).filter(Boolean);
  const inDictionary =
    Boolean(whole) || (pieces.length > 1 && pieces.every((x) => deps.entry(x))) || Boolean(parts?.some((w) => [...w].length > 1));
  return {
    pinyin: parts ? parts.map((w) => displayPinyin(deps.entry(w)!.p)).join(" ") : null,
    gloss: whole?.gloss ?? null,
    inDictionary,
  };
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

/** Headline blocks first, then entries, the rule, mistakes, and examples last: the same kind of answer looks the same. */
const RANK: Record<LookupBlock["type"], number> = {
  gap: 0,
  contrast: 0,
  scale: 0,
  pattern: 0,
  sense: 1,
  family: 2,
  "wrong-right": 3,
  example: 4,
};
export const orderBlocks = (blocks: LookupBlock[]) =>
  blocks.map((b, i) => ({ b, i })).sort((x, y) => RANK[x.b.type] - RANK[y.b.type] || x.i - y.i).map((x) => x.b);

/** Every sentence id an answer cites, for fetching them before the check. */
export function citedIds(raw: ModelAnswer): number[] {
  const ids: number[] = [];
  for (const b of raw.blocks) {
    if (b.type === "sense") b.items.forEach((it) => ids.push(...it.examples));
    if (b.type === "pattern") b.fillings.forEach((f) => ids.push(f.id));
    if (b.type === "example") ids.push(b.id);
  }
  return [...new Set(ids.filter((id) => id >= 0))];
}

export function checkAnswer(raw: ModelAnswer, seen: Seen, deps: CheckDeps): Omit<LookupAnswer, "query" | "model" | "at" | "usage"> {
  const checks: string[] = [];
  const words: Record<string, LookupWord> = {};
  const word = (zh: string) => {
    const w = zh.trim();
    if (w && !words[w]) {
      words[w] = lookWord(w, deps);
      if (!words[w].inDictionary && HAN.test(w)) checks.push(`${w} is not a CC-CEDICT word, nor made of one.`);
    }
    return w;
  };
  /** A cited sentence, if a tool returned it; otherwise the model's own words, labelled. */
  const sentence = (id: number, zh: string, en: string | null, where: string) => {
    if (id >= 0) {
      const s = seen.sentences.has(id) ? deps.sentences.get(id) : undefined;
      if (s) return { zh: s.zh, en: s.en, mine: true, readable: s.readable };
      checks.push(`${where}: sentence #${id} was not among those found, so it is shown as the model's.`);
    }
    return { zh, en: en || null, mine: false, readable: false };
  };
  const judge = (zh: string, pt: ModelPoint): LookupJudgment => {
    const count = pt.count >= 0 ? pt.count : null;
    let source = pt.source;
    let checked = false;
    if (source === "corpus") {
      checked = count !== null ? countSeen(seen, zh, count) : aboutWord(seen, zh);
      if (!checked) checks.push(`${zh}: "${pt.says}" cites ${count ?? "your sentences"}, which no search returned; shown as the model's own.`);
    } else if (source === "dictionary") {
      checked = words[zh]?.inDictionary ?? false;
      if (!checked) checks.push(`${zh}: "${pt.says}" cites the dictionary, which doesn't have it; shown as the model's own.`);
    } else if (source === "deck") {
      checked = aboutWord(seen, zh);
      if (!checked) checks.push(`${zh}: "${pt.says}" cites the deck without looking it up; shown as the model's own.`);
    }
    if (!checked && source !== "model") source = "model";
    return { point: pt.point, says: pt.says, source, count: checked ? count : null, checked };
  };

  const blocks: LookupBlock[] = [];
  for (const b of raw.blocks) {
    switch (b.type) {
      case "gap": {
        const options = b.options.map((o) => ({ zh: word(o.zh), label: o.label, fits: o.fits, why: o.why })).filter((o) => o.zh);
        if (options.length && b.frame.includes("___")) blocks.push({ type: "gap", frame: b.frame, options });
        else if (options.length) checks.push("A gap phrase came without its ___; left out.");
        break;
      }
      case "sense": {
        const items = b.items
          .map((it) => {
            const zh = word(it.zh);
            const points = it.points.map((p) => judge(zh, p));
            const examples: LookupSentence[] = [];
            for (const id of it.examples) {
              const s = seen.sentences.has(id) ? deps.sentences.get(id) : undefined;
              if (s) examples.push(s);
              else checks.push(`${zh}: example #${id} was not among the sentences found, so it was left out.`);
            }
            const count = points.find((p) => p.source === "corpus" && p.checked && p.count !== null)?.count ?? null;
            return { zh, label: it.label, why: it.why, count, points, examples };
          })
          .filter((it) => it.zh);
        if (items.length) blocks.push({ type: "sense", items });
        break;
      }
      case "contrast": {
        const ws = b.words.map(word).filter(Boolean).slice(0, 3);
        const rows = b.rows.map((r) => ({ aspect: r.aspect, cells: r.cells.slice(0, ws.length) })).filter((r) => r.cells.length === ws.length);
        if (ws.length >= 2 && rows.length) blocks.push({ type: "contrast", words: ws, rows });
        break;
      }
      case "scale": {
        const points = b.points
          .map((p) => ({ zh: word(p.zh), gloss: p.gloss, at: Math.min(1, Math.max(0, Number.isFinite(p.at) ? p.at : 0.5)) }))
          .filter((p) => p.zh)
          .sort((x, y) => x.at - y.at);
        if (points.length >= 2) blocks.push({ type: "scale", left: b.left, middle: b.middle, right: b.right, points });
        break;
      }
      case "pattern": {
        const fillings = b.fillings.map((f) => ({ ...sentence(f.id, f.zh, f.en, "A pattern's filling"), marks: f.marks.filter(Boolean) }));
        if (b.template.trim()) blocks.push({ type: "pattern", template: b.template, slots: b.slots, fillings: fillings.map(({ readable: _r, ...f }) => f) });
        break;
      }
      case "family": {
        const members = b.members
          .filter((m) => m.zh.trim())
          .map((m) => {
            const n = m.count >= 0 ? m.count : null;
            if (n !== null && !countSeen(seen, m.zh, n)) {
              checks.push(`${m.zh}: ${n} in your sentences, which no search returned; the count is left off.`);
              return { zh: m.zh.trim(), count: null };
            }
            return { zh: m.zh.trim(), count: n };
          });
        if (members.length) blocks.push({ type: "family", head: b.head, rule: b.rule, members });
        break;
      }
      case "wrong-right":
        if (b.wrong.trim() && b.right.trim()) blocks.push({ type: "wrong-right", wrong: b.wrong, right: b.right, why: b.why });
        break;
      case "example": {
        const s = sentence(b.id, b.zh, b.en, "An example");
        if (s.zh.trim()) blocks.push({ type: "example", ...s });
        break;
      }
    }
  }

  return { reading: raw.reading, blocks: orderBlocks(blocks), words, summary: raw.summary, checks };
}

/**
 * An answer kept in the first shape (options), as blocks: its gap phrase,
 * its fitting options as senses, its near misses' wrong and right sentences,
 * and the sentences the model wrote.
 */
export function fromV1(a: LookupAnswerV1): LookupAnswer {
  const fits = a.options.filter((o) => o.fits);
  const blocks: LookupBlock[] = [];
  if (a.frame.includes("___")) {
    blocks.push({ type: "gap", frame: a.frame, options: a.options.map((o) => ({ zh: o.zh, label: o.label ?? "", fits: o.fits, why: o.verdict })) });
  }
  if (fits.length) {
    blocks.push({
      type: "sense",
      items: fits.map((o) => ({
        zh: o.zh,
        label: o.label ?? "",
        why: o.verdict,
        count: o.points.find((p) => p.source === "corpus" && p.checked && p.count !== null)?.count ?? null,
        points: o.points,
        examples: o.examples,
      })),
    });
  }
  for (const o of a.options) {
    if (!o.fits && o.wrong && o.right) blocks.push({ type: "wrong-right", wrong: o.wrong, right: o.right, why: o.verdict });
  }
  for (const w of a.written) blocks.push({ type: "example", zh: w.zh, en: w.en, mine: false, readable: false });
  const words: Record<string, LookupWord> = {};
  for (const o of a.options) words[o.zh] = { pinyin: o.pinyin, gloss: o.gloss, inDictionary: o.inDictionary };
  return {
    query: a.query,
    model: a.model,
    at: a.at,
    reading: a.reading,
    blocks: orderBlocks(blocks),
    words,
    summary: a.gist ? `${a.gist} ${a.summary}`.trim() : a.summary,
    checks: a.checks,
    usage: a.usage,
  };
}
