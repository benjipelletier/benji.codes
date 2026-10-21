// Words that need reviving: a word whose latest result was wrong (a Forgot on
// its Read or Recall card, or a forgotten sentence it was tapped as tripping),
// placed in a category by its recent results (lib/revive.ts: mixed up, can't
// produce, breaks in context, slipping, won't stick, leech), gets a rescue
// aimed at that category, made by the model from everything known about
// it: its answers, what was written after each Forgot, its card notes, the
// sentences it tripped, the lookups about it, the words it is mixed up with,
// and the owner's readable sentences with it. A rescue is a diagnosis, a
// memory hook, the confusions told apart, and a short quiz. Once worked
// through, the hook shows on the word's cards until RESCUE_CLEAR Goods in a
// row. Nothing here touches a schedule. The owner asked for it, to get words
// out of "forgotten land". Made only when the owner asks (it costs money),
// at Look up's model and effort (never lower).

import Anthropic from "@anthropic-ai/sdk";
import type { Sql } from "./db";
import type { Rescue, RescueDrillItem, StuckStory, StuckWord } from "@chongfuxi/lib/api";
import type { Definition } from "@chongfuxi/lib/dict";
import { zhShown } from "@chongfuxi/lib/hanzi";
import { RESCUE_CLEAR } from "@chongfuxi/lib/review";
import { CATEGORIES, REVIVE, classify, type ReviveCategory, type ReviveEvent } from "@chongfuxi/lib/revive";
import { EFFORT, MODEL, ensureLookupTables, lookupWords } from "./lookup";
import { promptSenses, shownPinyin } from "./review";
import { SUSPENDED_WORD } from "./suspended";
import { wordPage, wordSentences } from "./wordpage";

export class RescueError extends Error {}

/** Results that count: its word cards' answers, and lapses from being tapped in a forgotten sentence. */
const RESULTS = `r.kind in ('read', 'produce') and r.cause in ('answer', 'tapped')`;
/** Readable sentences with the word shown to the model, for the quiz's clozes. */
const SENTENCES = 12;
const DRILL_MIN = 4;
const DRILL_MAX = 7;
/**
 * The rescue's shape. 2: a quiz of retrieval (recall, cloze without options,
 * contrast with only real confusions, translate), after the owner found
 * version 1's multiple choice too easy to help. A rescue of an older version
 * counts as stale, so opening it makes it again.
 */
export const RESCUE_VERSION = 2;
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
    `It is confused with ${p}. Make the whole rescue about telling the two apart: the diagnosis says what separates them, the hook is the one contrast that settles it, and most questions are contrast items with ${p} as the wrong option, or recalls whose cue fits only this word.`,
  produce: () =>
    "They recognise it but can't produce it from its meaning. Make the hook about getting from the meaning to the word's sound and characters, and the quiz all production: recall, cloze and translate items; contrast only for a real confusion.",
  context: () =>
    "They know it alone but it trips them in sentences: a sense, a collocation or a grammatical use they don't expect. Base the diagnosis on the sentences it tripped; make the hook about how it behaves in a sentence; make the quiz mostly cloze from their sentences and translations into contexts like the ones that tripped them.",
  slipping: () =>
    "They knew it well and it is slipping now. Say what may have changed (a similar word met lately, a sense they haven't seen); the hook is a quick refresher; keep the quiz short, mixing kinds.",
  stuck: () =>
    "It has never stuck: they get it wrong every time. Build it from the ground up: the hook links its sound, characters and meaning vividly; the quiz goes from easy recall to production.",
  leech: () =>
    "It keeps flip-flopping and never settles. Try an angle they won't have tried: what its characters mean on their own, where the word comes from, a striking image. If it seems not worth the effort for now, say so in the diagnosis (they can suspend it).",
};

async function evidenceFor(sql: Sql, owner: string, word: string, place: Pick<StuckWord, "category" | "why" | "partner"> | null) {
  const page = await wordPage(sql, owner, word);
  if (!page || page.status !== "deck") throw new RescueError(`${word} isn't in the deck.`);
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

  const day = (at: number) => new Date(at).toISOString().slice(0, 10);
  const meanings = page.defs.map((d) => `${d.p ? `${d.p.replace(/@/g, " ")}: ` : ""}${d.senses.join("; ")}${d.own ? " (the owner's own Pleco definition)" : ""}`);
  // The word it is mixed up with: its meanings, for telling them apart.
  const partner = place?.partner
    ? ((await sql`select pinyin, defs from chongfuxi_word where owner_email = ${owner} and word = ${place.partner}`) as unknown as Array<{
        pinyin: string | null;
        defs: Definition[];
      }>)[0]
    : undefined;
  const lines = [
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
    ...(before?.hook
      ? [
          "",
          `An earlier rescue's hook, which hasn't held: ${before.hook}`,
          ...(before.drill ? [`Its quiz: ${before.drill.filter((d) => d.right).length} of ${before.drill.length} right.`] : []),
        ]
      : []),
    "",
    readable.length ? "The owner's readable sentences with it (id: sentence — translation), for clozes:" : "The owner has no readable sentence with it: make no cloze.",
    ...readable.map((s) => `${s.id}: ${s.zh}${s.en ? ` — ${s.en}` : ""}`),
  ];
  return {
    page,
    text: lines.join("\n"),
    sentences: new Map(readable.map((s) => [s.id, s])),
    counts: { missed: page.answers.filter((a) => a.grade === "forgot").length, tripped: page.tripped.length, notes: page.notes.length + page.cards.filter((c) => c.note).length, lookups: lookups.length },
  };
}

const SYSTEM = `You help a learner of Chinese with a word they keep getting wrong. You are told what kind of trouble it is and what to aim at; then you are given everything their study app knows about it: its meanings, their answers on its cards, what they wrote after forgetting it, the sentences they forgot because of it, what they looked up, the words it travels with, and their own sentences with it.

Work out why it keeps slipping, from that evidence, and give them what they need to keep it.
- diagnosis: two or three plain sentences on why it slips, pointing at the evidence (a word it's mixed up with, a meaning that differs from the one they expect, a character that misleads, the contexts it trips them in). Say what the evidence shows, not generalities.
- hook: one or two short sentences to hold on to the word: a vivid link between its sound or characters and its meaning, or the one contrast that settles a confusion. It will be shown on the word's flashcards, so make it quick to read.
- confusions: the words it is mixed up with (from the evidence: same-meaning words, words tapped with it, lookups comparing it), each with its pinyin (tone marks) and the difference in one sentence. Empty if none.
- drill: ${DRILL_MIN} to ${DRILL_MAX} questions that make them PRODUCE the word, not recognise it: recognising it among options is what they can already do, and it hasn't made it stick. Aim each at the diagnosis, easiest first, and end with the hardest. Kinds:
  - recall: prompt is an English cue that points at this word and not its confusions (a meaning with the nuance that separates them, or a short situation). answer is the word. No choices.
  - cloze: one of the user's own sentences, the word blanked, to fill with no options. Give the sentence's id as sentenceId and the word as answer. prompt is ignored (the app blanks the sentence). No choices.
  - contrast: one of the user's own sentences, the word blanked, where a word it is confused with would be wrong. sentenceId and answer as for cloze; choices are the word and only the words it is really confused with (from the evidence), 2 to 4 in all. No made-up or obviously wrong options.
  - translate: prompt is a short natural English sentence whose best Chinese uses the word, in a context it trips them in; answer is that Chinese sentence. No choices.
  Use at least one cloze and one recall when there are sentences; use contrast only when there is a real confusion; never ask what the word means with English options. explain says in one sentence what to notice. sentenceId is null for recall and translate; choices is empty except for contrast.
Write in English, with Chinese only for Chinese words and sentences.`;

const SCHEMA = {
  type: "object",
  properties: {
    diagnosis: { type: "string" },
    hook: { type: "string" },
    confusions: {
      type: "array",
      items: {
        type: "object",
        properties: { zh: { type: "string" }, pinyin: { type: "string" }, difference: { type: "string" } },
        required: ["zh", "pinyin", "difference"],
        additionalProperties: false,
      },
    },
    drill: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["recall", "cloze", "contrast", "translate"] },
          prompt: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          answer: { type: "string" },
          explain: { type: "string" },
          sentenceId: { type: ["integer", "null"] },
        },
        required: ["kind", "prompt", "choices", "answer", "explain", "sentenceId"],
        additionalProperties: false,
      },
    },
  },
  required: ["diagnosis", "hook", "confusions", "drill"],
  additionalProperties: false,
} as const;

const clip = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT) : "");

/**
 * The model's answer, kept to what holds: a cloze or contrast must use one of
 * the given sentences with the word in it (the app blanks it, not the
 * model), and its answer must be the word; a contrast's choices must be the
 * word and others; a recall's answer must be the word, a translation's
 * contain it. Items that fail are dropped.
 */
export function checkRescue(
  raw: unknown,
  word: string,
  sentences: Map<number, { zh: string; en: string | null }>,
): Pick<Rescue, "diagnosis" | "hook" | "confusions" | "drill"> & { version: number } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const diagnosis = clip(r.diagnosis);
  const hook = clip(r.hook);
  if (!diagnosis || !hook) throw new RescueError("The rescue came back without a diagnosis or a hook.");
  const confusions = (Array.isArray(r.confusions) ? r.confusions : [])
    .map((c) => c as Record<string, unknown>)
    .map((c) => ({ zh: clip(c.zh), pinyin: clip(c.pinyin), difference: clip(c.difference) }))
    .filter((c) => c.zh && c.difference)
    .slice(0, 5);
  const blanked = (zh: string) => {
    const at = zh.indexOf(word);
    return `${zh.slice(0, at)}${"＿".repeat(Math.max(2, [...word].length))}${zh.slice(at + word.length)}`;
  };
  const drill: RescueDrillItem[] = [];
  for (const item of Array.isArray(r.drill) ? r.drill : []) {
    const d = item as Record<string, unknown>;
    const answer = clip(d.answer);
    const explain = clip(d.explain);
    if (d.kind === "cloze" || d.kind === "contrast") {
      const s = typeof d.sentenceId === "number" ? sentences.get(d.sentenceId) : undefined;
      if (!s || answer !== word || !s.zh.includes(word)) continue;
      const choices = d.kind === "contrast" ? [...new Set((Array.isArray(d.choices) ? d.choices : []).map(clip).filter(Boolean))].slice(0, 4) : [];
      if (d.kind === "contrast" && (choices.length < 2 || !choices.includes(word))) continue;
      drill.push({ kind: d.kind, prompt: blanked(s.zh), choices, answer, explain, sentence: { id: d.sentenceId as number, en: s.en } });
    } else if (d.kind === "recall" || d.kind === "translate") {
      const prompt = clip(d.prompt);
      if (!prompt || (d.kind === "recall" ? answer !== word : !answer.includes(word))) continue;
      drill.push({ kind: d.kind, prompt, choices: [], answer, explain, sentence: null });
    }
  }
  if (drill.length < DRILL_MIN) throw new RescueError("The rescue's quiz came back with too few questions that hold up.");
  return { diagnosis, hook, confusions, drill: drill.slice(0, DRILL_MAX), version: RESCUE_VERSION };
}

type Row = { word: string; at: number; model: string; evidence: Rescue["evidence"]; rescue: Pick<Rescue, "diagnosis" | "hook" | "confusions" | "drill">; done_at: number | null; stale: boolean; outdated: boolean; pinyin: string | null; defs: Definition[] };

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
     from chongfuxi_rescue x join chongfuxi_word w on w.owner_email = x.owner_email and w.word = x.word
     where x.owner_email = $1 and x.word = $2`,
    [owner, word],
  )) as unknown as Row[];
  if (!row) return null;
  const p = shownPinyin(row.pinyin, row.defs);
  return {
    word: row.word,
    pinyin: p,
    gloss: promptSenses(row.defs, p).slice(0, 2).join("; ") || null,
    at: Math.round(row.at),
    model: row.model,
    ...row.rescue,
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
    max_tokens: 8000,
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
  const rescue = { ...checkRescue(given, word, evidence.sentences), category: place?.category ?? null, partner: place?.partner ?? null };
  await sql`
    insert into chongfuxi_rescue (owner_email, word, at, model, evidence, rescue, done_at, drill)
    values (${owner}, ${word}, now(), ${MODEL}, ${JSON.stringify(evidence.counts)}::jsonb, ${JSON.stringify(rescue)}::jsonb, null, null)
    on conflict (owner_email, word) do update set
      at = now(), model = excluded.model, evidence = excluded.evidence, rescue = excluded.rescue, done_at = null
  `;
  console.log("rescue", JSON.stringify({ word, drill: rescue.drill.length, usage: message.usage }));
  return (await savedRescue(sql, owner, word))!;
}

/** Worked through: its hook goes on its cards, and how the quiz went is kept for the next rescue. Owner only. */
export async function finishRescue(sql: Sql, owner: string, word: string, drill: Array<{ i: number; right: boolean }>): Promise<void> {
  await ensureRescueTable(sql);
  const done = await sql`
    update chongfuxi_rescue set done_at = now(), drill = ${JSON.stringify(drill)}::jsonb
    where owner_email = ${owner} and word = ${word}
    returning word
  `;
  if (!done.length) throw new RescueError(`${word} has no rescue to finish.`);
}

/**
 * The hooks of rescued words still recovering: worked through, and not yet
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

/** Stuck words a story is written around, the longest streaks first. */
const STORY_WORDS = 15;

const STORY_SYSTEM = `You write a short story in simplified Chinese for a learner, to help them remember words they keep forgetting. Use every one of the given words, each in a sentence where its meaning is clear from what happens (not just mentioned), in the sense given. Everything else in the story should be simple, common vocabulary (HSK 1–4), so the given words stand out. Exactly two paragraphs, each four to seven sentences, telling one connected story with a little humour or tension. Give a short Chinese title, and for each paragraph a natural English translation. Write the words exactly as given, with no spaces or pinyin in the Chinese.`;

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
  const now = (await stuckWords(sql, owner)).slice(0, STORY_WORDS).map((w) => w.word);
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
  const stuck = (await stuckWords(sql, owner)).slice(0, STORY_WORDS);
  if (!stuck.length) throw new RescueError("No word is stuck, so there is nothing to write a story around.");
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
