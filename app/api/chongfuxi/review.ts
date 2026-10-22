// The review session against the database: what to show next, and what an
// answer does.
//
// The scheduler (chongfuxi/lib/schedule.ts) and the rules (lib/review.ts) are
// pure; this is where they meet the rows. An answer is one transaction: the
// review row, the card it moved, and whatever else it moved — a Produce card
// opened, retired sentences brought back, tapped words lapsed.

import { SUSPENDED_WORD } from "./suspended";
import type { Sql } from "./db";
import { dictEntry, loadHeadwords } from "./headwords";
import type {
  Blocker,
  CardHistory,
  Coverage,
  FastCard,
  ListNode,
  ListWord,
  MissingWord,
  QueueWhy,
  ReviewInput,
  ReviewResult,
  SentenceDetail,
  SentenceInfo,
  SentenceRow,
  SourceCounts,
  SessionCard,
  Summary,
  WordInfo,
} from "@chongfuxi/lib/api";
import { isStudyDay, type StudyDay } from "@chongfuxi/lib/day";
import type { Definition } from "@chongfuxi/lib/dict";
import { zhShown } from "@chongfuxi/lib/hanzi";
import { longkuWords } from "./longku";
import { rescueHooks } from "./rescue";
import { contrastsFor } from "./synonyms";
import { SPOTIFY_LIST, moveSongLists, songsOf } from "./spotify";
import { lookUp, type Looked, type Lookup } from "@chongfuxi/lib/readings";
import { mainSenses } from "@chongfuxi/lib/senses";
import type { PlecoSeed } from "@chongfuxi/lib/pleco";
import {
  CLEAN_READS_TO_RETIRE,
  CONTEXT_CANDIDATES,
  CONTEXT_IDEAL_HAN,
  CONTEXT_MIN_HAN,
  CONTEXT_POOL,
  DUE_PER_NEW,
  WORD_POOL_FACTOR,
  REVIVED_CLEAN_READS,
  contextFit,
  interleave,
  lapseTargets,
  piecesOf,
  readSentence,
} from "@chongfuxi/lib/review";
import { SCHEDULER, answer, intervals, newSchedule, recallOdds, seedSchedule, type CardKind, type Grade, type Schedule } from "@chongfuxi/lib/schedule";

const DAY_MS = 86_400_000;
/**
 * A word's pinyin as saved, else its dictionary entry's (the first that
 * isn't a name's): a word added without a reading still shows one.
 */
export function shownPinyin(pinyin: string | null, defs: Definition[] | null): string | null {
  return pinyin || defs?.find((d) => /^[a-z]/.test(d.p))?.p || defs?.[0]?.p || null;
}

// The context sentences' lengths, kept with the other queue settings in lib/review.ts.
export { CONTEXT_IDEAL_HAN, CONTEXT_MIN_HAN };

export interface CardRow {
  id: number;
  kind: CardKind;
  word: string | null;
  meaning_id: number | null;
  sentence_id: number | null;
  state: number;
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  scheduled_days: number;
  last_review: number | null;
  answered: number;
  passed: number;
  clean_reads: number;
  last_clean_day: string | null;
  retired: number | null;
  note: string | null;
}

export const CARD_COLUMNS = `
  c.id::int as id, c.kind, c.word, c.meaning_id::int as meaning_id, c.sentence_id::int as sentence_id,
  c.state::int as state, (extract(epoch from c.due) * 1000)::double precision as due,
  c.stability, c.difficulty, c.reps, c.lapses, c.scheduled_days,
  (extract(epoch from c.last_review) * 1000)::double precision as last_review,
  c.answered, c.passed, c.clean_reads, to_char(c.last_clean_day, 'YYYY-MM-DD') as last_clean_day,
  (extract(epoch from c.retired) * 1000)::double precision as retired, c.note`;

/** In the queue: not retired, not flagged, not set aside. */
export const ACTIVE = `c.retired is null and c.flagged is null and not c.suspended`;

/**
 * A new word's Read card that hasn't been through Learn yet (learn.ts): it
 * waits there, out of the review and its counts, until it has.
 */
export const WAITING_TO_LEARN = `(c.kind = 'read' and c.state = 0 and c.learned_at is null and c.meaning_id is null)`;

/**
 * Word cards, least likely to be remembered first. FSRS's recall odds fall as
 * the time since the last review grows against the card's stability, so
 * ordering by that ratio, largest first, is ordering by the odds, lowest
 * first; a card never answered anywhere has none and goes first. Ties (every
 * card seeded with the same strength at the same moment) are shuffled, the
 * same way all day so paging through them is stable. Takes the time (ms) and
 * the study day as parameters $at and $day.
 */
const LEAST_LIKELY_FIRST = (at: string, day: string) => `
  case when c.last_review is null or c.stability <= 0 then 1e9
       else extract(epoch from (to_timestamp(${at}::double precision / 1000) - c.last_review)) / 86400.0 / c.stability
  end desc,
  md5(c.id::text || ${day}::text)`;
/**
 * For Fast review: the best-known first, to sweep through. Among due cards the
 * recall odds hardly differ (a card falls due when they reach 90%), and a word
 * forgotten yesterday has high odds only because it was just seen; how long a
 * memory lasts (stability) says better how well a word is known. Cards seeded
 * from Pleco all sit at the seeding cap, so among those Pleco's own score
 * decides (needs \`w\`, the word's row). Then the easier first, then a
 * shuffle. Cards new to both come last.
 */
const BEST_KNOWN_FIRST = (day: string) => `
  (c.last_review is null or c.stability <= 0), c.stability desc, (w.pleco->>'score')::int desc nulls last,
  c.difficulty asc, md5(c.id::text || ${day}::text)`;

export const scheduleOf = (c: CardRow): Schedule => ({
  state: c.state,
  due: Math.round(c.due),
  stability: c.stability,
  difficulty: c.difficulty,
  reps: c.reps,
  lapses: c.lapses,
  scheduledDays: c.scheduled_days,
  lastReview: c.last_review === null ? null : Math.round(c.last_review),
});

const ts = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

// ------------------------------------------------------------------ counts --

export async function getSummary(sql: Sql, owner: string, day: StudyDay): Promise<Omit<Summary, "viewer">> {
  const rows = (await sql.query(
    `with active as (
       select c.* from chongfuxi_card c where c.owner_email = $1 and ${ACTIVE} and not ${WAITING_TO_LEARN}
     ), today as (
       select * from chongfuxi_review where owner_email = $1 and day = $2::date
     )
     select
       -- Suspended words are out of review, so out of the deck's figures too.
       (select count(*) from chongfuxi_word w where w.owner_email = $1 and w.status = 'deck' and not ${SUSPENDED_WORD("w")})::int as words,
       (select count(distinct ch) from chongfuxi_word w, regexp_split_to_table(w.word, '') ch
          where w.owner_email = $1 and w.status = 'deck' and not ${SUSPENDED_WORD("w")} and ch ~ '[一-鿿㐀-䶿]')::int as characters,
       (select count(*) from chongfuxi_card where owner_email = $1 and kind <> 'sentence' and not suspended)::int as word_cards,
       (select count(*) from chongfuxi_card where owner_email = $1 and kind = 'produce' and not suspended)::int as recall_cards,
       (select count(*) from chongfuxi_word where owner_email = $1 and status = 'name')::int as names,
       (select count(*) from chongfuxi_sentence where owner_email = $1)::int as sentences,
       (select count(*) from chongfuxi_sentence where owner_email = $1 and cardinality(blockers) = 0)::int as readable,
       (select count(*) from chongfuxi_sentence where owner_email = $1 and cardinality(blockers) = 1)::int as one_away,
       (select count(*) from chongfuxi_sentence where owner_email = $1 and cardinality(blockers) > 1)::int as locked,
       (select count(distinct a.word) from active a
          where a.kind <> 'sentence' and a.due <= to_timestamp($3::double precision / 1000)
            and not exists (select 1 from today t where t.word = a.word))::int as due_words,
       (select count(*) from active a
          where a.kind = 'read' and a.due <= to_timestamp($3::double precision / 1000)
            and not exists (select 1 from today t where t.word = a.word))::int as due_read,
       (select count(*) from active a
          where a.kind = 'produce' and a.due <= to_timestamp($3::double precision / 1000)
            and not exists (select 1 from today t where t.word = a.word))::int as due_recall,
       (select count(*) from active a
          where a.kind = 'sentence' and a.state <> 0 and a.due <= to_timestamp($3::double precision / 1000))::int as due_sentences,
       (select count(*) from active a where a.kind = 'sentence' and a.state = 0)::int as new_sentences,
       (select count(*) from chongfuxi_card where owner_email = $1 and retired is not null)::int as retired,
       (select count(*) from chongfuxi_card where owner_email = $1 and flagged is not null)::int as flagged,
       (select count(*) from today t where t.cause = 'answer')::int as answered_today,
       (select count(*) from chongfuxi_review
          where owner_email = $1 and day = $2::date - 1 and cause = 'answer')::int as answered_yesterday,
       (select count(*) from active a
          where not (a.kind = 'sentence' and a.state = 0)
            and a.due > to_timestamp($3::double precision / 1000) - interval '1 day'
            and a.due <= to_timestamp($3::double precision / 1000))::int as came_due_today,
       (select count(*) from active a
          where not (a.kind = 'sentence' and a.state = 0)
            and ((a.due > to_timestamp($3::double precision / 1000)
                  and a.due <= to_timestamp($3::double precision / 1000) + interval '1 day')
              or (a.kind <> 'sentence' and a.due <= to_timestamp($3::double precision / 1000)
                  and exists (select 1 from today t where t.word = a.word))))::int as due_tomorrow,
       (select count(*) from chongfuxi_card c
          where c.owner_email = $1 and ${ACTIVE} and ${WAITING_TO_LEARN})::int as to_learn`,
    [owner, day.day, day.cutoff],
  )) as unknown as Array<Record<string, number>>;
  const r = rows[0];
  return {
    words: r.words,
    characters: r.characters,
    wordCards: r.word_cards,
    recallCards: r.recall_cards,
    names: r.names,
    sentences: r.sentences,
    readable: r.readable,
    oneAway: r.one_away,
    locked: r.locked,
    dueWords: r.due_words,
    dueRead: r.due_read,
    dueRecall: r.due_recall,
    dueSentences: r.due_sentences,
    newSentences: r.new_sentences,
    retired: r.retired,
    flagged: r.flagged,
    answeredToday: r.answered_today,
    answeredYesterday: r.answered_yesterday,
    cameDueToday: r.came_due_today,
    dueTomorrow: r.due_tomorrow,
    toLearn: r.to_learn,
  };
}

// ------------------------------------------------------------------- queue --

export interface QueueOptions {
  limit: number;
  /** Cards the session has dealt so far, so the mix carries on. */
  position: number;
  /** Cards the device already holds or has just answered. */
  exclude: number[];
  /** Words answered this session whose answer may not have landed yet. */
  skipWords: string[];
  /** Leave Read cards out. */
  read?: boolean;
  /** Leave Recall cards out: recognition only. */
  recall?: boolean;
  /** Leave sentence cards out, new ones included. */
  sentences?: boolean;
  /** Only the word cards of this list (and the lists under it, or 龙库); no sentences. */
  list?: string;
  /** Keep going once nothing is due: new sentences only, from the whole pool. */
  more?: boolean;
  at?: number;
}

/**
 * The next cards, with everything needed to draw them.
 *
 * One queue of everything due before the study day ends: word cards, sentence
 * cards, and new sentences up to the day's allowance. Cards of a word already
 * seen today are held back — the same word never twice in a day — and so is
 * the second card of a word within one batch.
 */
export async function nextCards(sql: Sql, owner: string, day: StudyDay, o: QueueOptions): Promise<SessionCard[]> {
  const at = o.at ?? Date.now();
  const cutoff = day.cutoff;
  const inList = o.list === undefined ? null : onList(o.list, "c.word", 9);

  const words = (await sql.query(
    `select ${CARD_COLUMNS}
     from chongfuxi_card c
     where c.owner_email = $1 and c.kind = any($7::text[]) and ${ACTIVE} and not ${WAITING_TO_LEARN}
       and c.due <= to_timestamp($2::double precision / 1000)
       and not (c.id = any($3::bigint[]))
       and not (c.word = any($4::text[]))
       and not exists (
         select 1 from chongfuxi_review r
         where r.owner_email = c.owner_email and r.day = $5::date and r.word = c.word
       )
       ${inList ? `and ${inList.where}` : ""}
     order by ${LEAST_LIKELY_FIRST("$8", "$5")}
     limit $6`,
    [
      owner,
      cutoff,
      o.exclude,
      o.skipWords,
      day.day,
      o.limit * WORD_POOL_FACTOR,
      [...(o.read === false ? [] : ["read"]), ...(o.recall === false ? [] : ["produce"])],
      at,
      ...(inList?.params ?? []),
    ],
  )) as unknown as CardRow[];
  const seen = new Set<string>();
  const wordCards = words.filter((c) => !seen.has(c.word!) && seen.add(c.word!));

  // A list's review is its words only.
  const withSentences = o.sentences !== false && !inList;
  const dueSentences = !withSentences ? [] : (await sql.query(
    `select ${CARD_COLUMNS}
     from chongfuxi_card c
     where c.owner_email = $1 and c.kind = 'sentence' and ${ACTIVE} and c.state <> 0
       and c.due <= to_timestamp($2::double precision / 1000)
       and not (c.id = any($3::bigint[]))
     order by c.due, c.id
     limit $4`,
    [owner, cutoff, o.exclude, o.limit],
  )) as unknown as CardRow[];

  // New sentences, from the whole readable pool: no daily limit. While cards
  // are due they come one in four among them (the mix); once nothing is due,
  // none, until the owner asks to keep going (`more`), and then only they.
  // First the ones a word just unlocked, newest first. Then one for each
  // word before any word gets a second, each sentence going by the deck word
  // that most needs it: one due today or just forgotten (relearning) first,
  // then the weakest (a Read card new here and unscored in Pleco, then the
  // lowest stability, Pleco's score for a card not yet answered here), a
  // word still waiting for Learn last. A word never yet read in a sentence
  // breaks a tie; past that a fixed shuffle, so sources and lengths are mixed.
  const due = wordCards.length + dueSentences.length;
  const left = !withSentences ? 0 : o.more ? o.limit : Math.min(o.limit, Math.ceil(due / DUE_PER_NEW));
  const fresh = left
    ? ((await sql.query(
        `with cand as (
           select c.id, s.id as sid, s.key, s.unlocked_by, s.unlocked_at
           from chongfuxi_card c
           join chongfuxi_sentence s on s.owner_email = c.owner_email and s.id = c.sentence_id
           where c.owner_email = $1 and c.kind = 'sentence' and ${ACTIVE} and c.state = 0
             and not (c.id = any($2::bigint[]))
         ),
         weakest as (
           select distinct on (t.sentence_id) t.sentence_id as sid, w.word, w.exposures,
                  case when r.state = 0 then 0 else r.stability end as strength,
                  case when ${WAITING_TO_LEARN.replaceAll("c.", "r.")} then 2
                       when r.due <= to_timestamp($4::double precision / 1000) or r.state = 3 then 0
                       else 1 end as need
           from chongfuxi_token t
           join cand on cand.sid = t.sentence_id
           join chongfuxi_word w on w.owner_email = t.owner_email and w.word = t.word and w.status = 'deck'
           join chongfuxi_card r on r.owner_email = w.owner_email and r.word = w.word and r.kind = 'read' and r.meaning_id is null
           where t.owner_email = $1
           order by t.sentence_id, need, strength, w.exposures, w.word
         ),
         ranked as (
           select cand.id, cand.key, cand.unlocked_by, cand.unlocked_at, k.word, k.need, k.strength, k.exposures,
                  row_number() over (partition by coalesce(k.word, cand.key) order by k.need, md5(cand.key), cand.sid) as turn
           from cand left join weakest k on k.sid = cand.sid
         )
         select ${CARD_COLUMNS}, x.unlocked_by as why_unlocked, x.word as why_word, x.need as why_need
         from ranked x join chongfuxi_card c on c.owner_email = $1 and c.id = x.id
         order by (x.unlocked_by is not null) desc,
                  case when x.unlocked_by is not null then x.unlocked_at end desc nulls last,
                  x.turn, x.need nulls last, x.strength nulls last, (x.exposures = 0) desc, md5(x.key), c.id
         limit $3`,
        [owner, o.exclude, left, cutoff],
      )) as unknown as Array<CardRow & { why_unlocked: string | null; why_word: string | null; why_need: number | null }>)
    : [];

  const picked = o.more ? fresh.slice(0, o.limit) : interleave({ word: wordCards, sentence: dueSentences, new: fresh }, o.position, o.limit);
  if (!picked.length) return [];
  // What put each card where it is, for Settings › Algorithm.
  const overdue = (c: CardRow) => Math.max(0, (at - c.due) / DAY_MS);
  const why = new Map<number, QueueWhy>([
    ...wordCards.map((c): [number, QueueWhy] => [c.id, { line: "word", odds: recallOdds(scheduleOf(c), at), overdueDays: overdue(c) }]),
    ...dueSentences.map((c): [number, QueueWhy] => [c.id, { line: "sentence", overdueDays: overdue(c), cleanReads: c.clean_reads }]),
    ...fresh.map((c): [number, QueueWhy] => [
      c.id,
      {
        line: "new",
        unlockedBy: c.why_unlocked,
        forWord: c.why_word,
        need: c.why_need === 0 ? "due" : c.why_need === 1 ? "weak" : c.why_need === 2 ? "learn" : null,
      },
    ]),
  ]);
  return (await dress(sql, owner, picked, day, at)).map((c) => ({ ...c, why: why.get(c.id) }));
}

/**
 * Fast review: every Read card due today, the word alone, best known first,
 * so the easy ones go by quickly.
 * A word answered today waits, as in a session; split-off meanings are left
 * out, since the word alone doesn't say which meaning is asked.
 */
export async function fastCards(
  sql: Sql,
  owner: string,
  day: StudyDay,
  offset: number,
  limit: number,
  at = Date.now(),
): Promise<{ cards: FastCard[]; total: number | null }> {
  const where = `c.owner_email = $1 and c.kind = 'read' and c.meaning_id is null and ${ACTIVE} and not ${WAITING_TO_LEARN}
       and c.due <= to_timestamp($2::double precision / 1000)
       and not exists (
         select 1 from chongfuxi_review r
         where r.owner_email = c.owner_email and r.day = $3::date and r.word = c.word
       )`;
  const rows = (await sql.query(
    `select ${CARD_COLUMNS}, w.pinyin, w.defs, jsonb_array_length(w.defs) > 0 as has_defs
     from chongfuxi_card c
     join chongfuxi_word w on w.owner_email = c.owner_email and w.word = c.word
     where ${where}
     order by ${BEST_KNOWN_FIRST("$3")}
     limit $4 offset $5`,
    [owner, day.cutoff, day.day, limit, offset],
  )) as unknown as Array<CardRow & { pinyin: string | null; defs: Definition[]; has_defs: boolean }>;
  const total = offset
    ? null
    : Number(
        ((await sql.query(`select count(*) as n from chongfuxi_card c where ${where}`, [owner, day.cutoff, day.day])) as unknown as Array<{
          n: string;
        }>)[0].n,
      );
  return {
    total,
    cards: rows.map((c) => {
      const schedule = scheduleOf(c);
      return {
        id: c.id,
        word: c.word!,
        pinyin: shownPinyin(c.pinyin, c.defs),
        gloss: promptSenses(c.defs, c.pinyin).slice(0, 2).join("; ") || null,
        intervals: intervals(schedule, at),
        was: waitOf(schedule),
        opensRecall: c.passed === 0 && c.has_defs,
      };
    }),
  };
}

/** A card's own answers here (oldest first), after whatever Pleco recorded for the same thing. */
function historyFrom(here: Array<{ grade: Grade; at: number }>, pleco: PlecoSeed | null): CardHistory {
  // Pleco writes a digit per answer, oldest first: 6 for right, 2 for wrong.
  const before = [...(pleco?.history ?? "")].map((d): Grade => (d >= "4" ? "good" : "forgot"));
  const last = here[here.length - 1];
  return {
    pleco: before,
    here: here.map((a) => a.grade),
    lastAt: last ? Math.round(last.at) : pleco?.last ? pleco.last * 1000 : null,
    lastIn: last ? "here" : pleco?.last ? "pleco" : null,
  };
}

/** Everything a card needs to be drawn: the word, its meanings, a sentence, its words. */
async function dress(sql: Sql, owner: string, cards: CardRow[], day: StudyDay, at: number): Promise<SessionCard[]> {
  const wordList = [...new Set(cards.filter((c) => c.word).map((c) => c.word!))];

  const wordRows = wordList.length
    ? ((await sql`
        select word, pinyin, defs, pleco, lists from chongfuxi_word
        where owner_email = ${owner} and word = any(${wordList}::text[])
      `) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[]; pleco: PlecoSeed | null; lists: string[] | null }>)
    : [];
  const answers = (await sql`
    select card_id::int as card, grade, (extract(epoch from at) * 1000)::double precision as at
    from chongfuxi_review
    where owner_email = ${owner} and card_id = any(${cards.map((c) => c.id)}::bigint[])
    order by seq
  `) as unknown as Array<{ card: number; grade: Grade; at: number }>;
  const historyOf = (c: CardRow, pleco: PlecoSeed | null): CardHistory =>
    historyFrom(
      answers.filter((a) => a.card === c.id),
      pleco,
    );
  const meaningRows = wordList.length
    ? ((await sql`
        select id::int as id, word, gloss from chongfuxi_meaning
        where owner_email = ${owner} and merged is null and word = any(${wordList}::text[])
        order by id
      `) as unknown as Array<{ id: number; word: string; gloss: string }>)
    : [];
  const inLongku = await longkuWords(sql, owner, wordList);
  const infoOf = new Map<string, WordInfo>(
    wordRows.map((w) => [
      w.word,
      {
        word: w.word,
        pinyin: shownPinyin(w.pinyin, w.defs),
        defs: w.defs,
        split: meaningRows.filter((m) => m.word === w.word).map(({ id, gloss }) => ({ id, gloss })),
        hsk: hskOf(w.lists ?? []),
        longku: inLongku.has(w.word),
      },
    ]),
  );

  // Readable sentences each word appears in, a few per word, best first:
  // full sentences only, where the word has any; those several decks share
  // (the textbook examples) before those only one has; a natural length
  // (about nine characters) before a terse scrap or a long one; a labelled
  // proverb (【谚】) last. Then, below, those where the word is only part of
  // a compound go after the rest, and for Recall those that give the blank away.
  const contexts = wordList.length
    ? ((await sql`
        select x.word, x.id, x.zh, x.en, x.sources, x.rn::int as rn, x.n::int as n
        from (
          select t.word, s.id::int as id, s.zh, s.en, s.sources,
                 row_number() over (
                   partition by t.word
                   order by (char_length(s.key) < ${CONTEXT_MIN_HAN}), (s.zh ~ '^\s*【'), cardinality(s.sources) desc,
                            abs(char_length(s.key) - ${CONTEXT_IDEAL_HAN}), s.id
                 ) as rn,
                 count(*) over (partition by t.word) as n,
                 count(*) filter (where char_length(s.key) >= ${CONTEXT_MIN_HAN}) over (partition by t.word) as whole
          from (
            select distinct word, sentence_id from chongfuxi_token
            where owner_email = ${owner} and word = any(${wordList}::text[])
          ) t
          join chongfuxi_sentence s on s.owner_email = ${owner} and s.id = t.sentence_id
          where cardinality(s.blockers) = 0
        ) x
        where x.rn <= ${CONTEXT_CANDIDATES} and (x.whole = 0 or x.rn <= x.whole)
      `) as unknown as Array<{ word: string; id: number; zh: string; en: string | null; sources: string[]; rn: number; n: number }>)
    : [];
  // A word with no readable sentence of its own (县, only ever met in 县城)
  // is shown in one where it is part of a longer word, the word marked in it,
  // rather than alone: the owner asked, having found it in Look up.
  const without = wordList.filter((w) => !contexts.some((x) => x.word === w));
  if (without.length) {
    const inside = (await sql`
      select x.word, x.id, x.zh, x.en, x.sources, x.rn::int as rn, x.n::int as n
      from (
        select w.word, s.id::int as id, s.zh, s.en, s.sources,
               row_number() over (
                 partition by w.word
                 order by (char_length(s.key) < ${CONTEXT_MIN_HAN}), (s.zh ~ '^\s*【'), cardinality(s.sources) desc,
                          abs(char_length(s.key) - ${CONTEXT_IDEAL_HAN}), s.id
               ) as rn,
               count(*) over (partition by w.word) as n
        from unnest(${without}::text[]) w(word)
        join chongfuxi_sentence s on s.owner_email = ${owner} and cardinality(s.blockers) = 0 and strpos(s.key, w.word) > 0
      ) x
      where x.rn <= ${CONTEXT_CANDIDATES}
    `) as unknown as typeof contexts;
    contexts.push(...inside);
  }

  const chosen = new Map<number, { id: number; zh: string; en: string | null; sources: string[] }>();
  for (const c of cards) {
    // A split-off meaning is shown without a sentence: nothing says yet which
    // sentences use the word in that sense.
    if (!c.word || c.meaning_id !== null) continue;
    const recall = c.kind === "produce";
    const headwords = loadHeadwords();
    const mine = contexts
      .filter((x) => x.word === c.word)
      .map((x) => ({ ...x, fit: contextFit(x.zh, x.word, (w) => headwords.has(w)) }))
      .map((x) => ({ ...x, worse: Number(x.fit.bound) + (recall && x.fit.repeated ? 2 : 0) }))
      .sort((a, b) => a.worse - b.worse || a.rn - b.rn)
      .slice(0, CONTEXT_POOL);
    if (!mine.length) continue;
    // A different sentence each time, and not the one the word's other card is on.
    const pick = mine[(c.answered + (recall ? 1 : 0)) % mine.length];
    chosen.set(c.id, { id: pick.id, zh: pick.zh, en: pick.en, sources: pick.sources });
  }

  const sentenceIds = [...new Set([...cards.filter((c) => c.sentence_id).map((c) => c.sentence_id!), ...[...chosen.values()].map((s) => s.id)])];
  const sentenceOf = await sentenceDresser(sql, owner, sentenceIds);
  const own = cards.filter((c) => c.sentence_id).map((c) => c.sentence_id!);
  const ownRows = own.length
    ? ((await sql`
        select id::int as id, zh, en, pleco, sources from chongfuxi_sentence
        where owner_email = ${owner} and id = any(${own}::bigint[])
      `) as unknown as Array<{ id: number; zh: string; en: string | null; pleco: PlecoSeed | null; sources: string[] }>)
    : [];

  // A rescued word still recovering shows its rescue's hook (rescue.ts); a compared one, how it differs (synonyms.ts).
  const hooks = await rescueHooks(sql, owner, wordList);
  const contrasts = await contrastsFor(sql, owner, wordList);
  const out: SessionCard[] = [];
  for (const c of cards) {
    const schedule = scheduleOf(c);
    const base = { id: c.id, kind: c.kind, note: c.note, intervals: intervals(schedule, at), isNew: c.state === 0 };
    if (c.kind === "sentence") {
      const progress = { cleanReads: c.clean_reads, lastCleanDay: c.last_clean_day, retired: false };
      const row = ownRows.find((s) => s.id === c.sentence_id);
      out.push({
        ...base,
        history: historyOf(c, row?.pleco ?? null),
        sentence: sentenceOf(row),
        cleanReads: c.clean_reads,
        wouldRetire: readSentence(progress, "good", day.day).retired,
      });
      continue;
    }
    const word = infoOf.get(c.word!);
    if (!word) continue;
    const meaning = c.meaning_id === null ? null : (word.split.find((m) => m.id === c.meaning_id) ?? null);
    // Pleco tested recognition of the word as a whole, so its record belongs to that card only.
    const plecoRecord = c.kind === "read" && c.meaning_id === null ? (wordRows.find((w) => w.word === c.word)?.pleco ?? null) : null;
    const card: SessionCard = {
      ...base,
      history: historyOf(c, plecoRecord),
      word,
      meaning,
      sentence: sentenceOf(chosen.get(c.id)),
      hook: hooks.get(c.word!) ?? null,
      contrast: contrasts.get(c.word!) ?? null,
    };
    if (c.kind === "produce") {
      // Other deck words with the same meaning, so "I said 快乐" can be judged against 高兴.
      const senses = meaning ? [meaning.gloss.toLowerCase()] : promptSenses(word.defs, word.pinyin).map((s) => s.toLowerCase());
      const others = senses.length
        ? ((await sql`
            select word from chongfuxi_word
            where owner_email = ${owner} and status = 'deck' and word <> ${word.word}
              and glosses && ${senses}::text[]
            order by char_length(word), word
            limit 6
          `) as unknown as Array<{ word: string }>)
        : [];
      card.alternatives = others.map((o) => o.word);
    }
    out.push(card);
  }
  return out;
}

/**
 * For drawing sentences: their words in order, and each word's reading and
 * meaning for a tap. Returns a function from a sentence row (one of `sentenceIds`)
 * to what a card shows.
 */
export async function sentenceDresser(
  sql: Sql,
  owner: string,
  sentenceIds: number[],
): Promise<(s: { id: number; zh: string; en: string | null; sources: string[] } | undefined) => SentenceInfo | null> {
  const tokenRows = sentenceIds.length
    ? ((await sql`
        select sentence_id::int as id, array_agg(word order by pos) as words
        from chongfuxi_token
        where owner_email = ${owner} and sentence_id = any(${sentenceIds}::bigint[])
        group by sentence_id
      `) as unknown as Array<{ id: number; words: string[] }>)
    : [];
  const wordsOf = new Map(tokenRows.map((t) => [t.id, t.words]));
  const lookOf = await wordLooks(sql, owner, tokenRows.flatMap((t) => t.words));
  return (s: { id: number; zh: string; en: string | null; sources: string[] } | undefined): SentenceInfo | null => {
    if (!s) return null;
    const words = wordsOf.get(s.id) ?? [];
    return { id: s.id, zh: zhShown(s.zh), en: s.en, words, looks: words.map(lookOf), sources: s.sources };
  };
}

/**
 * The reading and short meaning of each of these words, for a tap: the word's
 * own row where it has one, the dictionary otherwise (lib/readings.ts).
 */
export async function wordLooks(sql: Sql, owner: string, words: string[]): Promise<(w: string) => Looked | null> {
  const unique = [...new Set(words)];
  const rows = unique.length
    ? new Map(
        ((await sql`
          select word, pinyin, defs from chongfuxi_word
          where owner_email = ${owner}
            and word = any(${[...new Set(unique.flatMap((w) => [w, ...w]))]}::text[])
        `) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[] }>).map((r) => [r.word, r]),
      )
    : new Map<string, { word: string; pinyin: string | null; defs: Definition[] }>();
  const lookup: Lookup = (w, want) => {
    const row = rows.get(w);
    const p = row && shownPinyin(row.pinyin, row.defs);
    // The row's own meaning, unless a particle's running reading is asked
    // for and the row has another (a 了 card for liǎo).
    if (row && p && (!want || want === p)) return { p, gloss: promptSenses(row.defs, p).slice(0, 2).join("; ") || null };
    return dictEntry(w, want);
  };
  const looked = new Map<string, Looked | null>();
  return (w: string) => {
    if (!looked.has(w)) looked.set(w, lookUp(w, lookup));
    return looked.get(w)!;
  };
}

/** A word's levels in the two HSK schemes, from the Pleco lists it is in. */
export function hskOf(lists: string[]): WordInfo["hsk"] {
  const level = (top: string) => {
    const l = lists.find((x) => x.startsWith(`${top}/`));
    return l ? (l.slice(top.length + 1).match(/\d+(-\d+)?/)?.[0] ?? null) : null;
  };
  return { old: level("HSK 2012-2021"), v3: level("HSK 3.0") };
}

/**
 * The senses shown where one meaning has room: the first few of the entry the
 * word is learnt as, those the sentence (`en`) is about first (lib/senses.ts).
 */
export function promptSenses(defs: Definition[], pinyin: string | null, en?: string | null): string[] {
  return mainSenses(defs, pinyin, { en });
}

// ------------------------------------------------------------------ answer --

interface Snapshot extends Schedule {
  cleanReads?: number;
  retired?: boolean;
}

const NOTHING: ReviewResult = {
  duplicate: false,
  days: null,
  retired: false,
  produceOpened: false,
  lapsed: [],
  revived: 0,
  was: null,
  odds: null,
  difficulty: { before: null, after: 0 },
  cleanReads: null,
  exposed: [],
  firstSeen: [],
  lapses: [],
  revivedSentences: [],
  recallIn: null,
};

/** Days a card had been set to wait, for the receipt; a new card has none. */
const waitOf = (s: Schedule): number | null => (s.state === 0 ? null : Math.max(1, s.scheduledDays));

/** How long an answer may wait on the device and still keep its own time. */
const HELD_MAX_MS = 30 * DAY_MS;

/**
 * When an answer was given, by the server's clock. A device's clock can be
 * wrong, so its own time is taken only when it is near the server's. An
 * answer that waited on the device (sent from the outbox, after the
 * connection came back) also carries when it was sent, by the same clock:
 * the gap between the two is how long ago it was given, whatever that clock
 * says.
 */
export function answeredAt(input: Pick<ReviewInput, "at" | "sentAt">, now: number): number {
  if (input.sentAt !== undefined) {
    const ago = input.sentAt - input.at;
    if (ago >= 0 && ago <= HELD_MAX_MS) return now - ago;
  }
  return Math.abs(input.at - now) < DAY_MS / 2 ? input.at : now;
}

/**
 * Record an answer and everything that follows from it.
 *
 * @param trustClock  take the answer's own time as given. Routes don't — a
 *                    device with a wrong clock would schedule into the past —
 *                    but the check script answers on days it makes up.
 */
export async function submitReview(sql: Sql, owner: string, input: ReviewInput, trustClock = false): Promise<ReviewResult> {
  const already = (await sql`
    select 1 from chongfuxi_review where owner_email = ${owner} and id = ${input.id}
  `) as unknown as unknown[];
  if (already.length) return { ...NOTHING, duplicate: true };

  const found = (await sql.query(
    `select ${CARD_COLUMNS} from chongfuxi_card c where c.owner_email = $1 and c.id = $2 and ${ACTIVE}`,
    [owner, input.cardId],
  )) as unknown as CardRow[];
  const card = found[0];
  if (!card) throw new ReviewError("That card isn't in the queue.");

  const at = trustClock ? input.at : answeredAt(input, Date.now());
  const before = scheduleOf(card);
  const after = answer(before, input.grade, at);
  const good = input.grade === "good";
  const shown = card.kind === "sentence" ? card.sentence_id : (input.sentenceId ?? null);

  const effects: {
    produce?: boolean;
    revived?: number[];
    lapsed?: string[];
    cutoff?: number;
    /** What taking the answer back needs: every card it moved, as it was, and the words it counted as read. */
    prior?: unknown;
    exposed?: string[];
  } = {};
  const statements = [];
  let snapshotBefore: Snapshot = before;
  let snapshotAfter: Snapshot = after;
  let retired = false;
  const revive = new Set<number>();
  const lapses: Array<{ word: string; card: CardRow; after: Schedule }> = [];
  // For the receipt.
  let cleanReads: ReviewResult["cleanReads"] = null;
  let recallIn: number | null = null;
  let exposed: string[] = [];

  if (card.kind === "sentence") {
    const progress = readSentence(
      { cleanReads: card.clean_reads, lastCleanDay: card.last_clean_day, retired: false },
      input.grade,
      input.day,
    );
    retired = progress.retired;
    cleanReads = { before: card.clean_reads, now: progress.cleanReads, need: CLEAN_READS_TO_RETIRE };
    snapshotBefore = { ...before, cleanReads: card.clean_reads, retired: false };
    snapshotAfter = { ...after, cleanReads: progress.cleanReads, retired };

    const tokens = (await sql`
      select word from chongfuxi_token
      where owner_email = ${owner} and sentence_id = ${card.sentence_id} order by pos
    `) as unknown as Array<{ word: string }>;
    const inSentence = new Set(tokens.map((t) => t.word));
    const tapped = good ? [] : [...new Set(input.tapped ?? [])].filter((w) => inSentence.has(w));

    if (tapped.length) {
      // The words that lapse: the tapped ones that are in the deck, or the
      // deck words a tapped compound is made of.
      const deck = (await sql`
        select word from chongfuxi_word
        where owner_email = ${owner} and status = 'deck' and word = any(${piecesOf(tapped)}::text[])
      `) as unknown as Array<{ word: string }>;
      const targets = lapseTargets(tapped, new Set(deck.map((d) => d.word)));
      const cards = targets.length
        ? ((await sql.query(
            `select ${CARD_COLUMNS} from chongfuxi_card c
             where c.owner_email = $1 and c.kind = 'read' and c.meaning_id is null and c.word = any($2::text[])`,
            [owner, targets],
          )) as unknown as CardRow[])
        : [];
      for (const c of cards) lapses.push({ word: c.word!, card: c, after: answer(scheduleOf(c), "forgot", at) });
      for (const l of lapses) {
        const other = await retiredWith(sql, owner, l.word, card.sentence_id!, [...revive]);
        if (other !== null) revive.add(other);
      }
    }

    // Reading a sentence is seeing its words in context — except the ones that tripped.
    const read = tokens.map((t) => t.word).filter((w) => !tapped.includes(w));
    if (read.length) {
      exposed = [...new Set(read)];
      statements.push(sql`
        update chongfuxi_word set exposures = exposures + 1
        where owner_email = ${owner} and word = any(${exposed}::text[])
      `);
    }
    statements.push(sql`
      update chongfuxi_card
      set state = ${after.state}, due = ${ts(after.due)}::timestamptz, stability = ${after.stability},
          difficulty = ${after.difficulty}, reps = ${after.reps}, lapses = ${after.lapses},
          scheduled_days = ${after.scheduledDays}, last_review = ${ts(after.lastReview)}::timestamptz,
          answered = answered + 1, passed = passed + ${good ? 1 : 0},
          clean_reads = ${progress.cleanReads}, last_clean_day = ${progress.lastCleanDay}::date,
          retired = ${retired ? ts(at) : null}::timestamptz
      where owner_email = ${owner} and id = ${card.id}
    `);
  } else {
    statements.push(sql`
      update chongfuxi_card
      set state = ${after.state}, due = ${ts(after.due)}::timestamptz, stability = ${after.stability},
          difficulty = ${after.difficulty}, reps = ${after.reps}, lapses = ${after.lapses},
          scheduled_days = ${after.scheduledDays}, last_review = ${ts(after.lastReview)}::timestamptz,
          answered = answered + 1, passed = passed + ${good ? 1 : 0}
      where owner_email = ${owner} and id = ${card.id}
    `);

    if (good) {
      if (shown !== null) {
        exposed = [card.word!];
        statements.push(sql`
          update chongfuxi_word set exposures = exposures + 1
          where owner_email = ${owner} and word = ${card.word}
        `);
      }
      // Recognising it once opens the harder card: recalling it from its meaning.
      if (card.kind === "read" && card.passed === 0) {
        const produce = await produceSeed(sql, owner, card, at);
        if (produce) {
          effects.produce = true;
          recallIn = Math.max(0, Math.round((produce.due - at) / DAY_MS));
          statements.push(sql`
            insert into chongfuxi_card
              (owner_email, kind, word, meaning_id, state, due, stability, difficulty, reps, lapses, scheduled_days, last_review)
            values (${owner}, 'produce', ${card.word}, ${card.meaning_id}, ${produce.state}, ${ts(produce.due)}::timestamptz,
                    ${produce.stability}, ${produce.difficulty}, ${produce.reps}, ${produce.lapses},
                    ${produce.scheduledDays}, ${ts(produce.lastReview)}::timestamptz)
            on conflict do nothing
          `);
        }
      }
    } else {
      // Forgetting a word brings back the sentence it was shown in, if that had
      // retired, and one other retired sentence that has the word.
      if (shown !== null) {
        const same = (await sql`
          select id::int as id from chongfuxi_card
          where owner_email = ${owner} and kind = 'sentence' and sentence_id = ${shown}
            and retired is not null and not suspended
        `) as unknown as Array<{ id: number }>;
        if (same[0]) revive.add(same[0].id);
      }
      const other = await retiredWith(sql, owner, card.word!, shown ?? 0, [...revive]);
      if (other !== null) revive.add(other);
    }
  }

  if (revive.size) {
    effects.revived = [...revive];
    effects.cutoff = input.cutoff;
    // Back in the queue from tomorrow, one clean read from retiring again.
    statements.push(sql`
      update chongfuxi_card
      set retired = null, clean_reads = ${REVIVED_CLEAN_READS}, due = ${ts(input.cutoff)}::timestamptz
      where owner_email = ${owner} and id = any(${[...revive]}::bigint[])
    `);
  }
  if (lapses.length) effects.lapsed = lapses.map((l) => l.word);
  if (exposed.length) effects.exposed = exposed;
  // Every card this answer moves, as it stands now, so the answer can be taken back.
  const touched = [card.id, ...lapses.map((l) => l.card.id), ...revive];
  effects.prior = ((await sql`
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'state', state, 'due', due, 'stability', stability, 'difficulty', difficulty, 'reps', reps,
      'lapses', lapses, 'scheduled_days', scheduled_days, 'last_review', last_review, 'answered', answered,
      'passed', passed, 'clean_reads', clean_reads, 'last_clean_day', last_clean_day, 'retired', retired
    )), '[]'::jsonb) as prior
    from chongfuxi_card where owner_email = ${owner} and id = any(${touched}::bigint[])
  `) as unknown as Array<{ prior: unknown }>)[0].prior;

  const row = (r: {
    id: string;
    card: CardRow;
    cause: "answer" | "tapped";
    parent: string | null;
    grade: string;
    before: Snapshot;
    after: Snapshot;
    tapped: string[];
    effects: object;
    ms: number | null;
    revealMs: number | null;
    comment?: string | null;
  }) => sql`
    insert into chongfuxi_review
      (owner_email, id, at, day, session, card_id, kind, word, meaning_id, sentence_id, grade, ms, reveal_ms,
       tapped, cause, parent, scheduler, before, after, effects, tz, utc_offset, position, device, comment)
    values (${owner}, ${r.id}, ${ts(at)}::timestamptz, ${input.day}::date, ${input.session}, ${r.card.id}, ${r.card.kind},
            ${r.card.word}, ${r.card.meaning_id}, ${shown}, ${r.grade}, ${r.ms}, ${r.revealMs},
            ${r.tapped}::text[], ${r.cause}, ${r.parent}, ${SCHEDULER},
            ${JSON.stringify(r.before)}::jsonb, ${JSON.stringify(r.after)}::jsonb, ${JSON.stringify(r.effects)}::jsonb,
            ${input.tz ?? null}, ${input.utcOffset ?? null}, ${input.position ?? null}, ${input.device ?? null},
            ${r.comment ?? null})
  `;

  // The answer first, so a repeat of the same id fails before anything moves.
  statements.unshift(
    row({
      id: input.id,
      card,
      cause: "answer",
      parent: null,
      grade: input.grade,
      before: snapshotBefore,
      after: snapshotAfter,
      tapped: card.kind === "sentence" && !good ? [...new Set(input.tapped ?? [])] : [],
      effects,
      ms: input.ms ?? null,
      revealMs: input.revealMs ?? null,
      comment: good ? null : input.comment?.trim() || null,
    }),
  );
  for (const l of lapses) {
    statements.push(
      row({
        id: `${input.id}:${l.word}`,
        card: l.card,
        cause: "tapped",
        parent: input.id,
        grade: "forgot",
        before: scheduleOf(l.card),
        after: l.after,
        tapped: [],
        effects: {},
        ms: null,
        revealMs: null,
      }),
    );
    statements.push(sql`
      update chongfuxi_card
      set state = ${l.after.state}, due = ${ts(l.after.due)}::timestamptz, stability = ${l.after.stability},
          difficulty = ${l.after.difficulty}, reps = ${l.after.reps}, lapses = ${l.after.lapses},
          scheduled_days = ${l.after.scheduledDays}, last_review = ${ts(l.after.lastReview)}::timestamptz,
          answered = answered + 1
      where owner_email = ${owner} and id = ${l.card.id}
    `);
  }

  // Read before anything moves: which of the words read are the deck's, and
  // which had never been met in a sentence; and the sentences coming back.
  const met = exposed.length
    ? ((await sql`
        select word, exposures from chongfuxi_word
        where owner_email = ${owner} and status = 'deck' and word = any(${exposed}::text[])
      `) as unknown as Array<{ word: string; exposures: number }>)
    : [];
  const inOrder = (words: string[]) => exposed.filter((w) => words.includes(w));
  const back = revive.size
    ? ((await sql`
        select s.zh from chongfuxi_card c
        join chongfuxi_sentence s on s.owner_email = c.owner_email and s.id = c.sentence_id
        where c.owner_email = ${owner} and c.id = any(${[...revive]}::bigint[])
        order by c.id
      `) as unknown as Array<{ zh: string }>)
    : [];

  await sql.transaction(statements);

  return {
    duplicate: false,
    days: retired ? null : Math.max(1, Math.round((after.due - at) / DAY_MS)),
    retired,
    produceOpened: Boolean(effects.produce),
    lapsed: effects.lapsed ?? [],
    revived: revive.size,
    was: waitOf(before),
    odds: recallOdds(before, at),
    difficulty: { before: before.state === 0 ? null : before.difficulty, after: after.difficulty },
    cleanReads,
    exposed: inOrder(met.map((m) => m.word)),
    firstSeen: inOrder(met.filter((m) => m.exposures === 0).map((m) => m.word)),
    lapses: lapses.map((l) => ({
      word: l.word,
      was: waitOf(scheduleOf(l.card)),
      days: Math.max(1, Math.round((l.after.due - at) / DAY_MS)),
    })),
    revivedSentences: back.map((b) => b.zh),
    recallIn,
  };
}

/** Whether a request body is an answer as the page sends it. */
export function isReviewInput(r: ReviewInput | null): r is ReviewInput {
  return (
    !!r &&
    typeof r.id === "string" &&
    r.id.length > 0 &&
    r.id.length <= 64 &&
    !r.id.includes(":") &&
    Number.isInteger(r.cardId) &&
    (r.grade === "good" || r.grade === "forgot") &&
    typeof r.at === "number" &&
    typeof r.session === "string" &&
    isStudyDay(r) &&
    (r.tapped === undefined || (Array.isArray(r.tapped) && r.tapped.length <= 60 && r.tapped.every((w) => typeof w === "string"))) &&
    (r.comment === undefined || (typeof r.comment === "string" && r.comment.length <= 1000)) &&
    (r.tz === undefined || (typeof r.tz === "string" && r.tz.length <= 64)) &&
    (r.utcOffset === undefined || (Number.isInteger(r.utcOffset) && Math.abs(r.utcOffset) <= 16 * 60)) &&
    (r.position === undefined || (Number.isInteger(r.position) && r.position > 0)) &&
    (r.device === undefined || (typeof r.device === "string" && r.device.length <= 20)) &&
    (r.sentAt === undefined || Number.isFinite(r.sentAt))
  );
}

export class ReviewError extends Error {}

/**
 * Take back the last answer, as if it had never been given: every card it
 * moved goes back to how it was, a Recall card it opened goes, its words lose
 * the reading it counted, and the answer leaves the log. Only the latest
 * answer, so nothing after it can depend on it.
 */
export async function undoReview(sql: Sql, owner: string, id: string): Promise<{ cardId: number }> {
  const found = (await sql`
    select r.card_id::int as card_id, r.kind, r.word, r.meaning_id, r.effects,
           exists (
             select 1 from chongfuxi_review l
             where l.owner_email = r.owner_email and l.cause = 'answer' and l.seq > r.seq
           ) as superseded
    from chongfuxi_review r
    where r.owner_email = ${owner} and r.id = ${id} and r.cause = 'answer'
  `) as unknown as Array<{
    card_id: number;
    kind: CardKind;
    word: string | null;
    meaning_id: number | null;
    effects: { produce?: boolean; prior?: unknown; exposed?: string[] };
    superseded: boolean;
  }>;
  const r = found[0];
  if (!r) throw new ReviewError("That answer isn't in the log.");
  if (r.superseded) throw new ReviewError("Only the last answer can be taken back.");
  if (!r.effects.prior) throw new ReviewError("That answer was given before answers could be taken back.");

  const statements = [
    sql`
      update chongfuxi_card c
      set state = p.state, due = p.due, stability = p.stability, difficulty = p.difficulty, reps = p.reps,
          lapses = p.lapses, scheduled_days = p.scheduled_days, last_review = p.last_review,
          answered = p.answered, passed = p.passed, clean_reads = p.clean_reads,
          last_clean_day = p.last_clean_day, retired = p.retired
      from jsonb_to_recordset(${JSON.stringify(r.effects.prior)}::jsonb) as p(
        id bigint, state smallint, due timestamptz, stability double precision, difficulty double precision,
        reps integer, lapses integer, scheduled_days integer, last_review timestamptz, answered integer,
        passed integer, clean_reads integer, last_clean_day date, retired timestamptz
      )
      where c.owner_email = ${owner} and c.id = p.id
    `,
  ];
  if (r.effects.produce && r.kind === "read") {
    statements.push(sql`
      delete from chongfuxi_card
      where owner_email = ${owner} and kind = 'produce' and word = ${r.word}
        and meaning_id is not distinct from ${r.meaning_id}::bigint and answered = 0
    `);
  }
  if (r.effects.exposed?.length) {
    statements.push(sql`
      update chongfuxi_word set exposures = greatest(0, exposures - 1)
      where owner_email = ${owner} and word = any(${r.effects.exposed}::text[])
    `);
  }
  statements.push(sql`delete from chongfuxi_review where owner_email = ${owner} and (id = ${id} or parent = ${id})`);
  await sql.transaction(statements);
  return { cardId: r.card_id };
}

/** A retired sentence that has this word, other than the one given: the one read longest ago. */
async function retiredWith(sql: Sql, owner: string, word: string, notSentence: number, notCards: number[]): Promise<number | null> {
  const rows = (await sql`
    select c.id::int as id
    from chongfuxi_card c
    where c.owner_email = ${owner} and c.kind = 'sentence' and c.retired is not null and not c.suspended
      and c.sentence_id <> ${notSentence}
      and not (c.id = any(${notCards}::bigint[]))
      and exists (
        select 1 from chongfuxi_token t
        where t.owner_email = c.owner_email and t.sentence_id = c.sentence_id and t.word = ${word}
      )
    order by c.last_review asc nulls first, c.id
    limit 1
  `) as unknown as Array<{ id: number }>;
  return rows[0]?.id ?? null;
}

/**
 * Where a word's Produce card starts, or null if there is nothing to ask it
 * with. A word's own starts from Pleco, a step lower than recognition; a
 * split-off meaning's starts new.
 */
async function produceSeed(sql: Sql, owner: string, read: CardRow, at: number): Promise<Schedule | null> {
  if (read.meaning_id !== null) return newSchedule(at);
  const rows = (await sql`
    select pleco, jsonb_array_length(defs) as n from chongfuxi_word
    where owner_email = ${owner} and word = ${read.word}
  `) as unknown as Array<{ pleco: PlecoSeed | null; n: number }>;
  if (!rows[0] || !rows[0].n) return null;
  return seedSchedule(rows[0].pleco, "produce", at);
}

// ---------------------------------------------------------------- meanings --

/** Give one meaning of a word its own schedule. Its first card is due at once. */
export async function splitMeaning(sql: Sql, owner: string, word: string, gloss: string, at = Date.now()): Promise<number> {
  const known = (await sql`
    select 1 from chongfuxi_word where owner_email = ${owner} and word = ${word} and status = 'deck'
  `) as unknown as unknown[];
  if (!known.length) throw new ReviewError("That word isn't in the deck.");
  const rows = (await sql`
    insert into chongfuxi_meaning (owner_email, word, gloss)
    values (${owner}, ${word}, ${gloss})
    on conflict (owner_email, word, gloss) do update set merged = null
    returning id::int as id
  `) as unknown as Array<{ id: number }>;
  const id = rows[0].id;
  const fresh = newSchedule(at);
  await sql`
    insert into chongfuxi_card (owner_email, kind, word, meaning_id, state, due)
    values (${owner}, 'read', ${word}, ${id}, ${fresh.state}, ${ts(fresh.due)}::timestamptz)
    on conflict do nothing
  `;
  await sql`update chongfuxi_card set suspended = false where owner_email = ${owner} and meaning_id = ${id}`;
  return id;
}

/** Fold a split-off meaning back into its word: its cards leave the queue. */
export async function mergeMeaning(sql: Sql, owner: string, id: number): Promise<void> {
  await sql.transaction([
    sql`update chongfuxi_meaning set merged = now() where owner_email = ${owner} and id = ${id}`,
    sql`update chongfuxi_card set suspended = true where owner_email = ${owner} and meaning_id = ${id}`,
  ]);
}

// ----------------------------------------------------------- notes, pacing --

/**
 * The owner's note on a card: a line that tells it apart next time, shown on
 * the card's front. An empty note takes it away. The card stays in the queue;
 * a note changes nothing about its schedule.
 */
export async function setNote(sql: Sql, owner: string, cardId: number, note: string): Promise<void> {
  await sql`
    update chongfuxi_card set note = ${note.trim() || null}
    where owner_email = ${owner} and id = ${cardId}
  `;
}

// ----------------------------------------------------------------- browsing --

export interface SentenceQuery {
  show: "readable" | "one" | "locked";
  /** Only sentences this word alone is blocking. */
  blocker?: string;
  /** Only sentences with this word in them, readable or not. */
  word?: string;
  /** With `word`: inside longer words too (机 in 机器), not only as a word of its own. */
  within?: boolean;
  /** Only sentences from this source (a deck, a book's lessons). */
  source?: string;
  offset: number;
  limit: number;
}

export async function listSentences(sql: Sql, owner: string, q: SentenceQuery): Promise<SentenceRow[]> {
  const where = q.word
    ? q.within
      ? `strpos(s.key, $6) > 0`
      : `exists (select 1 from chongfuxi_token t where t.owner_email = s.owner_email and t.sentence_id = s.id and t.word = $6)`
    : q.show === "readable"
      ? "cardinality(s.blockers) = 0"
      : q.show === "one"
        ? "cardinality(s.blockers) = 1"
        : "cardinality(s.blockers) > 1";
  const rows = (await sql.query(
    `select s.id::int as id, s.zh, s.en, s.blockers, s.sources, s.split,
            case when c.id is null then null
                 when c.retired is not null then 'retired'
                 when c.state = 0 then 'new'
                 else 'reading' end as card
     from chongfuxi_sentence s
     left join chongfuxi_card c on c.owner_email = s.owner_email and c.kind = 'sentence' and c.sentence_id = s.id
     where s.owner_email = $1 and ${where} and ($2::text is null or s.blockers = array[$2::text])
       and ($5::text is null or $5::text = any(s.sources))
     order by ${q.word ? "cardinality(s.blockers), " : ""}char_length(s.key), s.id
     limit $3 offset $4`,
    [owner, q.blocker ?? null, q.limit, q.offset, q.source ?? null, ...(q.word ? [q.word] : [])],
  )) as unknown as Array<{ id: number; zh: string; en: string | null; blockers: string[]; sources: string[]; split: string; card: SentenceRow["card"] }>;
  return rows.map((r) => ({
    id: r.id,
    zh: zhShown(r.zh),
    en: r.en,
    blockers: r.blockers,
    sources: r.sources,
    dictionarySplit: r.split === "dictionary",
    card: r.card,
  }));
}

/** A deck word whose Read card is new here, or under three weeks strong, is still being learnt. */
const SETTLING_DAYS = 21;

/**
 * One sentence in full, for its page on Cards › Sentences: its words with
 * their readings, how each stands, what still blocks it, and its card.
 */
export async function sentenceDetail(sql: Sql, owner: string, id: number): Promise<SentenceDetail | null> {
  const rows = (await sql`
    select id::int as id, zh, en, sources, blockers, split, pleco from chongfuxi_sentence
    where owner_email = ${owner} and id = ${id}
  `) as unknown as Array<{ id: number; zh: string; en: string | null; sources: string[]; blockers: string[]; split: string; pleco: PlecoSeed | null }>;
  const s = rows[0];
  if (!s) return null;
  const sentence = (await sentenceDresser(sql, owner, [id]))(s)!;
  const words = [...new Set(sentence.words)];
  const deck = words.length
    ? ((await sql`
        select w.word, c.state::int as state, c.stability
        from chongfuxi_word w
        left join chongfuxi_card c on c.owner_email = w.owner_email and c.kind = 'read' and c.meaning_id is null and c.word = w.word
        where w.owner_email = ${owner} and w.status = 'deck' and w.word = any(${words}::text[])
      `) as unknown as Array<{ word: string; state: number | null; stability: number | null }>)
    : [];
  const inDeck = new Map(deck.map((d) => [d.word, d]));
  const blocked = new Set(s.blockers);
  const cards = (await sql.query(
    `select ${CARD_COLUMNS} from chongfuxi_card c where c.owner_email = $1 and c.kind = 'sentence' and c.sentence_id = $2`,
    [owner, id],
  )) as unknown as CardRow[];
  const c = cards[0];
  const answers = c
    ? ((await sql`
        select grade, (extract(epoch from at) * 1000)::double precision as at
        from chongfuxi_review
        where owner_email = ${owner} and card_id = ${c.id}
        order by seq
      `) as unknown as Array<{ grade: Grade; at: number }>)
    : [];
  return {
    sentence,
    blockers: s.blockers,
    dictionarySplit: s.split === "dictionary",
    words: sentence.words.map((w) => {
      const d = inDeck.get(w);
      const settling = d && (d.state === null || d.state === 0 || (d.stability ?? 0) < SETTLING_DAYS);
      return { standing: blocked.has(w) ? "unknown" : settling ? "learning" : "known", inDeck: Boolean(d) };
    }),
    card: c
      ? { state: c.retired !== null ? "retired" : c.state === 0 ? "new" : "reading", history: historyFrom(answers, s.pleco) }
      : null,
  };
}

/** Every source the sentences came from (a deck, a book's lessons), with how many are readable, one word away and further off. */
export async function listSources(sql: Sql, owner: string): Promise<SourceCounts[]> {
  const rows = (await sql`
    select src as source,
           count(*) filter (where cardinality(blockers) = 0)::int as readable,
           count(*) filter (where cardinality(blockers) = 1)::int as one_away,
           count(*) filter (where cardinality(blockers) > 1)::int as locked
    from chongfuxi_sentence, unnest(sources) src
    where owner_email = ${owner}
    group by src
    order by count(*) desc, src
  `) as unknown as Array<{ source: string; readable: number; one_away: number; locked: number }>;
  return rows.map((r) => ({ source: r.source, readable: r.readable, oneAway: r.one_away, locked: r.locked }));
}

/**
 * The words each standing alone between the owner and some sentences, by how
 * many. One from a Pleco list is something to learn next; the rest are mostly
 * names and rarities.
 */
export async function listBlockers(sql: Sql, owner: string, limit: number): Promise<{ learnNext: Blocker[]; others: Blocker[]; names: string[] }> {
  const rows = (await sql`
    select b.word, b.n, w.status, w.pinyin, w.defs
    from (
      select blockers[1] as word, count(*)::int as n
      from chongfuxi_sentence
      where owner_email = ${owner} and cardinality(blockers) = 1
      group by 1
    ) b
    left join chongfuxi_word w on w.owner_email = ${owner} and w.word = b.word
    order by b.n desc, b.word
  `) as unknown as Array<{ word: string; n: number; status: string | null; pinyin: string | null; defs: Definition[] | null }>;
  const names = (await sql`
    select word from chongfuxi_word where owner_email = ${owner} and status = 'name' order by added desc
  `) as unknown as Array<{ word: string }>;
  const toBlocker = (r: (typeof rows)[number]): Blocker => ({
    word: r.word,
    unlocks: r.n,
    listed: r.status === "listed",
    pinyin: shownPinyin(r.pinyin, r.defs),
    gloss: r.defs ? promptSenses(r.defs, r.pinyin).slice(0, 2).join("; ") || null : null,
  });
  return {
    learnNext: rows.filter((r) => r.status === "listed").slice(0, limit).map(toBlocker),
    others: rows.filter((r) => r.status !== "listed").slice(0, limit).map(toBlocker),
    names: names.map((n) => n.word),
  };
}

// ---------------------------------------------------------------- coverage --

/** A card remembered for under three weeks is young; for six months or more, strong. */
const YOUNG_DAYS = 21;
const STRONG_DAYS = 180;

/** The HSK schemes shown, by the name of the Pleco category each lives under. */
const SCHEMES = [
  { top: "HSK 2012-2021", label: "HSK (old)", note: "The six-level HSK of 2012 to 2021." },
  { top: "HSK 3.0", label: "HSK 3.0", note: "The nine-level HSK that replaced it." },
];

/** How much of each HSK level is in the deck. A word listed at two levels counts at both. */
export async function getCoverage(sql: Sql, owner: string): Promise<Coverage> {
  const rows = (await sql`
    select l as list, count(*)::int as total,
           count(*) filter (where w.status = 'deck')::int as in_deck,
           count(*) filter (where c.answered = 0)::int as waiting,
           count(*) filter (where c.answered > 0 and c.stability < ${YOUNG_DAYS})::int as young,
           count(*) filter (where c.answered > 0 and c.stability >= ${YOUNG_DAYS} and c.stability < ${STRONG_DAYS})::int as mature,
           count(*) filter (where c.answered > 0 and c.stability >= ${STRONG_DAYS})::int as strong
    from chongfuxi_word w
    cross join unnest(w.lists) l
    left join chongfuxi_card c
      on c.owner_email = w.owner_email and c.word = w.word and c.kind = 'read' and c.meaning_id is null
     and w.status = 'deck'
    where w.owner_email = ${owner}
    group by 1
  `) as unknown as Array<{ list: string; total: number; in_deck: number; waiting: number; young: number; mature: number; strong: number }>;
  const tops = SCHEMES.map((s) => `${s.top}/%`);
  const counts = (await sql`
    select count(*) filter (where status = 'deck')::int as deck,
           count(*) filter (
             where status = 'deck' and not exists (select 1 from unnest(lists) l where l like any(${tops}::text[]))
           )::int as unlisted
    from chongfuxi_word where owner_email = ${owner}
  `) as unknown as Array<{ deck: number; unlisted: number }>;
  const order = (name: string) => Number(name.match(/\d+/)?.[0] ?? 99);
  return {
    groups: SCHEMES.map((s) => ({
      label: s.label,
      note: s.note,
      levels: rows
        .filter((r) => r.list.startsWith(`${s.top}/`))
        .map((r) => ({
          list: r.list,
          name: r.list.slice(s.top.length + 1),
          total: r.total,
          inDeck: r.in_deck,
          waiting: r.waiting,
          young: r.young,
          mature: r.mature,
          strong: r.strong,
        }))
        .sort((a, b) => order(a.name) - order(b.name)),
    })).filter((g) => g.levels.length),
    deck: counts[0].deck,
    unlisted: counts[0].unlisted,
  };
}

/** `like` matching a list and every list under it. */
const underList = (list: string) => `${list.replace(/[\\%_]/g, "\\$&")}/%`;

/** Top-level lists the owner doesn't study from, left off the Lists screen: NPCR and 成语. */
const LISTS_HIDDEN = /npcr|成语/i;

/**
 * Words with a Read or Recall card a session would deal today: due before
 * the day ends, the word not answered yet today (one card a word a day).
 */
const DUE_WORDS = `
  select distinct c.word from chongfuxi_card c
  where c.owner_email = $1 and c.kind in ('read', 'produce') and ${ACTIVE} and not ${WAITING_TO_LEARN}
    and c.due <= to_timestamp($2::double precision / 1000)
    and not exists (
      select 1 from chongfuxi_review r
      where r.owner_email = c.owner_email and r.day = $3::date and r.word = c.word
    )`;

/** Words with a Read card waiting for Learn. */
const TO_LEARN_WORDS = `
  select distinct c.word from chongfuxi_card c
  where c.owner_email = $1 and ${ACTIVE} and ${WAITING_TO_LEARN}`;

/**
 * Every Pleco word list and every category above one, as Pleco shows them
 * (HSK标准教程 › HSK标准教程5 › 第24课), with how many of their words are in
 * the deck and, given the study day, how many are due. A word filed under
 * two lessons of a book counts once in the book.
 */
export async function listTree(sql: Sql, owner: string, day: StudyDay | null = null): Promise<ListNode[]> {
  await moveSongLists(sql, owner);
  // Without a day, nothing counts as due.
  const dayParams = [owner, day?.cutoff ?? 0, day?.day ?? "1970-01-01"];
  const rows = (await sql.query(
    `with due as (${DUE_WORDS}), fresh as (${TO_LEARN_WORDS})
     select x.p as list, count(distinct w.word)::int as total,
            count(distinct w.word) filter (where w.status = 'deck')::int as in_deck,
            count(distinct d.word)::int as due,
            count(distinct f.word)::int as to_learn
     from chongfuxi_word w
     left join due d on d.word = w.word
     left join fresh f on f.word = w.word
     cross join unnest(w.lists) l
     cross join lateral (
       select array_to_string((string_to_array(l, '/'))[1:n], '/') as p
       from generate_series(1, cardinality(string_to_array(l, '/'))) n
     ) x
     where w.owner_email = $1
     group by x.p`,
    dayParams,
  )) as unknown as Array<{ list: string; total: number; in_deck: number; due: number; to_learn: number }>;
  const longku = (await sql.query(
    `with due as (${DUE_WORDS}), fresh as (${TO_LEARN_WORDS})
     select count(*)::int as n, count(d.word)::int as due, count(f.word)::int as to_learn
     from longku_bank b left join due d on d.word = b.w left join fresh f on f.word = b.w
     where b.owner_email = $1`,
    dayParams,
  )) as unknown as Array<{ n: number; due: number; to_learn: number }>;
  const l = longku[0];
  const songs = await songsOf(sql, owner);
  return [
    // 龙库's chengyu: every one a deck word, kept in step with 龙库 (longku.ts).
    ...(l.n ? [{ list: LONGKU_LIST, total: l.n, inDeck: l.n, due: l.due, toLearn: l.to_learn, linked: "longku" as const }] : []),
    ...rows
      .filter((r) => !LISTS_HIDDEN.test(r.list.split("/")[0]))
      .map((r) => {
        const song = songs.get(r.list);
        return {
          list: r.list,
          total: r.total,
          inDeck: r.in_deck,
          due: r.due,
          toLearn: r.to_learn,
          ...(r.list === SPOTIFY_LIST || r.list.startsWith(`${SPOTIFY_LIST}/`) ? { source: "spotify" as const } : {}),
          ...(song ? { song } : {}),
        };
      }),
  ];
}

/**
 * A condition that the word in `column` is on a list (or a list under it, or
 * 龙库), with its parameters numbered from `from`.
 */
export function onList(list: string, column: string, from: number): { where: string; params: string[] } {
  if (list === LONGKU_LIST) {
    return { where: `exists (select 1 from longku_bank b where b.owner_email = $1 and b.w = ${column})`, params: [] };
  }
  return {
    where: `exists (
      select 1 from chongfuxi_word lw cross join unnest(lw.lists) l
      where lw.owner_email = $1 and lw.word = ${column} and (l = $${from} or l like $${from + 1})
    )`,
    params: [list, underList(list)],
  };
}

/** The list name 龙库's chengyu go under. */
export const LONGKU_LIST = "龙库";

/** The words of a list and of every list under it: those not in the deck first, then shortest first. */
export async function listWords(sql: Sql, owner: string, list: string, offset: number, limit: number): Promise<ListWord[]> {
  const rows = (
    list === LONGKU_LIST
      ? await sql`
          select w.word, w.pinyin, w.defs, w.status = 'deck' as in_deck
          from longku_bank b join chongfuxi_word w on w.owner_email = b.owner_email and w.word = b.w
          where b.owner_email = ${owner}
          order by w.word
          limit ${limit} offset ${offset}
        `
      : await sql`
          select word, pinyin, defs, status = 'deck' as in_deck from chongfuxi_word
          where owner_email = ${owner}
            and exists (select 1 from unnest(lists) l where l = ${list} or l like ${underList(list)})
          order by status = 'deck', char_length(word), word
          limit ${limit} offset ${offset}
        `
  ) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[]; in_deck: boolean }>;
  return rows.map((r) => ({
    word: r.word,
    pinyin: shownPinyin(r.pinyin, r.defs),
    gloss: promptSenses(r.defs, r.pinyin).slice(0, 2).join("; ") || null,
    inDeck: r.in_deck,
  }));
}

/** The words of a list (and the lists under it) not in the deck yet. */
export async function listMissingAll(sql: Sql, owner: string, list: string): Promise<string[]> {
  const rows = (await sql`
    select word from chongfuxi_word
    where owner_email = ${owner} and status <> 'deck'
      and exists (select 1 from unnest(lists) l where l = ${list} or l like ${underList(list)})
    order by char_length(word), word
  `) as unknown as Array<{ word: string }>;
  return rows.map((r) => r.word);
}

/** The words of one list that aren't in the deck, shortest first. */
export async function listMissing(sql: Sql, owner: string, list: string, offset: number, limit: number): Promise<MissingWord[]> {
  const rows = (await sql`
    select word, pinyin, defs from chongfuxi_word
    where owner_email = ${owner} and status <> 'deck' and lists @> array[${list}]::text[]
    order by char_length(word), word
    limit ${limit} offset ${offset}
  `) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[] }>;
  return rows.map((r) => ({
    word: r.word,
    pinyin: shownPinyin(r.pinyin, r.defs),
    gloss: promptSenses(r.defs, r.pinyin).slice(0, 2).join("; ") || null,
  }));
}
