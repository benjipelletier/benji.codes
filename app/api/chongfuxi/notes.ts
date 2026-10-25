// The owner's notes after a Forgot ("thought it was 发现"), answered. A note
// is a question to an AI that nothing used to answer: now the owner's agent
// (Muse) reads the unanswered ones each morning (agent/notes, GET) and hands
// back, for each, the word it was taken for, how the two differ and a pair of
// sentences (POST). Every answer is kept, several to a note if Muse answers
// again. They show on the word's card backs until it is got right twice in a
// row after them, on its word page, and in the notes list on Muse reviews.
// Words a note names count as a mix-up partner for Words to revive at once,
// with or without an answer.

import type { CardKind } from "@chongfuxi/lib/schedule";
import type { CardNoteAnswer, NoteAnswer, NoteEntry, NotePair } from "@chongfuxi/lib/api";
import type { Definition } from "@chongfuxi/lib/dict";
import type { Sql } from "./db";
import { AgentError } from "./agent";
import { loadHeadwords } from "./headwords";
import { promptSenses, shownPinyin } from "./review";
import { RESCUE_CLEAR } from "@chongfuxi/lib/review";

/** Notes listed at a time; unanswered notes handed to Muse at once. */
export const NOTES_PAGE = 50;
const AGENT_BATCH = 60;
/** Answers to a word shown on its card at once. */
const ON_CARD = 2;
/** Longest word looked for in a note. */
const NAMED_MAX = 6;
const HAN_RUN = /[㐀-鿿]+/g;
const HAN = /[㐀-鿿]/;

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_note_answer (
      owner_email text not null,
      id bigint generated always as identity,
      review_id text not null,
      at timestamptz not null default now(),
      model text not null,
      partner text,
      difference text not null,
      pair jsonb,
      primary key (owner_email, id)
    )
  `;
  await sql`create index if not exists chongfuxi_note_answer_review on chongfuxi_note_answer (owner_email, review_id)`;
  ready = true;
}

/**
 * The words a note names, other than the card's own: each run of Chinese in
 * it, taken whole if it is a word (the corpus's or the dictionary's), else
 * the longest words inside it, left to right. Single characters only when
 * the run is one.
 */
export function namedIn(note: string, own: string | null, isWord: (w: string) => boolean): string[] {
  const out: string[] = [];
  const take = (w: string) => {
    if (w !== own && !(own && (own.includes(w) || w.includes(own))) && !out.includes(w)) out.push(w);
  };
  for (const run of note.match(HAN_RUN) ?? []) {
    if (run.length <= NAMED_MAX && isWord(run)) {
      take(run);
      continue;
    }
    for (let i = 0; i < run.length; ) {
      let hit = "";
      for (let n = Math.min(NAMED_MAX, run.length - i); n >= 2; n--) {
        if (isWord(run.slice(i, i + n))) {
          hit = run.slice(i, i + n);
          break;
        }
      }
      if (hit) take(hit);
      i += hit.length || 1;
    }
  }
  return out;
}

/** A word test over the corpus's words and the dictionary's headwords. */
async function wordTest(sql: Sql, owner: string, notes: string[]): Promise<(w: string) => boolean> {
  const runs = notes.flatMap((n) => n.match(HAN_RUN) ?? []);
  const subs = new Set<string>();
  for (const r of runs) for (let i = 0; i < r.length; i++) for (let n = 1; n <= NAMED_MAX && i + n <= r.length; n++) subs.add(r.slice(i, i + n));
  const corpus = subs.size
    ? new Set(
        ((await sql`select word from chongfuxi_word where owner_email = ${owner} and word = any(${[...subs]}::text[])`) as unknown as Array<{ word: string }>).map(
          (r) => r.word,
        ),
      )
    : new Set<string>();
  const dict = loadHeadwords();
  return (w) => corpus.has(w) || dict.has(w);
}

type NoteRow = {
  id: string;
  at: number;
  kind: CardKind;
  word: string | null;
  sid: number | null;
  zh: string | null;
  en: string | null;
  tapped: string[];
  note: string;
};

const NOTE_COLUMNS = `r.id, (extract(epoch from r.at) * 1000)::double precision as at, r.kind, r.word, s.id::int as sid, s.zh, s.en, r.tapped, r.comment as note`;
const NOTE_FROM = `from chongfuxi_review r left join chongfuxi_sentence s on s.owner_email = r.owner_email and s.id = r.sentence_id`;

async function answersFor(sql: Sql, owner: string, ids: string[]): Promise<Map<string, NoteAnswer[]>> {
  await ensureTable(sql);
  if (!ids.length) return new Map();
  const rows = (await sql`
    select review_id, id::int as id, (extract(epoch from at) * 1000)::double precision as at, model, partner, difference, pair
    from chongfuxi_note_answer where owner_email = ${owner} and review_id = any(${ids}::text[])
    order by at desc
  `) as unknown as Array<{ review_id: string; id: number; at: number; model: string; partner: string | null; difference: string; pair: NotePair | null }>;
  const out = new Map<string, NoteAnswer[]>();
  for (const r of rows) {
    const a: NoteAnswer = { id: r.id, at: Math.round(r.at), model: r.model, partner: r.partner, difference: r.difference, pair: r.pair };
    (out.get(r.review_id) ?? out.set(r.review_id, []).get(r.review_id)!).push(a);
  }
  return out;
}

async function entriesOf(sql: Sql, owner: string, rows: NoteRow[]): Promise<NoteEntry[]> {
  const [answers, isWord] = await Promise.all([answersFor(sql, owner, rows.map((r) => r.id)), wordTest(sql, owner, rows.map((r) => r.note))]);
  return rows.map((r) => ({
    id: r.id,
    at: Math.round(r.at),
    kind: r.kind,
    word: r.word,
    sentence: r.sid === null ? null : { id: r.sid, zh: r.zh ?? "", en: r.en },
    tapped: r.tapped ?? [],
    note: r.note,
    named: namedIn(r.note, r.word, isWord),
    answers: answers.get(r.id) ?? [],
  }));
}

/** The owner's notes, newest first, with Muse's answers. Readable by anyone, like the rest of the log. */
export async function listNotes(
  sql: Sql,
  owner: string,
  offset = 0,
  limit = NOTES_PAGE,
): Promise<{ notes: NoteEntry[]; total: number; answered: number; lastAnswer: number | null }> {
  await ensureTable(sql);
  const rows = (await sql.query(
    `select ${NOTE_COLUMNS} ${NOTE_FROM}
     where r.owner_email = $1 and r.comment is not null and r.cause = 'answer'
     order by r.at desc offset $2 limit $3`,
    [owner, offset, limit],
  )) as unknown as NoteRow[];
  const [counts] = (await sql`
    select count(*)::int as total,
           count(*) filter (where exists (select 1 from chongfuxi_note_answer a where a.owner_email = r.owner_email and a.review_id = r.id))::int as answered,
           (select (extract(epoch from max(a.at)) * 1000)::double precision from chongfuxi_note_answer a where a.owner_email = ${owner}) as "lastAnswer"
    from chongfuxi_review r where r.owner_email = ${owner} and r.comment is not null and r.cause = 'answer'
  `) as unknown as Array<{ total: number; answered: number; lastAnswer: number | null }>;
  return { notes: await entriesOf(sql, owner, rows), ...counts, lastAnswer: counts.lastAnswer === null ? null : Math.round(counts.lastAnswer) };
}

/**
 * A word's notes: written on its cards, written on a sentence card where it
 * was marked as the trouble, naming it, or answered as its partner. Newest first.
 */
export async function notesForWord(sql: Sql, owner: string, word: string): Promise<NoteEntry[]> {
  await ensureTable(sql);
  const rows = (await sql.query(
    `select ${NOTE_COLUMNS} ${NOTE_FROM}
     where r.owner_email = $1 and r.comment is not null and r.cause = 'answer'
       and (r.word = $2 or $2 = any(r.tapped) or strpos(r.comment, $2) > 0
            or exists (select 1 from chongfuxi_note_answer a where a.owner_email = r.owner_email and a.review_id = r.id and a.partner = $2))
     order by r.at desc limit 100`,
    [owner, word],
  )) as unknown as NoteRow[];
  return entriesOf(sql, owner, rows);
}

/**
 * Answers to show on these words' cards: each answer to a note on the word's
 * cards or naming it as the partner, newest first, up to ON_CARD a word,
 * until the word has been got right RESCUE_CLEAR times in a row since it.
 */
export async function cardAnswers(sql: Sql, owner: string, words: string[]): Promise<Map<string, CardNoteAnswer[]>> {
  if (!words.length) return new Map();
  await ensureTable(sql);
  const rows = (await sql.query(
    `select r.word, r.comment as note, a.partner, a.difference, a.pair, (extract(epoch from a.at) * 1000)::double precision as at,
            w.w as shown_on
     from chongfuxi_note_answer a
     join chongfuxi_review r on r.owner_email = a.owner_email and r.id = a.review_id
     join unnest($2::text[]) as w(w) on w.w = r.word or w.w = a.partner
     where a.owner_email = $1
       and not coalesce((
         select count(*) = $3 and bool_and(x.grade = 'good')
         from (select x.grade from chongfuxi_review x
               where x.owner_email = a.owner_email and x.word = w.w and x.kind in ('read', 'produce') and x.cause in ('answer', 'tapped') and x.at > a.at
               order by x.seq desc limit $3) x
       ), false)
     order by a.at desc`,
    [owner, words, RESCUE_CLEAR],
  )) as unknown as Array<{ word: string | null; note: string; partner: string | null; difference: string; pair: NotePair | null; at: number; shown_on: string }>;
  const out = new Map<string, CardNoteAnswer[]>();
  for (const r of rows) {
    const list = out.get(r.shown_on) ?? out.set(r.shown_on, []).get(r.shown_on)!;
    if (list.length < ON_CARD) list.push({ word: r.word ?? r.shown_on, partner: r.partner, note: r.note, difference: r.difference, pair: r.pair, at: Math.round(r.at) });
  }
  return out;
}

/** Mix-up partners from notes, for Words to revive: words a note on a word's cards names, and partners Muse gave. */
export async function notePartners(sql: Sql, owner: string, words: string[]): Promise<Array<{ word: string; other: string }>> {
  if (!words.length) return [];
  await ensureTable(sql);
  const rows = (await sql`
    select r.id, r.word, r.comment as note,
           (select array_agg(distinct a.partner) from chongfuxi_note_answer a
            where a.owner_email = r.owner_email and a.review_id = r.id and a.partner is not null) as partners
    from chongfuxi_review r
    where r.owner_email = ${owner} and r.comment is not null and r.cause = 'answer' and r.word = any(${words}::text[])
  `) as unknown as Array<{ id: string; word: string; note: string; partners: string[] | null }>;
  const isWord = await wordTest(sql, owner, rows.map((r) => r.note));
  // One vote per note and word: a note naming 发现 that Muse also answered with 发现 counts once.
  return rows.flatMap((r) => [...new Set([...namedIn(r.note, r.word, isWord), ...(r.partners ?? [])])].map((other) => ({ word: r.word, other })));
}

const BRIEF = `These are notes the learner wrote after getting a card wrong, often naming the word they took it for ("thought it was 发现"), or asking something. Answer each one: who it was mixed up with ("partner": a Chinese word, or null when the note isn't about another word), and "difference": one or two plain sentences on how the card's word differs from the partner (meaning, usage, collocation, register), or an answer to what the note asks, in the learner's terms. Then, when there is a partner, a "pair": two near-identical natural sentences, "mine" using the card's word and "theirs" using the partner, each with English, where only that word fits. For a sentence card (no word), answer about the words it marked as the trouble or the note. Be right above all: if the two words are interchangeable in some uses, say so and where they part. POST { answers: [{ id, partner, difference, pair: { mine: { zh, en }, theirs: { zh, en } } | null }] }. A note may be answered again later; every answer is kept.`;

export interface AgentNote {
  id: string;
  at: number;
  kind: CardKind;
  word: { word: string; pinyin: string | null; gloss: string | null } | null;
  sentence: { zh: string; en: string | null } | null;
  tapped: string[];
  note: string;
  /** Words the note names, with their meanings, to compare against. */
  named: Array<{ word: string; pinyin: string | null; gloss: string | null }>;
  answers: number;
}

/** The notes to answer: unanswered ones (all of them with `all`), oldest first, with what each is about. Readable by the agent. */
export async function agentNotes(sql: Sql, owner: string, all = false): Promise<{ brief: string; notes: AgentNote[]; left: number }> {
  await ensureTable(sql);
  const where = `r.owner_email = $1 and r.comment is not null and r.cause = 'answer'
    ${all ? "" : "and not exists (select 1 from chongfuxi_note_answer a where a.owner_email = r.owner_email and a.review_id = r.id)"}`;
  const rows = (await sql.query(`select ${NOTE_COLUMNS} ${NOTE_FROM} where ${where} order by r.at limit $2`, [owner, AGENT_BATCH])) as unknown as NoteRow[];
  const [{ n }] = (await sql.query(`select count(*)::int as n from chongfuxi_review r where ${where}`, [owner])) as unknown as Array<{ n: number }>;
  const entries = await entriesOf(sql, owner, rows);
  const looked = [...new Set(entries.flatMap((e) => [...(e.word ? [e.word] : []), ...e.named, ...e.tapped]))];
  const info = looked.length
    ? new Map(
        ((await sql`select word, pinyin, defs from chongfuxi_word where owner_email = ${owner} and word = any(${looked}::text[])`) as unknown as Array<{
          word: string;
          pinyin: string | null;
          defs: Definition[];
        }>).map((r) => {
          const pinyin = shownPinyin(r.pinyin, r.defs);
          return [r.word, { word: r.word, pinyin, gloss: promptSenses(r.defs, pinyin).slice(0, 3).join("; ") || null }];
        }),
      )
    : new Map<string, { word: string; pinyin: string | null; gloss: string | null }>();
  const about = (w: string) => info.get(w) ?? { word: w, pinyin: null, gloss: null };
  return {
    brief: BRIEF,
    left: n,
    notes: entries.map((e) => ({
      id: e.id,
      at: e.at,
      kind: e.kind,
      word: e.word ? about(e.word) : null,
      sentence: e.sentence ? { zh: e.sentence.zh, en: e.sentence.en } : null,
      tapped: e.tapped,
      note: e.note,
      named: e.named.map(about),
      answers: e.answers.length,
    })),
  };
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

function pairOf(v: unknown, mine: string | null, theirs: string | null): NotePair | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, Record<string, unknown> | undefined>;
  const side = (s: Record<string, unknown> | undefined) => ({ zh: str(s?.zh, 200), en: str(s?.en, 300) });
  const pair = { mine: side(p.mine), theirs: side(p.theirs) };
  if (!HAN.test(pair.mine.zh) || !HAN.test(pair.theirs.zh)) return null;
  // Each sentence must hold its word, when there is one to hold.
  if ((mine && !pair.mine.zh.includes(mine)) || (theirs && !pair.theirs.zh.includes(theirs))) return null;
  return pair;
}

/** Keep the agent's answers. Each is checked against its note; one that isn't is named back. */
export async function writeAnswers(
  sql: Sql,
  owner: string,
  input: { answers?: unknown; model?: unknown },
): Promise<{ saved: number; failed: Array<{ id: string; error: string }> }> {
  await ensureTable(sql);
  const given = (Array.isArray(input.answers) ? input.answers : []).slice(0, AGENT_BATCH).map((a) => (a ?? {}) as Record<string, unknown>);
  if (!given.length) throw new AgentError("Give { answers: [{ id, partner, difference, pair }] }.");
  const ids = given.map((a) => str(a.id, 100)).filter(Boolean);
  const notes = new Map(
    ((await sql`
      select id, word, tapped from chongfuxi_review where owner_email = ${owner} and comment is not null and id = any(${ids}::text[])
    `) as unknown as Array<{ id: string; word: string | null; tapped: string[] }>).map((r) => [r.id, r]),
  );
  const model = str(input.model, 60) || "Muse";
  const failed: Array<{ id: string; error: string }> = [];
  let saved = 0;
  for (const a of given) {
    const id = str(a.id, 100);
    const note = notes.get(id);
    if (!note) {
      failed.push({ id, error: "no note with this id" });
      continue;
    }
    const difference = str(a.difference, 800);
    if (!difference) {
      failed.push({ id, error: "needs a difference" });
      continue;
    }
    let partner = str(a.partner, 12) || null;
    if (partner && (!HAN.test(partner) || partner === note.word)) partner = null;
    // A sentence card has no word of its own: its pair's first sentence holds a word it marked, if any.
    const pair = pairOf(a.pair, note.word, partner);
    await sql`
      insert into chongfuxi_note_answer (owner_email, review_id, model, partner, difference, pair)
      values (${owner}, ${id}, ${model}, ${partner}, ${difference}, ${pair ? JSON.stringify(pair) : null}::jsonb)
    `;
    saved++;
  }
  return { saved, failed };
}
