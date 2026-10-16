// The deck word by word, for the Words page: every word as a tile, and one
// word in full when it is opened.

import type { Sql } from "./db";
import type { CardHistory, WordDetail, WordTile } from "@chongfuxi/lib/api";
import type { Definition } from "@chongfuxi/lib/dict";
import { zhShown } from "@chongfuxi/lib/hanzi";
import type { PlecoSeed } from "@chongfuxi/lib/pleco";
import { recallOdds, type Grade } from "@chongfuxi/lib/schedule";
import { longkuWords } from "./longku";
import { CARD_COLUMNS, CONTEXT_IDEAL_HAN, CONTEXT_MIN_HAN, hskOf, promptSenses, scheduleOf, type CardRow } from "./review";

/** Sentences shown on a word's sheet. */
const BEST = 6;
/** A gloss on a tile is for finding the word, so it is kept short. */
const GLOSS_CHARS = 48;

export class WordError extends Error {}

/** Set a word aside, or bring it back: every card it had live, merged meanings left as they are. */
export async function setAside(sql: Sql, owner: string, word: string, aside: boolean): Promise<{ cards: number }> {
  const found = (await sql`select status from chongfuxi_word where owner_email = ${owner} and word = ${word}`) as unknown as Array<{
    status: string;
  }>;
  if (found[0]?.status !== "deck") throw new WordError(`${word} isn't in the deck.`);
  const moved = (await sql`
    update chongfuxi_card c set suspended = ${aside}
    where c.owner_email = ${owner} and c.word = ${word} and c.kind in ('read', 'produce') and c.suspended = ${!aside}
      and (c.meaning_id is null or exists (
        select 1 from chongfuxi_meaning m where m.owner_email = c.owner_email and m.id = c.meaning_id and m.merged is null
      ))
    returning c.id
  `) as unknown as Array<{ id: number }>;
  return { cards: moved.length };
}

/** Every deck word with its Read card, for the wall. */
export async function listWords(sql: Sql, owner: string): Promise<WordTile[]> {
  const rows = (await sql`
    select w.word, w.pinyin, w.defs, w.lists,
           c.stability, (extract(epoch from c.due) * 1000)::double precision as due,
           c.answered, c.difficulty, c.suspended as aside,
           (select count(*)::int from chongfuxi_review r
            where r.owner_email = c.owner_email and r.card_id = c.id and r.grade = 'forgot') as forgot_here,
           exists (
             select 1 from chongfuxi_card p
             where p.owner_email = w.owner_email and p.kind = 'produce' and p.word = w.word and p.meaning_id is null
           ) as recall
    from chongfuxi_word w
    join chongfuxi_card c
      on c.owner_email = w.owner_email and c.kind = 'read' and c.word = w.word and c.meaning_id is null
    where w.owner_email = ${owner} and w.status = 'deck'
    order by c.due, w.word
  `) as unknown as Array<{
    word: string;
    pinyin: string | null;
    defs: Definition[];
    lists: string[] | null;
    stability: number;
    due: number;
    answered: number;
    forgot_here: number;
    difficulty: number;
    recall: boolean;
    aside: boolean;
  }>;
  const inLongku = await longkuWords(sql, owner, rows.map((r) => r.word));
  return rows.map((r) => {
    const gloss = promptSenses(r.defs, r.pinyin)[0] ?? null;
    return {
      word: r.word,
      pinyin: r.pinyin,
      gloss: gloss && gloss.length > GLOSS_CHARS ? `${gloss.slice(0, GLOSS_CHARS - 1)}…` : gloss,
      stability: Math.round(r.stability * 10) / 10,
      due: Math.round(r.due),
      answered: r.answered,
      forgotHere: r.forgot_here,
      difficulty: Math.round(r.difficulty * 10) / 10,
      recall: r.recall,
      hsk: hskOf(r.lists ?? []),
      longku: inLongku.has(r.word),
      aside: r.aside,
    };
  });
}

/** One word in full: its cards and how they stand, Pleco's record, and the sentences it is in. */
export async function wordDetail(sql: Sql, owner: string, word: string, at = Date.now()): Promise<WordDetail | null> {
  const found = (await sql`
    select word, pinyin, defs, lists, pleco, exposures from chongfuxi_word
    where owner_email = ${owner} and word = ${word}
  `) as unknown as Array<{
    word: string;
    pinyin: string | null;
    defs: Definition[];
    lists: string[] | null;
    pleco: PlecoSeed | null;
    exposures: number;
  }>;
  const w = found[0];
  if (!w) return null;

  const cards = (await sql.query(
    `select ${CARD_COLUMNS}, m.gloss, c.suspended
     from chongfuxi_card c
     left join chongfuxi_meaning m on m.owner_email = c.owner_email and m.id = c.meaning_id
     where c.owner_email = $1 and c.word = $2 and c.kind in ('read', 'produce')
       -- A set-aside word's cards still show; a merged meaning's don't.
       and (not c.suspended or m.merged is null)
     order by c.meaning_id nulls first, (c.kind = 'produce'), c.id`,
    [owner, word],
  )) as unknown as Array<CardRow & { gloss: string | null; suspended: boolean }>;
  const answers = cards.length
    ? ((await sql`
        select card_id::int as card, grade, (extract(epoch from at) * 1000)::double precision as at
        from chongfuxi_review
        where owner_email = ${owner} and card_id = any(${cards.map((c) => c.id)}::bigint[])
        order by seq
      `) as unknown as Array<{ card: number; grade: Grade; at: number }>)
    : [];

  const counts = (await sql`
    select count(*) filter (where cardinality(s.blockers) = 0)::int as readable,
           count(*) filter (where cardinality(s.blockers) = 1)::int as one_away,
           count(*) filter (where cardinality(s.blockers) > 1)::int as locked
    from (select distinct sentence_id from chongfuxi_token where owner_email = ${owner} and word = ${word}) t
    join chongfuxi_sentence s on s.owner_email = ${owner} and s.id = t.sentence_id
  `) as unknown as Array<{ readable: number; one_away: number; locked: number }>;
  // The best readable ones, in the order a word card would choose them.
  const best = (await sql`
    select s.id::int as id, s.zh, s.en, s.sources,
           (select array_agg(t2.word order by t2.pos) from chongfuxi_token t2
            where t2.owner_email = s.owner_email and t2.sentence_id = s.id) as words
    from (select distinct sentence_id from chongfuxi_token where owner_email = ${owner} and word = ${word}) t
    join chongfuxi_sentence s on s.owner_email = ${owner} and s.id = t.sentence_id
    where cardinality(s.blockers) = 0
    order by (char_length(s.key) < ${CONTEXT_MIN_HAN}), (s.zh ~ '^\s*【'), cardinality(s.sources) desc,
             abs(char_length(s.key) - ${CONTEXT_IDEAL_HAN}), s.id
    limit ${BEST}
  `) as unknown as Array<{ id: number; zh: string; en: string | null; sources: string[]; words: string[] | null }>;

  const pleco = w.pleco;
  return {
    word: w.word,
    pinyin: w.pinyin,
    defs: w.defs,
    hsk: hskOf(w.lists ?? []),
    longku: (await longkuWords(sql, owner, [w.word])).has(w.word),
    aside: cards.some((c) => c.kind === "read" && c.meaning_id === null && c.suspended),
    cards: cards.map((c) => {
      const schedule = scheduleOf(c);
      const here = answers.filter((a) => a.card === c.id);
      // Pleco's record is of recognising the word whole: it belongs to the Read card.
      const own = c.kind === "read" && c.meaning_id === null ? pleco : null;
      const last = here[here.length - 1];
      const history: CardHistory = {
        pleco: [...(own?.history ?? "")].map((d): Grade => (d >= "4" ? "good" : "forgot")),
        here: here.map((a) => a.grade),
        lastAt: last ? Math.round(last.at) : own?.last ? own.last * 1000 : null,
        lastIn: last ? "here" : own?.last ? "pleco" : null,
      };
      return {
        kind: c.kind,
        meaning: c.gloss,
        note: c.note,
        isNew: c.state === 0,
        due: Math.round(c.due),
        stability: c.stability,
        difficulty: c.difficulty,
        odds: recallOdds(schedule, at),
        answered: c.answered,
        forgotHere: here.filter((a) => a.grade === "forgot").length,
        history,
      };
    }),
    pleco: pleco
      ? {
          score: pleco.score,
          correct: pleco.correct,
          incorrect: pleco.incorrect,
          first: pleco.first ? pleco.first * 1000 : null,
          last: pleco.last ? pleco.last * 1000 : null,
        }
      : null,
    exposures: w.exposures,
    sentences: {
      readable: counts[0].readable,
      oneAway: counts[0].one_away,
      locked: counts[0].locked,
      best: best.map((s) => ({ id: s.id, zh: zhShown(s.zh), en: s.en, sources: s.sources, words: s.words ?? [] })),
    },
  };
}
