// Words that need reviving: a word whose latest result was wrong (a Forgot on
// its Read or Recall card, or a forgotten sentence it was tapped as tripping),
// placed in a category by its recent results (lib/revive.ts: mixed up, can't
// produce, breaks in context, slipping, won't stick, leech), gets a rescue
// aimed at that category, made by the model from everything known about
// it: its answers, what was written after each Forgot, its card notes, the
// sentences it tripped, the lookups about it, the words it is mixed up with,
// and the owner's readable sentences with it. A rescue is a memory kit in
// four parts, the owner's order: a hook (a mnemonic), its characters' real
// etymology, sentences showing it, and the words it is told apart from. The
// hook shows on the word's cards until RESCUE_CLEAR Goods in a row. Nothing here touches a schedule. The owner asked for it, to get words
// out of "forgotten land". Made only when the owner asks (it costs money),
// at Look up's model and effort (never lower).

import Anthropic from "@anthropic-ai/sdk";
import type { Sql } from "./db";
import type { KitNewWord, Rescue, RescueAttempt, RescueContrast, RescueSentence, StuckStory, StuckWord } from "@chongfuxi/lib/api";
import { IN_PLAY } from "@chongfuxi/lib/learn";
import { LEARN_ORDER } from "./learn";
import type { Definition } from "@chongfuxi/lib/dict";
import { zhShown } from "@chongfuxi/lib/hanzi";
import { RESCUE_CLEAR } from "@chongfuxi/lib/review";
import { CATEGORIES, REVIVE, classify, type ReviveCategory, type ReviveEvent } from "@chongfuxi/lib/revive";
import { EFFORT, MODEL, ensureLookupTables, lookupWords } from "./lookup";
import { ACTIVE, WAITING_TO_LEARN, promptSenses, shownPinyin } from "./review";
import { dictEntries, traditionalOf } from "./headwords";
import { SUSPENDED_WORD } from "./suspended";
import { wordPage, wordSentences } from "./wordpage";

export class RescueError extends Error {}

/** Results that count: its word cards' answers, and lapses from being tapped in a forgotten sentence. */
const RESULTS = `r.kind in ('read', 'produce') and r.cause in ('answer', 'tapped')`;
/** Readable sentences with the word shown to the model, to pick the best from. */
const SENTENCES = 12;
/** The owner's sentences kept in a kit, and new ones written for it, at most. */
const OWN_SENTENCES = 3;
const NEW_SENTENCES = 2;
/** Words told apart from it, at most. */
const CONTRASTS = 3;
/** Other deck words with each of its characters, shown to the model. */
const CHAR_WORDS = 6;
/**
 * The rescue's shape. 5: the characters as a tree down to an English
 * sentence, and the hook how they add up (the owner found the etymology
 * cards no use, only the line saying how the characters make the meaning).
 * 4: a memory kit in the owner's order (hook, accurate character etymology,
 * sentences, contrast), the hook going on its cards as soon as it is made. Before: 3, memory handles to pick from; 2 and 1,
 * quizzes, which the owner found added little. A rescue of an older version
 * counts as stale, so opening it makes it again.
 */
export const RESCUE_VERSION = 5;
const MAX_TEXT = 600;

let ready = false;
export async function ensureRescueTable(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_rescue (
      owner_email text not null,
      word text not null,
      at timestamptz not null default now(),
      model text not null,
      evidence jsonb not null,
      rescue jsonb not null,
      done_at timestamptz,
      drill jsonb,
      primary key (owner_email, word)
    )
  `;
  await sql`
    create table if not exists chongfuxi_rescue_story (
      owner_email text primary key,
      at timestamptz not null default now(),
      model text not null,
      words text[] not null,
      story jsonb not null
    )
  `;
  ready = true;
}

/** Results read per word to place it. */
const EVENTS = 15;
/** Votes a word needs to count as the one this word is mixed up with. */
const PARTNER_VOTES = 2;

/**
 * The words that need reviving: every deck word, not suspended, whose latest
 * result was wrong, placed in a category by its recent results
 * (lib/revive.ts), in the categories' order and the worst first. A word is
 * "mixed up" with another when the evidence names one: a lookup about the
 * two of them (2 votes), or each sentence forgotten with both tapped (1).
 * Readable by anyone.
 */
export async function stuckWords(sql: Sql, owner: string, at = Date.now()): Promise<StuckWord[]> {
  await ensureRescueTable(sql);
  const rows = (await sql.query(
    `with ev as (
       select r.word, r.kind, r.cause, r.grade, (extract(epoch from r.at) * 1000)::double precision as at,
              (r.before->>'stability')::double precision as stability,
              row_number() over (partition by r.word order by r.seq desc) as rn,
              count(*) filter (where r.grade = 'forgot') over (partition by r.word) as misses
       from chongfuxi_review r
       where r.owner_email = $1 and ${RESULTS} and r.word is not null
     ),
     wrong as (select word from ev where rn = 1 and grade = 'forgot')
     select e.word, e.kind, e.cause, e.grade, e.at, e.stability, e.misses::int as misses
     from ev e
     join wrong using (word)
     join chongfuxi_word w on w.owner_email = $1 and w.word = e.word and w.status = 'deck' and not ${SUSPENDED_WORD("w")}
     where e.rn <= $2
     order by e.word, e.rn`,
    [owner, EVENTS],
  )) as unknown as Array<ReviveEvent & { word: string; misses: number }>;
  const byWord = new Map<string, { events: ReviveEvent[]; misses: number }>();
  for (const r of rows) {
    const w = byWord.get(r.word) ?? { events: [], misses: r.misses };
    w.events.push({ kind: r.kind, cause: r.cause, grade: r.grade, at: r.at, stability: r.stability });
    byWord.set(r.word, w);
  }
  const candidates = [...byWord.keys()];
  if (!candidates.length) return [];

  // Who each is mixed up with: lookups naming it and one other deck word, and sentences forgotten with both tapped.
  const votes = new Map<string, Map<string, number>>();
  const vote = (word: string, other: string, n: number) => {
    const m = votes.get(word) ?? new Map<string, number>();
    m.set(other, (m.get(other) ?? 0) + n);
    votes.set(word, m);
  };
  await ensureLookupTables(sql);
  const asked = (await sql`
    select l.query, c.word from chongfuxi_lookup l, unnest(${candidates}::text[]) as c(word)
    where l.owner_email = ${owner} and strpos(l.query, c.word) > 0
  `) as unknown as Array<{ query: string; word: string }>;
  const named = await lookupWords(sql, owner, [...new Set(asked.map((a) => a.query))]);
  for (const a of asked) {
    const others = (named.get(a.query) ?? []).filter((w) => w !== a.word && !w.includes(a.word) && !a.word.includes(w));
    if (others.length === 1) vote(a.word, others[0], 2);
  }
  const together = (await sql`
    select c.word, t.w as other, count(*)::int as n
    from chongfuxi_review r, unnest(r.tapped) as t(w), unnest(${candidates}::text[]) as c(word)
    where r.owner_email = ${owner} and r.kind = 'sentence' and r.grade = 'forgot' and r.cause = 'answer'
      and c.word = any(r.tapped) and t.w <> c.word
      and exists (select 1 from chongfuxi_word d where d.owner_email = r.owner_email and d.word = t.w and d.status = 'deck')
    group by c.word, t.w
  `) as unknown as Array<{ word: string; other: string; n: number }>;
  for (const t of together) vote(t.word, t.other, t.n);
  const partnerOf = (word: string) => {
    const best = [...(votes.get(word) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= PARTNER_VOTES ? best[0] : null;
  };

  const placed = candidates.flatMap((word) => {
    const { events, misses } = byWord.get(word)!;
    const partner = partnerOf(word);
    const c = classify(events, misses, partner, at);
    if (!c) return [];
    let streak = 0;
    while (streak < events.length && events[streak].grade === "forgot") streak++;
    const tripped = events.filter((e) => e.cause === "tapped" && at - e.at <= REVIVE.tripDays * 86_400_000).length;
    return [{ word, ...c, partner: c.category === "mixed" ? partner : null, streak, misses, tripped, last: events[0].at }];
  });
  if (!placed.length) return [];

  const info = (await sql.query(
    `select w.word, w.pinyin, w.defs,
            (extract(epoch from x.at) * 1000)::double precision as made, x.done_at is not null as done,
            coalesce((x.rescue->>'version')::int, 1) < ${RESCUE_VERSION} as outdated, x.word is not null as has
     from chongfuxi_word w left join chongfuxi_rescue x on x.owner_email = w.owner_email and x.word = w.word
     where w.owner_email = $1 and w.word = any($2::text[])`,
    [owner, placed.map((p) => p.word)],
  )) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[]; made: number | null; done: boolean; outdated: boolean; has: boolean }>;
  const infoOf = new Map(info.map((i) => [i.word, i]));
  const order = CATEGORIES.map((c) => c.key);
  return placed
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || b.streak - a.streak || b.misses - a.misses || a.word.localeCompare(b.word))
    .map((p) => {
      const i = infoOf.get(p.word)!;
      const pinyin = shownPinyin(i.pinyin, i.defs);
      return {
        word: p.word,
        pinyin,
        gloss: promptSenses(i.defs, pinyin).slice(0, 2).join("; ") || null,
        category: p.category,
        why: p.why,
        partner: p.partner,
        streak: p.streak,
        missed: p.misses,
        tripped: p.tripped,
        rescue: !i.has ? "none" : p.last > (i.made ?? 0) || i.outdated ? "stale" : i.done ? "done" : "ready",
      };
    });
}

/** Everything known about the word, as the model reads it, and the sentences a cloze may use. */
/** What a rescue should aim at, by the word's category. */
const FOCUS: Record<ReviveCategory, (partner: string | null) => string> = {
  mixed: (p) =>
    `It is confused with ${p}. Aim the kit at telling them apart: the hook settles which is which, the sentences show places only it fits, and the first contrast is ${p}.`,
  produce: () =>
    "They recognise it but can't produce it from its meaning. Make the hook lead from the meaning to the characters that say it, and pick sentences where the meaning calls for exactly this word.",
  context: () =>
    "They know it alone but it trips them in sentences: a sense, a collocation or a grammatical use they don't expect. Say in the hook how its characters' sense shows in the use that trips them, and pick and write sentences showing the use that trips them.",
  slipping: () => "They knew it well and it is slipping now. Keep it fresh: a quick, sharp hook and tree; a contrast may be a similar word met lately.",
  stuck: () => "It has never stuck. Build it from the ground up: the hook and tree make plain how each character gives its meaning.",
  leech: () => "It keeps flip-flopping and never settles. Give the hook an angle they won't have tried: what its characters really mean, put plainly.",
};

async function evidenceFor(sql: Sql, owner: string, word: string, place: Pick<StuckWord, "category" | "why" | "partner"> | null) {
  const page = await wordPage(sql, owner, word);
  // Any word with a page: a deck word, one on a list, or one only in the dictionary (asked for from its page).
  if (!page) throw new RescueError(`${word} isn't a word here.`);
  await ensureLookupTables(sql);
  const lookups = page.lookups.length
    ? ((await sql`
        select query, kind, verdict, note, answer->>'summary' as summary from chongfuxi_lookup
        where owner_email = ${owner} and query = any(${page.lookups.map((l) => l.query)}::text[])
      `) as unknown as Array<{ query: string; kind: string | null; verdict: string | null; note: string | null; summary: string | null }>)
    : [];
  // Other words tapped in the sentences it tripped: what it is likely mixed up with, or read alongside.
  const together = (await sql`
    select t.w as word, count(*)::int as n
    from chongfuxi_review r, unnest(r.tapped) as t(w)
    where r.owner_email = ${owner} and r.kind = 'sentence' and r.grade = 'forgot' and r.cause = 'answer'
      and ${word} = any(r.tapped) and t.w <> ${word}
    group by t.w order by n desc, t.w limit 8
  `) as unknown as Array<{ word: string; n: number }>;
  const [before] = (await sql`
    select rescue->>'hook' as hook, drill from chongfuxi_rescue where owner_email = ${owner} and word = ${word}
  `) as unknown as Array<{ hook: string | null; drill: Array<{ i: number; right: boolean }> | null }>;
  const readable = await wordSentences(sql, owner, word, "readable", 0, SENTENCES);
  // Each character: its dictionary entries and traditional forms (facts the etymology must agree
  // with), and the deck words that share it.
  const chars = [...new Set([...word].filter((c) => /\p{Script=Han}/u.test(c)))];
  const sharing = chars.length
    ? ((await sql`
        select c.ch, array_agg(w.word order by length(w.word), w.word) as words
        from unnest(${chars}::text[]) as c(ch)
        join chongfuxi_word w on w.owner_email = ${owner} and w.status = 'deck' and w.word <> ${word} and strpos(w.word, c.ch) > 0
        group by c.ch
      `) as unknown as Array<{ ch: string; words: string[] }>)
    : [];
  const charLines = chars.map((c) => {
    const trad = traditionalOf(c);
    const senses = dictEntries(c)
      .filter((e) => /^[a-z]/.test(e.p))
      .map((e) => `${e.p}: ${e.senses.slice(0, 5).join("; ")}`);
    const words = sharing.find((x) => x.ch === c)?.words.slice(0, CHAR_WORDS) ?? [];
    return `- ${c}${trad.length ? ` (traditional ${trad.join(", ")})` : ""}: ${senses.join(" | ") || "not in the dictionary alone"}${words.length ? `. In their deck also in: ${words.join(", ")}` : ""}`;
  });

  const day = (at: number) => new Date(at).toISOString().slice(0, 10);
  const meanings = page.defs.map((d) => `${d.p ? `${d.p.replace(/@/g, " ")}: ` : ""}${d.senses.join("; ")}${d.own ? " (the owner's own Pleco definition)" : ""}`);
  // The word it is mixed up with: its meanings, for telling them apart.
  const partner = place?.partner
    ? ((await sql`select pinyin, defs from chongfuxi_word where owner_email = ${owner} and word = ${place.partner}`) as unknown as Array<{
        pinyin: string | null;
        defs: Definition[];
      }>)[0]
    : undefined;
  // A word never answered is new: the kit is its first impression, not a rescue.
  const fresh = !place && page.answers.length === 0;
  const lines = [
    ...(fresh
      ? [
          "It is new to them: they are learning it now or about to. Make the kit its first impression: a hook and tree that show from the start how its characters make its meaning, sentences that show its core use plainly, and contrasts with the words it is most likely to be confused with later.",
          "",
        ]
      : []),
    ...(place
      ? [
          `Their trouble with it: ${CATEGORIES.find((c) => c.key === place.category)!.label} (${place.why}).`,
          `Aim the rescue at that: ${FOCUS[place.category](place.partner)}`,
          ...(place.partner && partner
            ? [`${place.partner}${partner.pinyin ? ` (${partner.pinyin.replace(/@/g, " ")})` : ""}: ${partner.defs.flatMap((d) => d.senses).slice(0, 4).join("; ")}`]
            : []),
          "",
        ]
      : []),
    `The word: ${word}${page.pinyin ? ` (${page.pinyin.replace(/@/g, " ")})` : ""}`,
    "Meanings:",
    ...meanings.map((m) => `- ${m}`),
    "",
    "Its answers here, oldest first (Read: see the word, know its meaning; Recall: from the meaning, give the word):",
    ...page.answers.map((a) => `- ${day(a.at)} ${a.kind === "produce" ? "Recall" : "Read"}${a.meaning ? ` (${a.meaning})` : ""}: ${a.grade === "good" ? "Got it" : "Forgot"}`),
    ...(page.notes.length ? ["", "What the owner wrote after forgetting it:", ...page.notes.map((n) => `- ${day(n.at)}: ${n.comment}`)] : []),
    ...(page.cards.some((c) => c.note) ? ["", "Notes on its cards:", ...page.cards.filter((c) => c.note).map((c) => `- ${c.kind === "produce" ? "Recall" : "Read"}: ${c.note}`)] : []),
    ...(page.tripped.length
      ? [
          "",
          "Sentences the owner forgot, tapping this word as the trouble:",
          ...page.tripped.slice(0, 15).map((t) => `- ${zhShown(t.zh)}${t.en ? ` — ${t.en}` : ""}${t.comment ? ` (wrote: ${t.comment})` : ""}`),
        ]
      : []),
    ...(together.length ? ["", "Other words tapped in those same sentences:", together.map((t) => `${t.word} (${t.n})`).join(", ")] : []),
    ...(lookups.length
      ? [
          "",
          "What the owner looked up about it:",
          ...lookups.map(
            (l) =>
              `- "${l.query}"${l.kind ? ` [${l.kind}]` : ""}${l.summary ? `: ${l.summary}` : ""}${l.verdict ? ` (owner marked it ${l.verdict})` : ""}${l.note ? ` (note: ${l.note})` : ""}`,
          ),
        ]
      : []),
    ...(page.sameMeaning.length ? ["", `Deck words with the same meaning: ${page.sameMeaning.join(", ")}`] : []),
    ...(page.compounds.length ? [`Deck words containing it: ${page.compounds.join(", ")}`] : []),
    ...(before?.hook ? ["", `A hook from an earlier rescue, which hasn't held: ${before.hook}`] : []),
    ...(charLines.length ? ["", "Its characters, from CC-CEDICT:", ...charLines] : []),
    ...(readable.length ? ["", "The owner's readable sentences with it, by id:", ...readable.map((s) => `- [${s.id}] ${s.zh}${s.en ? ` — ${s.en}` : ""}`)] : []),
  ];
  return {
    page,
    readable,
    text: lines.join("\n"),
    counts: { missed: page.answers.filter((a) => a.grade === "forgot").length, tripped: page.tripped.length, notes: page.notes.length + page.cards.filter((c) => c.note).length, lookups: lookups.length },
  };
}

const SYSTEM = `You help a learner of Chinese hold on to a word: one they keep getting wrong, or one they are just learning. You are told what kind of trouble it is, or that it is new, and what to aim at; then you are given everything their study app knows about it: its meanings, their answers on its cards, what they wrote after forgetting it, the sentences they forgot because of it, what they looked up, the words it travels with, its characters' dictionary entries, and their own sentences with it.

Make a memory kit of four parts (hook, tree, sentences, contrasts), each short enough to take in at a glance:
- hook: how the word's characters add up to its meaning, one or two short sentences for the back of a flashcard, each character in parentheses after the English it stands for (e.g. for 下定决心: "Put your mind down (下) and fix it (定), cut off (决) the wavering of the heart (心): you make up your mind for good."). Use what each character really means in this word, as the dictionary entries given say; no sound puns, nothing made up. For a one-character word, how its parts give its meaning, as accurately.
- tree: an upside-down tree from the characters down to one plain English sentence. Positions count the word's characters from 0. The first layer has one node per character, in order ({from: i, to: i + 1}), each that character's meaning in this word in two to four English words. Each later layer joins neighbouring nodes of the layer above into fewer nodes, grouping as the word's parts group in Chinese (下定 + 决心: a verb and its object), each node's text a short English phrase saying what those characters mean together, more natural than the parts it joins. The last layer is a single node over the whole word: one plain, natural English sentence saying what the word means (e.g. "To firmly make up your mind."). Two to four layers in all (a two-character word: its characters, then the sentence; a one-character word: one layer, its meaning as a sentence).
- sentences: mine: up to ${OWN_SENTENCES} of the owner's sentences (by id, only from those given) that show the word best, plainest first, each with a note of a few words on what the word does there. new: ${NEW_SENTENCES} short new sentences in simple Chinese (HSK 1–4 apart from the word) using it in its main sense, the meaning clear from the sentence, each with English and such a note.
- contrasts: 1 to ${CONTRASTS} words it is mixed up with or easily could be: first those the evidence shows, then words of the same meaning, then look-alikes or sound-alikes. Each with its pinyin (tone marks), the difference in one sentence, and two short sentences as alike as can be, mine with the word and theirs with the other word, so the difference shows, each with English.
Write in English, with Chinese only for Chinese words.`;

const SENTENCE_ITEM = {
  type: "object",
  properties: { zh: { type: "string" }, en: { type: "string" } },
  required: ["zh", "en"],
  additionalProperties: false,
} as const;

const SCHEMA = {
  type: "object",
  properties: {
    hook: { type: "string" },
    tree: {
      type: "array",
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { from: { type: "integer" }, to: { type: "integer" }, text: { type: "string" } },
          required: ["from", "to", "text"],
          additionalProperties: false,
        },
      },
    },
    sentences: {
      type: "object",
      properties: {
        mine: {
          type: "array",
          items: { type: "object", properties: { id: { type: "integer" }, note: { type: "string" } }, required: ["id", "note"], additionalProperties: false },
        },
        new: {
          type: "array",
          items: {
            type: "object",
            properties: { zh: { type: "string" }, en: { type: "string" }, note: { type: "string" } },
            required: ["zh", "en", "note"],
            additionalProperties: false,
          },
        },
      },
      required: ["mine", "new"],
      additionalProperties: false,
    },
    contrasts: {
      type: "array",
      items: {
        type: "object",
        properties: { zh: { type: "string" }, pinyin: { type: "string" }, difference: { type: "string" }, mine: SENTENCE_ITEM, theirs: SENTENCE_ITEM },
        required: ["zh", "pinyin", "difference", "mine", "theirs"],
        additionalProperties: false,
      },
    },
  },
  required: ["hook", "tree", "sentences", "contrasts"],
  additionalProperties: false,
} as const;

const clip = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT) : "");

/** What a kit is checked against: the word, its reading, and the owner's sentences it was shown. */
export interface KitFacts {
  word: string;
  /** Numbered pinyin, "@" between syllables, or null. */
  pinyin: string | null;
  sentences: ReadonlyArray<{ id: number; zh: string; en: string | null }>;
  /** Its short meaning: the tree's last line when the model's doesn't hold. */
  gloss?: string | null;
}

/** Layers in a tree, at most: its characters, up to two of phrases, the sentence. */
const TREE_LAYERS = 4;

/**
 * The tree, kept to what holds: the first layer one node per character, in
 * order; each later layer splitting the word into fewer runs, each a join of
 * runs above (a layer that doesn't is dropped); the last a single node over
 * the whole word, else one made from the word's gloss. Empty when the first
 * layer is wrong.
 */
export function checkTree(raw: unknown, n: number, gloss?: string | null): Rescue["tree"] {
  const layers = (Array.isArray(raw) ? raw : []).map((l) =>
    (Array.isArray(l) ? l : [])
      .map((x) => x as Record<string, unknown>)
      .map((x) => ({ from: Number(x.from), to: Number(x.to), text: clip(x.text) }))
      .filter((x) => Number.isInteger(x.from) && Number.isInteger(x.to) && x.text)
      .sort((a, b) => a.from - b.from),
  );
  const first = layers[0];
  if (!n || !first || first.length !== n || first.some((x, i) => x.from !== i || x.to !== i + 1)) return [];
  const out = [first];
  for (const layer of layers.slice(1)) {
    const above = out[out.length - 1];
    const cuts = new Set(above.map((x) => x.from));
    const covers = layer.length > 0 && layer[0].from === 0 && layer[layer.length - 1].to === n && layer.every((x, i) => x.from < x.to && (i === 0 || layer[i - 1].to === x.from));
    if (covers && layer.length < above.length && layer.every((x) => cuts.has(x.from))) out.push(layer);
    if (out.length === TREE_LAYERS) break;
  }
  const last = out[out.length - 1];
  if (last.length !== 1) {
    const text = clip(gloss);
    if (!text) return out.length > 1 || n === 1 ? out : [];
    if (out.length === TREE_LAYERS) out.pop();
    out.push([{ from: 0, to: n, text: text[0].toUpperCase() + text.slice(1) }]);
  }
  return out;
}

/**
 * The model's kit, kept to what holds: a hook; every character of the word,
 * in order, its traditional forms and reading from the dictionary and the
 * deck rather than the model; the owner's sentences only by the ids given,
 * their text from the store; new sentences and contrast pairs only when they
 * hold the word they are for.
 */
export function checkRescue(raw: unknown, facts: KitFacts): Pick<Rescue, "hook" | "tree" | "sentences" | "contrasts"> & { version: number } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const hook = clip(r.hook);
  if (!hook) throw new RescueError("The rescue came back without a hook.");

  const word = facts.word;
  const tree = checkTree(r.tree, [...word].length, facts.gloss);
  if (!tree.length) throw new RescueError(`The kit's tree for ${word} came back broken.`);

  const s = (r.sentences ?? {}) as Record<string, unknown>;
  const sentences: RescueSentence[] = [];
  for (const m of Array.isArray(s.mine) ? s.mine : []) {
    const x = m as Record<string, unknown>;
    const found = facts.sentences.find((f) => f.id === x.id);
    if (found && found.zh.includes(word) && !sentences.some((o) => o.id === found.id) && sentences.length < OWN_SENTENCES)
      sentences.push({ zh: found.zh, en: found.en, note: clip(x.note), id: found.id });
  }
  let added = 0;
  for (const n of Array.isArray(s.new) ? s.new : []) {
    const x = n as Record<string, unknown>;
    const zh = clip(x.zh);
    if (zh.includes(word) && added < NEW_SENTENCES && !sentences.some((o) => o.zh === zh)) {
      sentences.push({ zh, en: clip(x.en) || null, note: clip(x.note), id: null });
      added++;
    }
  }
  if (!sentences.length) throw new RescueError("The rescue came back with no sentences using the word.");

  const contrasts: RescueContrast[] = [];
  for (const c of Array.isArray(r.contrasts) ? r.contrasts : []) {
    const x = c as Record<string, unknown>;
    const zh = clip(x.zh);
    const difference = clip(x.difference);
    if (!zh || zh === word || !difference || contrasts.some((o) => o.zh === zh) || contrasts.length >= CONTRASTS) continue;
    const mine = (x.mine ?? {}) as Record<string, unknown>;
    const theirs = (x.theirs ?? {}) as Record<string, unknown>;
    const pair =
      clip(mine.zh).includes(word) && clip(theirs.zh).includes(zh)
        ? { mine: { zh: clip(mine.zh), en: clip(mine.en) }, theirs: { zh: clip(theirs.zh), en: clip(theirs.en) } }
        : null;
    contrasts.push({ zh, pinyin: clip(x.pinyin), difference, pair });
  }

  return { hook, tree, sentences, contrasts, version: RESCUE_VERSION };
}

type Row = {
  word: string;
  at: number;
  model: string;
  evidence: Rescue["evidence"];
  rescue: Pick<Rescue, "hook"> &
    Partial<Pick<Rescue, "tree" | "sentences" | "contrasts" | "attempts">> & {
      /** Before attempts were kept: the one sentence checked. */
      own?: { zh: string; ok: boolean; fixed: string; note: string; en: string };
    };
  done_at: number | null;
  stale: boolean;
  outdated: boolean;
  pinyin: string | null;
  defs: Definition[] | null;
};

async function savedRescue(sql: Sql, owner: string, word: string): Promise<Rescue | null> {
  await ensureRescueTable(sql);
  const [row] = (await sql.query(
    `select x.word, (extract(epoch from x.at) * 1000)::double precision as at, x.model, x.evidence, x.rescue,
            (extract(epoch from x.done_at) * 1000)::double precision as done_at,
            (coalesce((x.rescue->>'version')::int, 1) < ${RESCUE_VERSION}
             or exists (select 1 from chongfuxi_review r where r.owner_email = x.owner_email and r.word = x.word
                        and ${RESULTS} and r.grade = 'forgot' and r.at > x.at)) as stale,
            coalesce((x.rescue->>'version')::int, 1) < ${RESCUE_VERSION} as outdated,
            w.pinyin, w.defs
     from chongfuxi_rescue x left join chongfuxi_word w on w.owner_email = x.owner_email and w.word = x.word
     where x.owner_email = $1 and x.word = $2`,
    [owner, word],
  )) as unknown as Row[];
  if (!row) return null;
  // A word with no row (asked for from its page: only in sentences or the dictionary) takes the dictionary's.
  const defs: Definition[] = row.defs ?? dictEntries(word).map((e) => ({ p: e.p, senses: e.senses }));
  const p = shownPinyin(row.pinyin, defs);
  return {
    word: row.word,
    pinyin: p,
    gloss: promptSenses(defs, p).slice(0, 2).join("; ") || null,
    at: Math.round(row.at),
    model: row.model,
    hook: row.rescue.hook,
    tree: row.rescue.tree ?? [],
    sentences: row.rescue.sentences ?? [],
    contrasts: row.rescue.contrasts ?? [],
    attempts:
      row.rescue.attempts ??
      (row.rescue.own
        ? [{ zh: row.rescue.own.zh, grade: row.rescue.own.ok ? "correct" : "almost", fixed: row.rescue.own.fixed, why: row.rescue.own.note, en: row.rescue.own.en, at: Math.round(row.at) }]
        : []),
    evidence: row.evidence,
    doneAt: row.done_at === null ? null : Math.round(row.done_at),
    stale: row.stale,
    outdated: row.outdated,
  };
}

/** The rescue already made for the word, or null. Readable by anyone. */
export const rescueOf = savedRescue;

/** Make the word's rescue, or give back the one made, unless it is stale or `fresh` is asked for. Owner only. */
export async function makeRescue(sql: Sql, owner: string, word: string, fresh = false): Promise<Rescue> {
  const kept = await savedRescue(sql, owner, word);
  if (kept && !kept.stale && !fresh) return kept;

  const apiKey = process.env.CHONGFUXI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RescueError("No Anthropic API key is set (CHONGFUXI_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY).");
  // Where it stands now, for what the rescue should aim at (null if its latest result was right).
  const place = (await stuckWords(sql, owner)).find((w) => w.word === word) ?? null;
  const evidence = await evidenceFor(sql, owner, word, place);

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: evidence.text }],
  });
  const text = message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  let given: unknown;
  try {
    given = JSON.parse(text);
  } catch {
    throw new RescueError(message.stop_reason === "refusal" ? "The model declined." : "The rescue came back malformed.");
  }
  const gloss = evidence.page.defs[0]?.senses.slice(0, 2).join("; ") ?? null;
  const rescue = { ...checkRescue(given, { word, pinyin: evidence.page.pinyin, sentences: evidence.readable, gloss }), category: place?.category ?? null, partner: place?.partner ?? null };
  await sql`
    insert into chongfuxi_rescue (owner_email, word, at, model, evidence, rescue, done_at, drill)
    values (${owner}, ${word}, now(), ${MODEL}, ${JSON.stringify(evidence.counts)}::jsonb, ${JSON.stringify(rescue)}::jsonb, now(), null)
    on conflict (owner_email, word) do update set
      at = now(), model = excluded.model, evidence = excluded.evidence, rescue = excluded.rescue, done_at = now()
  `;
  console.log("rescue", JSON.stringify({ word, sentences: rescue.sentences.length, contrasts: rescue.contrasts.length, usage: message.usage }));
  return (await savedRescue(sql, owner, word))!;
}

const OWN_SYSTEM = `A learner of Chinese wrote a sentence using a word they are learning, to practise it. Grade it as a careful teacher would.
- grade: "correct" when it is grammatical, natural and uses the word in a right sense (small slips of punctuation don't count); "almost" when it is understandable and uses the word rightly but has a small error or sounds unnatural (a measure word, word order, a particle, a collocation); "wrong" when the word is used in a wrong sense or a wrong way, or the sentence is ungrammatical.
- fixed: the sentence as a native speaker would write it, changing as little as possible (the same sentence when correct), still using the word.
- why: when not correct, one to three short sentences in English naming exactly what is wrong and why, with the Chinese involved, so they won't make the mistake again; when correct, one short sentence on what makes the word fit here.
- en: a natural English translation of fixed.`;

const OWN_SCHEMA = {
  type: "object",
  properties: {
    grade: { type: "string", enum: ["correct", "almost", "wrong"] },
    fixed: { type: "string" },
    why: { type: "string" },
    en: { type: "string" },
  },
  required: ["grade", "fixed", "why", "en"],
  additionalProperties: false,
} as const;

/** Attempts kept with a kit, newest first. */
const ATTEMPTS = 20;

/**
 * The owner's own sentence with the word, graded by the model (correct,
 * almost, wrong) with why, and kept with the kit's earlier attempts. Owner only.
 */
export async function checkOwnSentence(sql: Sql, owner: string, word: string, zh: string): Promise<Rescue> {
  const sentence = zh.trim().slice(0, 200);
  if (!sentence.includes(word)) throw new RescueError(`Use ${word} in it.`);
  const r = await savedRescue(sql, owner, word);
  if (!r) throw new RescueError(`${word} has no memory kit yet.`);
  const apiKey = process.env.CHONGFUXI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RescueError("No Anthropic API key is set (CHONGFUXI_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY).");
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: OWN_SYSTEM,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: OWN_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: `The word: ${word}${r.pinyin ? ` (${r.pinyin.replace(/@/g, " ")})` : ""}${r.gloss ? `: ${r.gloss}` : ""}\nTheir sentence: ${sentence}` }],
  });
  const text = message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  let given: Record<string, unknown>;
  try {
    given = JSON.parse(text);
  } catch {
    throw new RescueError(message.stop_reason === "refusal" ? "The model declined." : "The check came back malformed.");
  }
  const attempt = checkAttempt(given, word, sentence, Date.now());
  const attempts = [attempt, ...r.attempts].slice(0, ATTEMPTS);
  await sql`
    update chongfuxi_rescue set rescue = rescue || ${JSON.stringify({ attempts })}::jsonb
    where owner_email = ${owner} and word = ${word}
  `;
  console.log("rescue attempt", JSON.stringify({ word, grade: attempt.grade, usage: message.usage }));
  return (await savedRescue(sql, owner, word))!;
}

/** The model's grade, kept to what holds: a known grade, a fix that still has the word (else theirs). */
export function checkAttempt(given: Record<string, unknown>, word: string, zh: string, at: number): RescueAttempt {
  const grade = given.grade === "correct" || given.grade === "almost" || given.grade === "wrong" ? given.grade : "almost";
  const fixed = clip(given.fixed);
  return { zh, grade, fixed: fixed.includes(word) ? fixed : zh, why: clip(given.why), en: clip(given.en), at };
}

/**
 * The words on the Learn ladder next (the IN_PLAY it takes first: those part
 * way up, then the next to meet), for Memory kits' New words, each with
 * whether it has a kit. Readable by anyone.
 */
export async function newWords(sql: Sql, owner: string): Promise<KitNewWord[]> {
  await ensureRescueTable(sql);
  const rows = (await sql.query(
    `select c.word, w.pinyin, w.defs, c.learn_step as step,
            case when x.word is null then 'none'
                 when coalesce((x.rescue->>'version')::int, 1) < ${RESCUE_VERSION} then 'stale'
                 else 'done' end as kit
     from chongfuxi_card c
     join chongfuxi_word w on w.owner_email = c.owner_email and w.word = c.word and w.status = 'deck'
     left join chongfuxi_rescue x on x.owner_email = c.owner_email and x.word = c.word
     where c.owner_email = $1 and ${ACTIVE} and ${WAITING_TO_LEARN}
     order by ${LEARN_ORDER}
     limit $2`,
    [owner, IN_PLAY],
  )) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[]; step: string | null; kit: KitNewWord["kit"] }>;
  return rows.map((r) => {
    const pinyin = shownPinyin(r.pinyin, r.defs);
    return { word: r.word, pinyin, gloss: promptSenses(r.defs, pinyin).slice(0, 2).join("; ") || null, step: r.step, kit: r.kit };
  });
}

/** The words the speed round and the story go through: the stuck ones (longest streaks first), then the new ones. */
async function kitWords(sql: Sql, owner: string, stuckMax = Infinity): Promise<Array<{ word: string; pinyin: string | null; gloss: string | null }>> {
  const [stuck, fresh] = await Promise.all([stuckWords(sql, owner), newWords(sql, owner)]);
  const out = stuck.slice(0, stuckMax).map((w) => ({ word: w.word, pinyin: w.pinyin, gloss: w.gloss }));
  for (const w of fresh) if (!out.some((o) => o.word === w.word)) out.push({ word: w.word, pinyin: w.pinyin, gloss: w.gloss });
  return out;
}

/**
 * The speed round's cards: every word to revive and every new word on the
 * Learn ladder, with its kit's hook, none for a word without a kit. Nothing
 * here touches a schedule. Readable by anyone.
 */
export async function speedWords(sql: Sql, owner: string): Promise<Array<{ word: string; pinyin: string | null; gloss: string | null; hook: string | null }>> {
  const words = await kitWords(sql, owner);
  if (!words.length) return [];
  const hooks = (await sql`
    select word, rescue->>'hook' as hook from chongfuxi_rescue where owner_email = ${owner} and word = any(${words.map((w) => w.word)}::text[])
  `) as unknown as Array<{ word: string; hook: string | null }>;
  const hookOf = new Map(hooks.map((h) => [h.word, h.hook]));
  return words.map((w) => ({ word: w.word, pinyin: w.pinyin, gloss: w.gloss, hook: hookOf.get(w.word) ?? null }));
}

/**
 * The hooks of rescued words still recovering: made (done_at), and not yet
 * followed by RESCUE_CLEAR Goods in a row. For the backs of their cards.
 */
export async function rescueHooks(sql: Sql, owner: string, words: string[]): Promise<Map<string, string>> {
  if (!words.length) return new Map();
  await ensureRescueTable(sql);
  const rows = (await sql.query(
    `select x.word, x.rescue->>'hook' as hook
     from chongfuxi_rescue x
     where x.owner_email = $1 and x.word = any($2::text[]) and x.done_at is not null
       and not coalesce((
         select count(*) = $3 and bool_and(grade = 'good')
         from (select r.grade from chongfuxi_review r
               where r.owner_email = x.owner_email and r.word = x.word and ${RESULTS} and r.at > x.done_at
               order by r.seq desc limit $3) last
       ), false)`,
    [owner, words, RESCUE_CLEAR],
  )) as unknown as Array<{ word: string; hook: string | null }>;
  return new Map(rows.filter((r) => r.hook).map((r) => [r.word, r.hook!]));
}

// ------------------------------------------------------------------ story --

/** Stuck words a story is written around, the longest streaks first; the new words on the Learn ladder go in too. */
const STORY_WORDS = 15;

const STORY_SYSTEM = `You write a short story in simplified Chinese for a learner, to help them remember words they keep forgetting or are just learning. Use every one of the given words, each in a sentence where its meaning is clear from what happens (not just mentioned), in the sense given. Everything else in the story should be simple, common vocabulary (HSK 1–4), so the given words stand out. Exactly two paragraphs, each four to seven sentences, telling one connected story with a little humour or tension. Give a short Chinese title, and for each paragraph a natural English translation. Write the words exactly as given, with no spaces or pinyin in the Chinese.`;

const STORY_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        properties: { zh: { type: "string" }, en: { type: "string" } },
        required: ["zh", "en"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "paragraphs"],
  additionalProperties: false,
} as const;

/** The story last written, or null; stale once the stuck words aren't the ones it was written for. */
export async function storyOf(sql: Sql, owner: string): Promise<StuckStory | null> {
  await ensureRescueTable(sql);
  const [row] = (await sql`
    select (extract(epoch from at) * 1000)::double precision as at, model, words, story
    from chongfuxi_rescue_story where owner_email = ${owner}
  `) as unknown as Array<{ at: number; model: string; words: string[]; story: { title: string; paragraphs: Array<{ zh: string; en: string }> } }>;
  if (!row) return null;
  const now = (await kitWords(sql, owner, STORY_WORDS)).map((w) => w.word);
  const text = row.story.paragraphs.map((p) => p.zh).join("");
  return {
    at: Math.round(row.at),
    model: row.model,
    title: row.story.title,
    paragraphs: row.story.paragraphs,
    words: row.words,
    missing: row.words.filter((w) => !text.includes(w)),
    stale: now.length !== row.words.length || now.some((w) => !row.words.includes(w)),
  };
}

/** Write a story with the stuck words in it, and keep it. Owner only: it costs money. */
export async function makeStory(sql: Sql, owner: string): Promise<StuckStory> {
  const stuck = await kitWords(sql, owner, STORY_WORDS);
  if (!stuck.length) throw new RescueError("No word is stuck or new, so there is nothing to write a story around.");
  const apiKey = process.env.CHONGFUXI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new RescueError("No Anthropic API key is set (CHONGFUXI_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY).");

  const content = [
    "The words to use, each in this sense:",
    ...stuck.map((w) => `- ${w.word}${w.pinyin ? ` (${w.pinyin.replace(/@/g, " ")})` : ""}${w.gloss ? `: ${w.gloss}` : ""}`),
  ].join("\n");
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 6000,
    system: STORY_SYSTEM,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: STORY_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content }],
  });
  const text = message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  let given: { title?: unknown; paragraphs?: unknown };
  try {
    given = JSON.parse(text);
  } catch {
    throw new RescueError(message.stop_reason === "refusal" ? "The model declined." : "The story came back malformed.");
  }
  const paragraphs = (Array.isArray(given.paragraphs) ? given.paragraphs : [])
    .map((p) => p as Record<string, unknown>)
    .map((p) => ({ zh: typeof p.zh === "string" ? p.zh.trim() : "", en: typeof p.en === "string" ? p.en.trim() : "" }))
    .filter((p) => p.zh)
    .slice(0, 2);
  if (!paragraphs.length) throw new RescueError("The story came back empty.");
  const story = { title: typeof given.title === "string" ? given.title.trim().slice(0, 40) : "", paragraphs };
  const words = stuck.map((w) => w.word);
  await sql`
    insert into chongfuxi_rescue_story (owner_email, at, model, words, story)
    values (${owner}, now(), ${MODEL}, ${words}::text[], ${JSON.stringify(story)}::jsonb)
    on conflict (owner_email) do update set at = now(), model = excluded.model, words = excluded.words, story = excluded.story
  `;
  console.log("rescue story", JSON.stringify({ words: words.length, usage: message.usage }));
  return (await storyOf(sql, owner))!;
}
