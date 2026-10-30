// Learn: new words drilled with the corpus's sentences before they join the
// review.
//
// A Read card never answered and not yet through Learn waits here
// (WAITING_TO_LEARN in review.ts keeps it out of the review and its counts).
// Each word comes with sentences to teach it: readable ones first, then ones
// with a single word not known yet, shown with its meaning. Its steps are
// taken in the review session (one every fifth card) or in a list's drill,
// and each is saved as it is taken (`chongfuxi_card.learn_step`), so leaving
// loses nothing. Nothing Learn does counts as an answer: the last step marks
// the card learned and makes it due the next study day, still new, so its
// first real answer comes a day later. How each step went is logged
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
import type { LearnSentence, LearnStepDone, LearnWord } from "@chongfuxi/lib/api";
import type { StudyDay } from "@chongfuxi/lib/day";
import type { Definition } from "@chongfuxi/lib/dict";
import { blankOut, contextFit } from "@chongfuxi/lib/review";

/** Which words Learn takes first: those part way up the ladder, then the newest (the ones just added). */
export const LEARN_ORDER = `(c.learn_step is null), c.id desc`;

import { LEARN_MAX, LEARN_SENTENCE_MAX_HAN, LEARN_SESSION_MAX, SENTENCES_PER_WORD } from "@chongfuxi/lib/learn";
export { LEARN_MAX, LEARN_SESSION_MAX };

/**
 * The next words to learn, from one list or from the whole deck, each with
 * its teaching sentences and where it is on the ladder: those part way up
 * first, then the newest (the ones just added).
 */
export async function wordsToLearn(
  sql: Sql,
  owner: string,
  list: string | null,
  limit = LEARN_MAX,
): Promise<LearnWord[]> {
  const inList = list === null ? null : onList(list, "c.word", 3);
  const cards = (await sql.query(
    `select c.id::int as card, c.word, w.pinyin, w.defs, w.lists, c.learn_step
     from chongfuxi_card c
     join chongfuxi_word w on w.owner_email = c.owner_email and w.word = c.word and w.status = 'deck'
     where c.owner_email = $1 and ${ACTIVE} and ${WAITING_TO_LEARN}
       ${inList ? `and ${inList.where}` : ""}
     order by ${LEARN_ORDER}
     limit $2`,
    [owner, limit, ...(inList?.params ?? [])],
  )) as unknown as Array<{
    card: number;
    word: string;
    pinyin: string | null;
    defs: Definition[];
    lists: string[] | null;
    learn_step: LearnWord["step"];
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
  // teaches the compound: those only when there is nothing else.
  const headwords = loadHeadwords();
  const picked = new Map<
    string,
    Array<(typeof candidates)[number] & { bound: boolean; repeated: boolean }>
  >();
  for (const w of words) {
    const all = candidates
      .filter((x) => x.word === w)
      .map((x) => ({ ...x, ...contextFit(x.zh, w, (h) => headwords.has(h)) }))
      .sort(
        (a, b) =>
          Number(a.bound) - Number(b.bound) ||
          a.blockers.length - b.blockers.length ||
          a.rn - b.rn,
      );
    // Those only when it has none of its own, as for a Read card (即 shown in 立即).
    const own = all.filter((x) => !x.bound);
    picked.set(w, (own.length ? own : all).slice(0, SENTENCES_PER_WORD));
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
    step: c.learn_step,
    pinyin: shownPinyin(c.pinyin, c.defs),
    senses: promptSenses(c.defs, c.pinyin),
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
 * Steps taken, in the order taken, saved as they go: the card's place on the
 * ladder moves to the next step, or, after the last, the card is marked
 * learned and made due the next study day, still new. A card answered or
 * learned meanwhile is left as it is. Each step is logged once (by its id),
 * however often it is sent. Returns the words learned.
 */
export async function recordSteps(sql: Sql, owner: string, day: StudyDay, session: string, steps: LearnStepDone[]): Promise<string[]> {
  if (!steps.length) return [];
  const queries = steps.flatMap((s) => {
    const entry = JSON.stringify([{ id: s.id, step: s.step, sentence: s.sentence, grade: s.grade }]);
    return [
      s.next === null
        ? sql`
            update chongfuxi_card c
            set learned_at = now(), learn_step = null,
                due = greatest(c.due, to_timestamp(${day.cutoff}::double precision / 1000) + interval '1 second')
            where c.owner_email = ${owner} and c.id = ${s.card} and c.kind = 'read' and c.state = 0 and c.learned_at is null
            returning c.word
          `
        : sql`
            update chongfuxi_card c set learn_step = ${s.next}
            where c.owner_email = ${owner} and c.id = ${s.card} and c.kind = 'read' and c.state = 0 and c.learned_at is null
            returning null as word
          `,
      sql`
        insert into chongfuxi_learn (owner_email, day, session, card_id, word, misses, steps)
        values (${owner}, ${day.day}::date, ${session}, ${s.card}, ${s.word}, ${s.grade === "forgot" ? 1 : 0}, ${entry}::jsonb)
        on conflict (owner_email, session, card_id) do update
          set misses = chongfuxi_learn.misses + excluded.misses,
              steps = chongfuxi_learn.steps || excluded.steps
          where not chongfuxi_learn.steps @> jsonb_build_array(jsonb_build_object('id', ${s.id}::text))
      `,
    ];
  });
  const results = (await sql.transaction(queries)) as unknown as Array<Array<{ word: string | null }>>;
  return results.flatMap((r) => r.map((x) => x.word)).filter((w): w is string => Boolean(w));
}
