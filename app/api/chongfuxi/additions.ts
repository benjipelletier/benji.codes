// Words joining the deck outside an import: from notes AnkiDroid uploaded.
//
// Each batch is an addition: which words, what each was before, and which
// sentences they made readable. The owner sees it once on the new-words
// screen, and can undo it while none of its cards has been answered.
//
// Only the headword is taken from a note. Pleco fills its notes from its own
// dictionaries, which aren't ours to show, so definitions and pinyin come from
// CC-CEDICT, as for every other word.

import type { Sql } from "./db";
import type { Addition, AnkiSync, AnkiSyncDetail } from "@chongfuxi/lib/api";
import { definitionsFor, glossesOf, type Definition, type Dict } from "@chongfuxi/lib/dict";
import { cleanHeadword, isHan, zhShown } from "@chongfuxi/lib/hanzi";
import { newSchedule, type Schedule } from "@chongfuxi/lib/schedule";
import { insertCards, recomputeUnlocks } from "./corpus";
import { voteOrder } from "./defs";
import { mainEntry } from "@chongfuxi/lib/senses";
import { longkuWords, reconcileLongku } from "./longku";
import { hskOf, listMissingAll, promptSenses } from "./review";

/** Longest word a note may carry. Longer is a phrase or a sentence. */
const MAX_WORD = 8;
const EXAMPLES = 4;

/** A field's text without Anki's HTML. */
const plain = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

/** Field names that usually hold the headword, in order of trust. */
const HEADWORD_FIELDS = /^(simplified|hanzi|headword|chinese|word|expression|vocab|front|characters?)$/i;

/**
 * The word a note stands for, or null if it holds none. A named headword field
 * is tried first, then every field in order; the first that reads as a word
 * wins. Pleco may add the traditional form in brackets (扬眉吐气[揚眉吐氣]),
 * which is dropped.
 */
export function wordOfNote(fields: Record<string, string>): string | null {
  const entries = Object.entries(fields);
  const ordered = [...entries.filter(([k]) => HEADWORD_FIELDS.test(k.trim())), ...entries.filter(([k]) => !HEADWORD_FIELDS.test(k.trim()))];
  for (const [, value] of ordered) {
    const text = cleanHeadword(plain(value))
      .replace(/[[(（【].*$/u, "")
      .replace(/[\s|｜/／].*$/u, "")
      .trim();
    const chars = [...text];
    if (chars.length >= 1 && chars.length <= MAX_WORD && chars.every(isHan)) return text;
  }
  return null;
}

/**
 * Put words in the deck as one addition: a word row and a new Read card each,
 * then the sentences they unlock. Words already in the deck are passed over.
 * Returns the addition, or null if every word was already there.
 */
export async function addWords(
  sql: Sql,
  owner: string,
  source: string,
  words: string[],
  dict: Dict,
  at = Date.now(),
  /** Where a word's Read card starts, when something already knows it (龙库's record); new otherwise. */
  seeds: Map<string, Schedule> = new Map(),
): Promise<{ id: number; added: string[]; unlocked: number } | null> {
  const unique = [...new Set(words)];
  if (!unique.length) return null;
  const existing = (await sql`
    select word, status from chongfuxi_word where owner_email = ${owner} and word = any(${unique}::text[])
  `) as unknown as Array<{ word: string; status: "deck" | "listed" | "name" }>;
  const was = new Map(existing.map((e) => [e.word, e.status]));
  const fresh = unique.filter((w) => was.get(w) !== "deck");
  if (!fresh.length) return null;

  // The entry the word's sentences are about first, and its reading taken as the word's (lib/senses.ts).
  const found = fresh.map((w) => ({ word: w, pinyin: null, defs: definitionsFor(dict, w, null, null) as Definition[] }));
  const ordered = await voteOrder(sql, owner, found);
  const rows = found.map(({ word: w, defs: given }) => {
    const defs = ordered.get(w) ?? given;
    return { w, p: mainEntry(defs, null)?.p ?? null, d: defs, g: glossesOf(defs) };
  });
  await sql`
    insert into chongfuxi_word (owner_email, word, status, pinyin, defs, glosses)
    select ${owner}, e.value->>'w', 'deck', e.value->>'p', coalesce(e.value->'d', '[]'::jsonb),
           array(select jsonb_array_elements_text(coalesce(e.value->'g', '[]'::jsonb)))
    from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) e
    on conflict (owner_email, word) do update set
      status  = 'deck',
      pinyin  = coalesce(chongfuxi_word.pinyin, excluded.pinyin),
      defs    = case when jsonb_array_length(chongfuxi_word.defs) > 0 then chongfuxi_word.defs else excluded.defs end,
      glosses = case when cardinality(chongfuxi_word.glosses) > 0 then chongfuxi_word.glosses else excluded.glosses end
  `;
  await insertCards(
    sql,
    owner,
    fresh.map((w) => ({ kind: "read" as const, word: w, schedule: seeds.get(w) ?? newSchedule(at) })),
  );
  const result = await recomputeUnlocks(sql, owner, fresh, at);
  const unlocked = (await sql`
    select id::bigint as id from chongfuxi_sentence
    where owner_email = ${owner} and unlocked_at = to_timestamp(${at}::double precision / 1000)
      and unlocked_by = any(${fresh}::text[])
  `) as unknown as Array<{ id: string }>;
  const made = (await sql`
    insert into chongfuxi_addition (owner_email, at, source, words, unlocked)
    values (${owner}, to_timestamp(${at}::double precision / 1000), ${source},
            ${JSON.stringify(fresh.map((w) => ({ word: w, was: was.get(w) ?? null })))}::jsonb,
            ${unlocked.map((u) => u.id)}::bigint[])
    returning id::int as id
  `) as unknown as Array<{ id: number }>;
  // A chengyu among them joins 龙库.
  await reconcileLongku(sql, owner);
  return { id: made[0].id, added: fresh, unlocked: result.unlocked };
}

/**
 * Turn the notes not yet looked at into deck words, as one addition, and mark
 * each note with what became of it. Run after every Anki upload; `syncId`
 * gets what the sync did, for the log.
 */
export async function processAnkiNotes(sql: Sql, owner: string, dict: Dict, at = Date.now(), syncId: number | null = null) {
  const notes = (await sql`
    select note_id::text as id, fields from chongfuxi_anki_note
    where owner_email = ${owner} and handled_at is null
    order by note_id
  `) as unknown as Array<{ id: string; fields: Record<string, string> }>;
  if (!notes.length) {
    if (syncId !== null) {
      await sql`update chongfuxi_anki_sync set words_added = 0, known = 0, unreadable = 0, unlocked = 0 where id = ${syncId}`;
    }
    return null;
  }
  const read = notes.map((n) => ({ id: n.id, word: wordOfNote(n.fields) }));
  const addition = await addWords(
    sql,
    owner,
    "anki",
    read.map((r) => r.word).filter((w): w is string => w !== null),
    dict,
    at,
  );
  const added = new Set(addition?.added ?? []);
  const outcomes = read.map((r) => ({
    i: r.id,
    w: r.word,
    o: r.word === null ? "unreadable" : added.has(r.word) ? "added" : "known",
  }));
  await sql`
    update chongfuxi_anki_note n
    set word = e.value->>'w', outcome = e.value->>'o', handled_at = now(), sync_id = ${syncId}::bigint,
        addition_id = case when e.value->>'o' = 'added' then ${addition?.id ?? null}::bigint end
    from jsonb_array_elements(${JSON.stringify(outcomes)}::jsonb) e
    where n.owner_email = ${owner} and n.note_id = (e.value->>'i')::bigint
  `;
  if (syncId !== null) {
    // Earlier syncs whose notes waited for this one: their notes are counted here.
    await sql`
      update chongfuxi_anki_sync set words_added = 0, known = 0, unreadable = 0, unlocked = 0
      where owner_email = ${owner} and id < ${syncId} and words_added is null and error is null
    `;
    const count = (o: string) => outcomes.filter((x) => x.o === o).length;
    await sql`
      update chongfuxi_anki_sync
      set addition_id = ${addition?.id ?? null}, words_added = ${count("added")}, known = ${count("known")},
          unreadable = ${count("unreadable")}, unlocked = ${addition?.unlocked ?? 0}
      where id = ${syncId}
    `;
  }
  return addition;
}

/** One sync's page: the sync, the notes it handled (each with its outcome), and its addition. */
export async function ankiSyncDetail(sql: Sql, owner: string, id: number): Promise<AnkiSyncDetail | null> {
  const sync = (await listAnkiSyncs(sql, owner, 1, id))[0];
  if (!sync) return null;
  const notes = (await sql`
    select word, outcome, fields from chongfuxi_anki_note
    where owner_email = ${owner} and sync_id = ${id}
    order by case outcome when 'added' then 0 when 'undone' then 1 when 'known' then 2 else 3 end, note_id
  `) as unknown as Array<{ word: string | null; outcome: AnkiSyncDetail["notes"][number]["outcome"]; fields: Record<string, string> }>;
  const addition = sync.additionId ? ((await listAdditions(sql, owner, 1, sync.additionId))[0] ?? null) : null;
  return {
    sync,
    notes: notes.map((n) => ({
      word: n.word,
      outcome: n.outcome,
      // For a note with no word: the start of its first field, to recognise it by.
      text: n.word ?? plain(Object.values(n.fields)[0] ?? "").slice(0, 40),
    })),
    addition,
  };
}

/** Every Anki sync, newest first, with what it did to the corpus; or just the one asked for. */
export async function listAnkiSyncs(sql: Sql, owner: string, limit = 50, only: number | null = null): Promise<AnkiSync[]> {
  const rows = (await sql`
    select y.id::int as id, (extract(epoch from y.at) * 1000)::double precision as at, y.client, y.bytes, y.notes, y.added,
           y.error, y.addition_id::int as addition_id, y.words_added, y.known, y.unreadable, y.unlocked,
           a.undone_at is not null as undone, y.seen_at is not null as seen
    from chongfuxi_anki_sync y
    left join chongfuxi_addition a on a.owner_email = y.owner_email and a.id = y.addition_id
    where y.owner_email = ${owner} and (${only}::bigint is null or y.id = ${only}::bigint)
    order by y.at desc limit ${limit}
  `) as unknown as Array<{
    id: number;
    at: number;
    client: string | null;
    bytes: number;
    notes: number;
    added: number;
    error: string | null;
    addition_id: number | null;
    words_added: number | null;
    known: number | null;
    unreadable: number | null;
    unlocked: number | null;
    undone: boolean;
    seen: boolean;
  }>;
  return rows.map((r) => ({
    id: r.id,
    at: Math.round(r.at),
    client: r.client,
    bytes: r.bytes,
    notes: r.notes,
    newNotes: r.added,
    error: r.error,
    additionId: r.addition_id,
    undone: r.undone,
    processed: r.words_added !== null,
    wordsAdded: r.words_added ?? 0,
    known: r.known ?? 0,
    unreadable: r.unreadable ?? 0,
    unlocked: r.unlocked ?? 0,
    seen: r.seen,
  }));
}

/**
 * The owner has seen this sync's page, and kept what it added. Earlier syncs
 * that added nothing are passed over with it; an earlier one that added words
 * still opens, so nothing is kept without being shown.
 */
export async function markSyncSeen(sql: Sql, owner: string, id: number): Promise<void> {
  await sql.transaction([
    sql`
      update chongfuxi_anki_sync set seen_at = coalesce(seen_at, now())
      where owner_email = ${owner} and (id = ${id} or (id < ${id} and addition_id is null))
    `,
    sql`
      update chongfuxi_addition set seen_at = coalesce(seen_at, now())
      where owner_email = ${owner} and id = (select addition_id from chongfuxi_anki_sync where owner_email = ${owner} and id = ${id})
    `,
  ]);
}

/** Recent additions, newest first, with what the new-words screen shows; or just the one asked for. */
export async function listAdditions(sql: Sql, owner: string, limit = 10, only: number | null = null): Promise<Addition[]> {
  const rows = (await sql`
    select id::int as id, (extract(epoch from at) * 1000)::double precision as at, source, words,
           unlocked::text[] as unlocked, seen_at is not null as seen, undone_at is not null as undone
    from chongfuxi_addition where owner_email = ${owner} and (${only}::bigint is null or id = ${only}::bigint)
    order by at desc limit ${limit}
  `) as unknown as Array<{
    id: number;
    at: number;
    source: string;
    words: Array<{ word: string; was: "listed" | "name" | null }>;
    unlocked: string[];
    seen: boolean;
    undone: boolean;
  }>;
  if (!rows.length) return [];
  const all = [...new Set(rows.flatMap((r) => r.words.map((w) => w.word)))];
  const info = (await sql`
    select w.word, w.pinyin, w.defs, w.lists,
           (select count(distinct t.sentence_id)::int from chongfuxi_token t
            join chongfuxi_sentence s on s.owner_email = t.owner_email and s.id = t.sentence_id
            where t.owner_email = w.owner_email and t.word = w.word and cardinality(s.blockers) = 0) as readable
    from chongfuxi_word w where w.owner_email = ${owner} and w.word = any(${all}::text[])
  `) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[]; lists: string[] | null; readable: number }>;
  const byWord = new Map(info.map((i) => [i.word, i]));
  const inLongku = await longkuWords(sql, owner, all);
  const answered = (await sql`
    select distinct word from chongfuxi_card
    where owner_email = ${owner} and word = any(${all}::text[]) and kind in ('read', 'produce') and answered > 0
  `) as unknown as Array<{ word: string }>;
  const touched = new Set(answered.map((a) => a.word));
  const deck = (await sql`select count(*)::int as n from chongfuxi_word where owner_email = ${owner} and status = 'deck'`) as unknown as Array<{
    n: number;
  }>;

  const out: Addition[] = [];
  for (const r of rows) {
    const examples = r.unlocked.length
      ? ((await sql`
          select zh, en, unlocked_by as by from chongfuxi_sentence
          where owner_email = ${owner} and id = any(${r.unlocked}::bigint[])
          order by abs(char_length(key) - 9), id
          limit ${EXAMPLES}
        `) as unknown as Array<{ zh: string; en: string | null; by: string | null }>)
      : [];
    out.push({
      id: r.id,
      at: Math.round(r.at),
      source: r.source,
      seen: r.seen,
      undone: r.undone,
      words: r.words.map((w) => {
        const i = byWord.get(w.word);
        return {
          word: w.word,
          pinyin: i?.pinyin ?? null,
          gloss: i ? (promptSenses(i.defs, i.pinyin).slice(0, 2).join("; ") || null) : null,
          hsk: hskOf(i?.lists ?? []),
          longku: inLongku.has(w.word),
          was: w.was,
          readable: i?.readable ?? 0,
        };
      }),
      unlocked: r.unlocked.length,
      examples: examples.map((e) => ({ zh: zhShown(e.zh), en: e.en, by: e.by })),
      deck: deck[0].n,
      answered: r.words.map((w) => w.word).filter((w) => touched.has(w)),
    });
  }
  return out;
}

export class AdditionError extends Error {}

/** Most words one list may add at once: a lesson or a level, not a whole scheme. */
export const LIST_ADD_MAX = 500;

/**
 * Put a Pleco word list's missing words in the deck, as one addition, the way
 * Pleco's own flashcards took a lesson at a time. `skip` are words of it the
 * owner unticked; `only`, when given, the only ones ticked (after Untick all).
 * Null if there was nothing to add.
 */
export async function addList(
  sql: Sql,
  owner: string,
  list: string,
  skip: string[],
  dict: Dict,
  at = Date.now(),
  only: string[] | null = null,
): Promise<{ id: number; added: string[]; unlocked: number } | null> {
  const left = new Set(skip);
  const picked = only && new Set(only);
  const words = (await listMissingAll(sql, owner, list)).filter((w) => (picked ? picked.has(w) : !left.has(w)));
  if (words.length > LIST_ADD_MAX) {
    throw new AdditionError(`${words.length} words is more than ${LIST_ADD_MAX} at once. Open a smaller list inside it.`);
  }
  return addWords(sql, owner, `list:${list}`, words, dict, at);
}

/**
 * Put one word in the deck from its page: a word of a list, a name, or any
 * dictionary word. One addition, source "page", kept or undone like any other.
 */
export async function addFromPage(sql: Sql, owner: string, word: string, dict: Dict, at = Date.now()) {
  if (!/^[\u3400-\u9fff]{1,8}$/.test(word)) throw new AdditionError("Only a Chinese word can go in the deck.");
  const [row] = (await sql`
    select status from chongfuxi_word where owner_email = ${owner} and word = ${word}
  `) as unknown as Array<{ status: string }>;
  if (row?.status === "deck") throw new AdditionError(`${word} is already in the deck.`);
  if (!row && !definitionsFor(dict, word, null, null).length) {
    throw new AdditionError(`${word} isn't a dictionary word, so it has no definition to put on a card.`);
  }
  return addWords(sql, owner, "page", [word], dict, at);
}

/**
 * Take a word out of the deck, from the app (deleting it in AnkiDroid does
 * nothing here). Its Read and Recall cards go, with their answers; it goes
 * back on its list if it came from one, out of the corpus otherwise; the
 * sentences that needed it lock again. An Anki note for it is marked
 * removed, so the next sync doesn't bring it back.
 */
export async function removeWord(sql: Sql, owner: string, word: string, at = Date.now()): Promise<{ answers: number; relocked: number }> {
  const found = (await sql`
    select status, cardinality(lists)::int as lists, import_id is not null as imported
    from chongfuxi_word where owner_email = ${owner} and word = ${word}
  `) as unknown as Array<{ status: string; lists: number; imported: boolean }>;
  const w = found[0];
  if (!w || w.status !== "deck") throw new AdditionError(`${word} isn't in the deck.`);
  const cards = (await sql`
    select id::text as id from chongfuxi_card
    where owner_email = ${owner} and word = ${word} and kind in ('read', 'produce')
  `) as unknown as Array<{ id: string }>;
  const ids = cards.map((c) => c.id);
  const answers = (await sql`
    select count(*)::int as n from chongfuxi_review where owner_email = ${owner} and card_id = any(${ids}::bigint[])
  `) as unknown as Array<{ n: number }>;
  await sql.transaction([
    sql`delete from chongfuxi_review where owner_email = ${owner} and card_id = any(${ids}::bigint[])`,
    sql`delete from chongfuxi_card where owner_email = ${owner} and id = any(${ids}::bigint[])`,
    sql`delete from chongfuxi_meaning where owner_email = ${owner} and word = ${word}`,
    // On a Pleco list: a candidate again. Otherwise gone.
    w.lists > 0
      ? sql`update chongfuxi_word set status = 'listed' where owner_email = ${owner} and word = ${word}`
      : sql`delete from chongfuxi_word where owner_email = ${owner} and word = ${word}`,
    sql`update chongfuxi_anki_note set outcome = 'removed' where owner_email = ${owner} and word = ${word}`,
  ]);
  const result = await recomputeUnlocks(sql, owner, [], at);
  // Out of the deck, out of 龙库.
  await reconcileLongku(sql, owner);
  return { answers: answers[0].n, relocked: result.relocked };
}

/** The owner has seen it: it won't be shown again. */
export async function markSeen(sql: Sql, owner: string, id: number): Promise<void> {
  await sql`
    update chongfuxi_addition set seen_at = coalesce(seen_at, now())
    where owner_email = ${owner} and id = ${id}
  `;
}

/**
 * Take an addition back: its words go back to what they were, their cards
 * and the cards of the sentences they unlocked go, and those sentences lock
 * again. The notes stay marked, so the next sync doesn't add them again.
 * Refused once any of its words has been answered.
 */
export async function undoAddition(sql: Sql, owner: string, id: number, at = Date.now()): Promise<{ relocked: number }> {
  const found = (await sql`
    select words, unlocked::text[] as unlocked, undone_at is not null as undone
    from chongfuxi_addition where owner_email = ${owner} and id = ${id}
  `) as unknown as Array<{ words: Array<{ word: string; was: "listed" | "name" | null }>; unlocked: string[]; undone: boolean }>;
  const a = found[0];
  if (!a) throw new AdditionError("No such addition.");
  if (a.undone) throw new AdditionError("Already undone.");
  const words = a.words.map((w) => w.word);
  const answered = (await sql`
    select distinct word from chongfuxi_card
    where owner_email = ${owner} and word = any(${words}::text[]) and kind in ('read', 'produce') and answered > 0
  `) as unknown as Array<{ word: string }>;
  if (answered.length) {
    throw new AdditionError(`Already answered: ${answered.map((w) => w.word).join(" ")}. Undoing would lose those answers.`);
  }
  const gone = a.words.filter((w) => w.was === null).map((w) => w.word);
  const back = a.words.filter((w) => w.was !== null).map((w) => ({ w: w.word, s: w.was }));
  await sql.transaction([
    sql`delete from chongfuxi_card where owner_email = ${owner} and word = any(${words}::text[]) and kind in ('read', 'produce') and answered = 0`,
    sql`delete from chongfuxi_card where owner_email = ${owner} and kind = 'sentence' and answered = 0 and sentence_id = any(${a.unlocked}::bigint[])`,
    sql`delete from chongfuxi_word where owner_email = ${owner} and word = any(${gone}::text[]) and status = 'deck'`,
    sql`
      update chongfuxi_word w set status = e.value->>'s'
      from jsonb_array_elements(${JSON.stringify(back)}::jsonb) e
      where w.owner_email = ${owner} and w.word = e.value->>'w'
    `,
    sql`update chongfuxi_addition set undone_at = now(), seen_at = coalesce(seen_at, now()) where owner_email = ${owner} and id = ${id}`,
    sql`update chongfuxi_anki_note set outcome = 'undone' where owner_email = ${owner} and addition_id = ${id}`,
  ]);
  const result = await recomputeUnlocks(sql, owner, [], at);
  await reconcileLongku(sql, owner);
  return { relocked: result.relocked };
}
