// A word's page: how it lives in the owner's corpus. Its sheet (wordDetail)
// and, on top, every answer on its cards for the chart, every sentence it is
// in (readable, one away, locked, and what its card has done), the sentence
// cards it tripped, what was written after forgetting it, what was looked up
// about it, how it came into the deck, its Learn, and the words around it.
// Read-only, and readable by anyone like the sheet.

import type { Sql } from "./db";
import type { WordPage, WordPageSentence } from "@chongfuxi/lib/api";
import { zhShown } from "@chongfuxi/lib/hanzi";
import type { CardKind, Grade } from "@chongfuxi/lib/schedule";
import { ensureLookupTables } from "./lookup";
import { CONTEXT_IDEAL_HAN } from "./review";
import { wordDetail } from "./words";

/** Sentences sent at a time. */
export const PAGE_SENTENCES = 40;

const ms = (column: string) => `(extract(epoch from ${column}) * 1000)::double precision`;

/** Which sentences: readable, one word away, or locked by two or more. */
export type SentenceStatus = WordPageSentence["status"];
const BLOCKERS: Record<SentenceStatus, [number, number]> = { readable: [0, 0], oneAway: [1, 1], locked: [2, 1_000_000] };

/** A page of the sentences a word is in, of one standing; each nearest a natural length first. */
export async function wordSentences(
  sql: Sql,
  owner: string,
  word: string,
  status: SentenceStatus,
  offset: number,
  limit = PAGE_SENTENCES,
): Promise<WordPageSentence[]> {
  const [lo, hi] = BLOCKERS[status];
  const rows = (await sql`
    select s.id::int as id, s.zh, s.en, s.sources, coalesce(s.blockers, '{}') as blockers,
           (select array_agg(t2.word order by t2.pos) from chongfuxi_token t2
            where t2.owner_email = s.owner_email and t2.sentence_id = s.id) as words,
           c.answered, c.clean_reads, c.retired is not null as retired, c.id is not null as has_card
    from (select distinct sentence_id from chongfuxi_token where owner_email = ${owner} and word = ${word}) t
    join chongfuxi_sentence s on s.owner_email = ${owner} and s.id = t.sentence_id
    left join chongfuxi_card c on c.owner_email = s.owner_email and c.kind = 'sentence' and c.sentence_id = s.id
    where cardinality(coalesce(s.blockers, '{}')) between ${lo} and ${hi}
    order by abs(char_length(s.key) - ${CONTEXT_IDEAL_HAN}), s.id
    limit ${limit} offset ${offset}
  `) as unknown as Array<{
    id: number;
    zh: string;
    en: string | null;
    sources: string[];
    blockers: string[];
    words: string[] | null;
    answered: number | null;
    clean_reads: number | null;
    retired: boolean;
    has_card: boolean;
  }>;
  return rows.map((r) => ({
    id: r.id,
    zh: zhShown(r.zh),
    en: r.en,
    sources: r.sources,
    words: r.words ?? [],
    status: r.blockers.length === 0 ? "readable" : r.blockers.length === 1 ? "oneAway" : "locked",
    blockers: r.blockers,
    card: r.has_card ? { answered: r.answered ?? 0, cleanReads: r.clean_reads ?? 0, retired: r.retired } : null,
  }));
}

export async function wordPage(sql: Sql, owner: string, word: string): Promise<WordPage | null> {
  const detail = await wordDetail(sql, owner, word);
  if (!detail) return null;
  await ensureLookupTables(sql);

  const [row] = (await sql`
    select lists, glosses,
           (select (extract(epoch from c.learned_at) * 1000)::double precision from chongfuxi_card c
            where c.owner_email = w.owner_email and c.word = w.word and c.kind = 'read' and c.meaning_id is null) as learned_at
    from chongfuxi_word w where w.owner_email = ${owner} and w.word = ${word}
  `) as unknown as Array<{ lists: string[] | null; glosses: string[] | null; learned_at: number | null }>;

  const answers = (await sql.query(
    `select r.kind, m.gloss, ${ms("r.at")} as at, r.grade, r.comment
     from chongfuxi_review r
     left join chongfuxi_meaning m on m.owner_email = r.owner_email and m.id = r.meaning_id
     where r.owner_email = $1 and r.word = $2 and r.kind in ('read', 'produce') and r.cause = 'answer'
     order by r.seq`,
    [owner, word],
  )) as unknown as Array<{ kind: CardKind; gloss: string | null; at: number; grade: Grade; comment: string | null }>;

  const tripped = (await sql.query(
    `select s.id::int as id, s.zh, s.en, ${ms("r.at")} as at, r.comment
     from chongfuxi_review r
     join chongfuxi_sentence s on s.owner_email = r.owner_email and s.id = r.sentence_id
     where r.owner_email = $1 and r.kind = 'sentence' and r.cause = 'answer' and r.grade = 'forgot' and $2 = any(r.tapped)
     order by r.seq desc limit 50`,
    [owner, word],
  )) as unknown as Array<{ id: number; zh: string; en: string | null; at: number; comment: string | null }>;

  // Asked from one of its cards, or naming it.
  const lookups = (await sql.query(
    `select l.query, l.kind, l.verdict, ${ms("coalesce(c.at, l.at)")} as at, c.via, c.step
     from chongfuxi_lookup l
     left join lateral (
       select via, step, at from chongfuxi_lookup_card c
       where c.owner_email = l.owner_email and c.query = l.query and c.word = $2
       order by c.at desc limit 1
     ) c on true
     where l.owner_email = $1 and (strpos(l.query, $2) > 0 or c.via is not null)
     order by coalesce(c.at, l.at) desc limit 30`,
    [owner, word],
  )) as unknown as Array<{ query: string; kind: string | null; verdict: string | null; at: number; via: "review" | "learn" | null; step: string | null }>;

  const learn = (await sql.query(
    `select ${ms("at")} as at, misses, jsonb_array_length(steps)::int as steps, steps @> '[{"grade": "known"}]'::jsonb as known
     from chongfuxi_learn where owner_email = $1 and word = $2 order by at`,
    [owner, word],
  )) as unknown as Array<{ at: number; misses: number; steps: number; known: boolean }>;

  const origin = (await sql.query(
    `select source, ${ms("at")} as at, undone_at is not null as undone
     from chongfuxi_addition
     where owner_email = $1 and words @> jsonb_build_array(jsonb_build_object('word', $2::text))
     order by at`,
    [owner, word],
  )) as unknown as Array<{ source: string; at: number; undone: boolean }>;

  const unlocked = (await sql`
    select zh, en, count(*) over ()::int as n from chongfuxi_sentence
    where owner_email = ${owner} and unlocked_by = ${word}
    order by abs(char_length(key) - ${CONTEXT_IDEAL_HAN}), id
    limit 3
  `) as unknown as Array<{ zh: string; en: string | null; n: number }>;
  const [held] = (await sql`
    select count(*)::int as n from chongfuxi_sentence
    where owner_email = ${owner} and blockers = array[${word}]::text[]
  `) as unknown as Array<{ n: number }>;

  const compounds = (await sql`
    select word from chongfuxi_word
    where owner_email = ${owner} and status = 'deck' and word <> ${word} and strpos(word, ${word}) > 0
    order by char_length(word), word limit 12
  `) as unknown as Array<{ word: string }>;
  const glosses = row?.glosses ?? [];
  const same = glosses.length
    ? ((await sql`
        select word from chongfuxi_word
        where owner_email = ${owner} and status = 'deck' and word <> ${word} and glosses && ${glosses}::text[]
        order by char_length(word), word limit 8
      `) as unknown as Array<{ word: string }>)
    : [];

  const total = detail.sentences.readable + detail.sentences.oneAway + detail.sentences.locked;
  const firstStatus: SentenceStatus = detail.sentences.readable ? "readable" : detail.sentences.oneAway ? "oneAway" : "locked";
  const firstRows = total ? await wordSentences(sql, owner, word, firstStatus, 0) : [];
  return {
    ...detail,
    lists: row?.lists ?? [],
    origin: origin.map((o) => ({ source: o.source, at: Math.round(o.at), undone: o.undone })),
    answers: answers.map((a) => ({ kind: a.kind, meaning: a.gloss, at: Math.round(a.at), grade: a.grade })),
    notes: answers.filter((a) => a.comment).map((a) => ({ kind: a.kind, at: Math.round(a.at), comment: a.comment! })),
    // The first panel with any: readable, else one away, else locked.
    sentencesAll: { total, status: firstStatus, rows: firstRows },
    tripped: tripped.map((t) => ({ id: t.id, zh: zhShown(t.zh), en: t.en, at: Math.round(t.at), comment: t.comment })),
    lookups: lookups.map((l) => ({ ...l, at: Math.round(l.at) })),
    learn: {
      learnedAt: row?.learned_at ? Math.round(row.learned_at) : null,
      sessions: learn.map((l) => ({ at: Math.round(l.at), steps: l.steps, misses: l.misses, known: l.known })),
    },
    unlocked: { count: unlocked[0]?.n ?? 0, examples: unlocked.map((u) => ({ zh: zhShown(u.zh), en: u.en })) },
    holdsBack: held?.n ?? 0,
    compounds: compounds.map((c) => c.word),
    sameMeaning: same.map((s) => s.word),
  };
}
