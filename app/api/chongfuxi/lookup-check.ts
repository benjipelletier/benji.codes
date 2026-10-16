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
  | { type: "example"; id: number; zh: string; en: string }
  | { type: "parts"; word: string; chars: Array<{ zh: string; gloss: string }>; literal: string }
  | { type: "note"; label: string; title: string; shape: string; text: string };

/** The answer as the model gives it. */
export interface ModelAnswer {
  reading: { parts: Array<{ text: string; asked: boolean }>; kind: LookupKind; note: string };
  blocks: ModelBlock[];
  summary: string;
}

/**
 * The answer as the model handed it in, made into a ModelAnswer: the model
 * fills in the answer tool's input with nothing enforcing its schema (an
 * enforced one compiles to a grammar too large for the API), so every field
 * is taken only when it has the right type, a missing one gets its empty
 * value, a list sent as JSON text is read, and a block of no known type is
 * dropped.
 */
export function normaliseAnswer(input: unknown): ModelAnswer {
  const parsed = (v: unknown): unknown => {
    if (typeof v !== "string" || !/^\s*[[{]/.test(v)) return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  const o = (v: unknown): Record<string, unknown> => {
    const x = parsed(v);
    return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  };
  const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const n = (v: unknown) => {
    const x = typeof v === "string" ? Number(v) : v;
    return typeof x === "number" && Number.isFinite(x) ? Math.round(x) : -1;
  };
  const f = (v: unknown) => {
    const x = typeof v === "string" ? Number(v) : v;
    return typeof x === "number" && Number.isFinite(x) ? x : 0.5;
  };
  const b = (v: unknown) => v === true || v === "true";
  const l = <T>(v: unknown, each: (x: unknown) => T): T[] => {
    const x = parsed(v);
    return Array.isArray(x) ? x.map(each) : [];
  };
  const one = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;

  const POINTS = ["meaning", "pairing", "grammar", "register", "tone", "frequency"] as const;
  const SOURCES = ["corpus", "dictionary", "deck", "model"] as const;
  const KINDS = ["pairing", "meaning", "synonyms", "tone", "pattern", "expression", "reading", "breakdown"] as const;

  const block = (v: unknown): ModelBlock | null => {
    const x = o(v);
    switch (x.type) {
      case "gap":
        return { type: "gap", frame: s(x.frame), options: l(x.options, (y) => ({ zh: s(o(y).zh), label: s(o(y).label), fits: b(o(y).fits), why: s(o(y).why) })) };
      case "sense":
        return {
          type: "sense",
          items: l(x.items, (y) => {
            const i = o(y);
            return {
              zh: s(i.zh),
              label: s(i.label),
              why: s(i.why),
              points: l(i.points, (z) => {
                const p = o(z);
                return { point: one(p.point, POINTS, "meaning"), says: s(p.says), source: one(p.source, SOURCES, "model"), count: n(p.count) };
              }),
              examples: l(i.examples, n),
            };
          }),
        };
      case "contrast":
        return {
          type: "contrast",
          words: l(x.words, s),
          rows: l(x.rows, (y) => ({
            aspect: s(o(y).aspect),
            cells: l(o(y).cells, (z) => ({ text: s(o(z).text), mark: one(o(z).mark, ["yes", "no", "none"] as const, "none") })),
          })),
        };
      case "scale":
        return { type: "scale", left: s(x.left), middle: s(x.middle), right: s(x.right), points: l(x.points, (y) => ({ zh: s(o(y).zh), gloss: s(o(y).gloss), at: f(o(y).at) })) };
      case "pattern":
        return {
          type: "pattern",
          template: s(x.template),
          slots: l(x.slots, (y) => ({ name: s(o(y).name), note: s(o(y).note) })),
          fillings: l(x.fillings, (y) => ({ id: n(o(y).id), zh: s(o(y).zh), en: s(o(y).en), marks: l(o(y).marks, s) })),
        };
      case "family":
        return { type: "family", head: s(x.head), rule: s(x.rule), members: l(x.members, (y) => ({ zh: s(o(y).zh), count: n(o(y).count) })) };
      case "wrong-right":
        return { type: "wrong-right", wrong: s(x.wrong), right: s(x.right), why: s(x.why) };
      case "example":
        return { type: "example", id: n(x.id), zh: s(x.zh), en: s(x.en) };
      case "parts":
        return { type: "parts", word: s(x.word), chars: l(x.chars, (y) => ({ zh: s(o(y).zh), gloss: s(o(y).gloss) })), literal: s(x.literal) };
      case "note":
        return { type: "note", label: s(x.label), title: s(x.title), shape: s(x.shape), text: s(x.text) };
      default:
        return null;
    }
  };

  const a = o(input);
  const r = o(a.reading);
  return {
    reading: { parts: l(r.parts, (y) => ({ text: s(o(y).text), asked: b(o(y).asked) })), kind: one(r.kind, KINDS, "meaning"), note: s(r.note) },
    blocks: l(a.blocks, block).filter((x): x is ModelBlock => x !== null),
    summary: s(a.summary),
  };
}

/**
 * What to look for in the owner's sentences to test a warning: where the
 * wrong version differs from the right one, with a character either side
 * (哪个站 against 哪个车站: 个站; 发展抑郁症 against 得了抑郁症: 发展抑). Of
 * several right versions ("得了抑郁症 / 患上抑郁症") the closest is used.
 * Null when there is nothing distinctive to look for.
 */
export function mistakeKey(wrong: string, right: string): string | null {
  const han = (x: string) => [...x.replace(/[^\u3400-\u9fff]/g, "")];
  const w = han(wrong);
  if (w.length < 2) return null;
  let best: string | null = null;
  let bestShared = -1;
  for (const alt of right.split(/[/／|｜;；]|\bor\b/)) {
    const r = han(alt);
    if (!r.length || r.join("") === w.join("")) continue;
    let p = 0;
    while (p < w.length && p < r.length && w[p] === r[p]) p++;
    let s = 0;
    while (s < w.length - p && s < r.length - p && w[w.length - 1 - s] === r[r.length - 1 - s]) s++;
    const from = Math.max(0, p - 1);
    const to = Math.min(w.length, w.length - s + 1);
    let key = w.slice(from, to);
    // Too short to mean anything: widen to the whole wrong version.
    if (key.length < 2) key = w;
    if (p + s > bestShared) {
      bestShared = p + s;
      best = key.join("");
    }
  }
  return best;
}

export interface CheckDeps {
  /** A headword's usual reading and short meaning, or undefined when it isn't one. */
  entry(word: string): { p: string; gloss: string | null } | undefined;
  /** The owner's sentences the answer cites, fetched by id, with their words in order when known. */
  sentences: Map<number, LookupSentence & { words?: string[] }>;
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
    ...(!whole && parts && parts.length > 1 ? { parts } : {}),
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
  parts: 0,
  // A side point: after the answer and its rule, before the mistakes.
  note: 2.5,
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
      // A phrase's words get their own entries: each can be in the deck or added.
      for (const part of words[w].parts ?? []) words[part] ??= lookWord(part, deps);
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
              if (!s) {
                checks.push(`${zh}: example #${id} was not among the sentences found, so it was left out.`);
                continue;
              }
              const { words, ...sentence } = s;
              // Only inside a longer word here (县 in 县城): said, since a card wouldn't count it.
              const within = words && !words.includes(zh) ? (words.find((w) => w.includes(zh)) ?? null) : null;
              examples.push({ ...sentence, within });
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
      case "note": {
        // One, saying something. A title only when it is Chinese; a shape only
        // when it is Chinese with one part in braces; a short label, or a plain one.
        const text = b.text.trim();
        if (!text) break;
        if (blocks.some((x) => x.type === "note")) {
          checks.push(`A second note (${b.label.trim() || text.slice(0, 30)}) left out.`);
          break;
        }
        const title = HAN.test(b.title) ? b.title.trim() : "";
        const shape = /^[^{}]*\{[^{}]+\}[^{}]*$/.test(b.shape.trim()) && HAN.test(b.shape) ? b.shape.trim() : "";
        const label = b.label.trim();
        blocks.push({ type: "note", label: label && label.length <= 40 ? label : "Worth knowing", title, shape, text });
        break;
      }
      case "parts": {
        // Only the word's own characters, in its order, each once; each read
        // as the word reads it (着 zhuó in 不着痕迹), from our dictionary.
        const w = b.word.trim();
        const chars = [...w];
        if (!HAN.test(w) || chars.length < 2) break;
        word(w);
        const reading = deps.entry(w)?.p.split("@") ?? [];
        const said = new Map(b.chars.map((c) => [c.zh.trim(), c.gloss]));
        const parts = chars.map((ch, i) => {
          const p = reading.length === chars.length ? reading[i] : deps.entry(ch)?.p;
          return { zh: ch, pinyin: p ? displayPinyin(p) : null, gloss: said.get(ch) ?? "", also: [] as string[] };
        });
        const stray = b.chars.map((c) => c.zh.trim()).filter((c) => c && !chars.includes(c));
        if (stray.length) checks.push(`${w}: ${stray.join(" ")} isn't one of its characters; left out.`);
        if (parts.some((p) => p.gloss)) blocks.push({ type: "parts", word: w, chars: parts, literal: b.literal });
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
            word(m.zh);
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
