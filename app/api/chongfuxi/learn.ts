// Learn: new words drilled with the corpus's sentences before they join the
// review.
//
// A Read card never answered and not yet through Learn waits here
// (WAITING_TO_LEARN in review.ts keeps it out of the review and its counts).
// Learn takes up to ten at a time, each with sentences to teach it: readable
// ones first, then ones with a single word not known yet, shown with its
// meaning. Nothing Learn does counts as an answer: finishing a word marks its
// card learned and makes it due the next study day, still new, so its first
// real answer comes a day later. How each step went is logged
// (chongfuxi_learn) and touches no schedule.

import type { Sql } from "./db";
import { loadHeadwords } from "./headwords";
import { longkuWords } from "./longku";
import {
  ACTIVE,
  WAITING_TO_LEARN,
  hskOf,
  onList,
  promptSenses,
  sentenceDresser,
  shownPinyin,
} from "./review";
import type { LearnResult, LearnSentence, LearnWord } from "@chongfuxi/lib/api";
import type { StudyDay } from "@chongfuxi/lib/day";
import type { Definition } from "@chongfuxi/lib/dict";
import { blankOut, contextFit } from "@chongfuxi/lib/review";

/** Words in one Learn session. */
export const LEARN_MAX = 10;
/** Sentences sent per word: enough for a new one at every step, and again after a miss. */
const SENTENCES_PER_WORD = 8;
/** Longer than this (in Han characters) is too much to read while learning a word. */
const LEARN_SENTENCE_MAX_HAN = 30;

/**
 * The next words to learn, newest first (the ones just added), from one list
 * or from the whole deck, each with its teaching sentences.
 */
export async function wordsToLearn(
  sql: Sql,
  owner: string,
  list: string | null,
  limit = LEARN_MAX,
): Promise<LearnWord[]> {
  const inList = list === null ? null : onList(list, "c.word", 3);
  const cards = (await sql.query(
    `select c.id::int as card, c.word, w.pinyin, w.defs, w.lists
     from chongfuxi_card c
     join chongfuxi_word w on w.owner_email = c.owner_email and w.word = c.word and w.status = 'deck'
     where c.owner_email = $1 and ${ACTIVE} and ${WAITING_TO_LEARN}
       ${inList ? `and ${inList.where}` : ""}
     order by c.id desc
     limit $2`,
    [owner, limit, ...(inList?.params ?? [])],
  )) as unknown as Array<{
    card: number;
    word: string;
    pinyin: string | null;
    defs: Definition[];
    lists: string[] | null;
  }>;
  if (!cards.length) return [];
  const words = cards.map((c) => c.word);

  // Sentences with the word in: every other word known first, then those with
  // one not known yet; with a translation first; a natural length (about nine
  // characters) before a scrap or a long one; those several decks share first.
  const candidates = (await sql`
    select x.word, x.id, x.zh, x.en, x.sources, x.blockers, x.rn::int as rn
    from (
      select t.word, s.id::int as id, s.zh, s.en, s.sources, s.blockers,
             row_number() over (
               partition by t.word
               order by cardinality(s.blockers), (s.en is null), (char_length(s.key) < 5), (s.zh ~ '^\\s*【'),
                        cardinality(s.sources) desc, abs(char_length(s.key) - 9), s.id
             ) as rn
      from (
        select distinct word, sentence_id from chongfuxi_token
        where owner_email = ${owner} and word = any(${words}::text[])
      ) t
      join chongfuxi_sentence s on s.owner_email = ${owner} and s.id = t.sentence_id
      where cardinality(s.blockers) <= 1 and char_length(s.key) <= ${LEARN_SENTENCE_MAX_HAN}
    ) x
    where x.rn <= ${SENTENCES_PER_WORD * 3}
  `) as unknown as Array<{
    word: string;
    id: number;
    zh: string;
    en: string | null;
    sources: string[];
    blockers: string[];
    rn: number;
  }>;

  // Where the word is only part of a longer word (手 in 住手), the sentence
  // teaches the compound: those go after the rest.
  const headwords = loadHeadwords();
  const picked = new Map<
    string,
    Array<(typeof candidates)[number] & { bound: boolean; repeated: boolean }>
  >();
  for (const w of words) {
    picked.set(
      w,
      candidates
        .filter((x) => x.word === w)
        .map((x) => ({ ...x, ...contextFit(x.zh, w, (h) => headwords.has(h)) }))
        .sort(
          (a, b) =>
            Number(a.bound) - Number(b.bound) ||
            a.blockers.length - b.blockers.length ||
            a.rn - b.rn,
        )
        .slice(0, SENTENCES_PER_WORD),
    );
  }
  const dressed = await sentenceDresser(
    sql,
    owner,
    [...picked.values()].flat().map((x) => x.id),
  );
  const inLongku = await longkuWords(sql, owner, words);

  return cards.map((c) => ({
    card: c.card,
    word: c.word,
    pinyin: shownPinyin(c.pinyin, c.defs),
    senses: promptSenses(c.defs),
    hsk: hskOf(c.lists ?? []),
    longku: inLongku.has(c.word),
    sentences: (picked.get(c.word) ?? []).flatMap((x): LearnSentence[] => {
      const info = dressed(x);
      if (!info) return [];
      return [
        {
          ...info,
          // A gap that one of the word's characters, written again, gives away is no test.
          blanked: x.repeated ? null : blankOut(info.zh, c.word),
          unknown: x.blockers[0] ?? null,
        },
      ];
    }),
  }));
}

/**
 * Words through Learn: each card is marked learned and made due the next
 * study day, still new; and how it went is logged, once per session however
 * often it is sent. A card answered or learned meanwhile is left as it is.
 * Returns the words newly marked.
 */
export async function finishLearning(
  sql: Sql,
  owner: string,
  day: StudyDay,
  session: string,
  results: LearnResult[],
): Promise<string[]> {
  if (!results.length) return [];
  const rows = JSON.stringify(
    results.map((r) => ({
      card: r.card,
      word: r.word,
      misses: r.misses,
      steps: r.steps,
    })),
  );
  const [marked] = (await sql.transaction([
    sql`
      update chongfuxi_card c
      set learned_at = now(),
          due = greatest(c.due, to_timestamp(${day.cutoff}::double precision / 1000) + interval '1 second')
      where c.owner_email = ${owner} and c.kind = 'read' and c.state = 0 and c.learned_at is null
        and c.id in (select (e.value->>'card')::bigint from jsonb_array_elements(${rows}::jsonb) e)
      returning c.word
    `,
    sql`
      insert into chongfuxi_learn (owner_email, day, session, card_id, word, misses, steps)
      select ${owner}, ${day.day}::date, ${session}, (e.value->>'card')::bigint, e.value->>'word',
             (e.value->>'misses')::int, e.value->'steps'
      from jsonb_array_elements(${rows}::jsonb) e
      on conflict (owner_email, session, card_id) do nothing
    `,
  ])) as unknown as [Array<{ word: string }>];
  return marked.map((m) => m.word);
}
