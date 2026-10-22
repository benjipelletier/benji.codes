// Turning a Pleco file into rows, and keeping "which sentences are readable"
// in step with the words.
//
// The reading and sorting of a file is the pure pipeline in chongfuxi/lib
// (pleco → corpus). This writes its result: a row per word, per sentence and
// per token, a card for every deck word, and — once the blockers of every
// sentence have been worked out — a card for every sentence that can be read.
//
// Importing again only ever adds. A newer file brings new words and sentences
// and refreshes what Pleco says about old ones; it never removes a word, and
// never touches a card that already exists, answered or not.

import { ensureSuspendedSentences, wordStanding } from "./suspended";
import type { Sql } from "./db";
import { buildCorpus, defaultSettings, type CategoryRole, type Corpus, type Settings } from "@chongfuxi/lib/corpus";
import { definitionsFor, glossesOf, type Dict } from "@chongfuxi/lib/dict";
import type { PlecoSeed, PlecoSnapshot } from "@chongfuxi/lib/pleco";
import { seedSchedule, type CardKind, type Schedule } from "@chongfuxi/lib/schedule";
import { isHan } from "@chongfuxi/lib/hanzi";
import { wordsByPinyin } from "@chongfuxi/lib/pinyin";
import { segmentByDictionary } from "@chongfuxi/lib/segment";
import { makeUnlock } from "@chongfuxi/lib/unlock";
import { loadHeadwords } from "./headwords";
import { orderStoredDefs } from "./defs";
import { reconcileLongku } from "./longku";
import { SPOTIFY_LIST, songListOf } from "./spotify";

const BATCH = 1000;
const TOKEN_BATCH = 2500;

function batches<T>(rows: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** What the owner's own Pleco cards are called as a source; the category's name stays in Pleco. */
const OWN_SOURCE = "Pleco";

export interface IngestOptions {
  /** Work out what the import would do and write nothing. */
  dryRun?: boolean;
  /** Roles by top-level category name, over the defaults and whatever the last import used. */
  roles?: Record<string, CategoryRole>;
  at?: number;
  log?: (line: string) => void;
}

export interface IngestSummary {
  fileName: string;
  dryRun: boolean;
  /** Cards in the Pleco file. */
  cards: number;
  words: {
    /** Words in the deck once this is in. */
    total: number;
    added: number;
    /** A few of the added ones, to show. */
    sample: string[];
  };
  sentences: {
    total: number;
    added: number;
    readable: number;
    oneAway: number;
    /** Readable after this that weren't before. */
    unlocked: number;
  };
  /** What each top-level Pleco category was taken to be. */
  roles: Record<string, CategoryRole>;
}

/** The roles the last import used, by category name, so the next one starts from the same choices. */
async function lastRoles(sql: Sql, owner: string): Promise<Record<string, CategoryRole>> {
  const rows = (await sql`
    select settings from chongfuxi_import
    where owner_email = ${owner} and ingested is not null and settings is not null
    order by ingested desc
    limit 1
  `) as unknown as Array<{ settings: { roles?: Record<string, CategoryRole> } }>;
  return rows[0]?.settings?.roles ?? {};
}

function settingsFor(snapshot: PlecoSnapshot, byName: Record<string, CategoryRole>): { settings: Settings; roles: Record<string, CategoryRole> } {
  const settings = defaultSettings(snapshot);
  const names = new Map(snapshot.categories.map((c) => [c.id, c.name]));
  const roles: Record<string, CategoryRole> = {};
  for (const id of Object.keys(settings.roles).map(Number)) {
    const name = names.get(id) ?? String(id);
    if (byName[name]) settings.roles[id] = byName[name];
    roles[name] = settings.roles[id];
  }
  return { settings, roles };
}

const PUNCTUATED = /[。？！，,.?!；;：:、]/;

/**
 * A long card that is really a dictionary entry: an idiom, a proper name. It
 * has no punctuation, the dictionary has it as a headword, and the owner never
 * studied it as a card of their own. That is vocabulary, not a sentence to
 * read, so it is not taken. (One the owner did study in Pleco stays.)
 */
function isEntry(text: Corpus["texts"][number], dict: Dict): boolean {
  return !text.pleco && !PUNCTUATED.test(text.zh) && dict.lookup(text.key).length > 0;
}

/** A card's own pinyin, if it has one syllable per character; a sentence deck's stray word cards don't. */
function ownPinyin(word: string, prons: string[]): string | null {
  const length = [...word].length;
  return prons.find((p) => p.split(/[@ ]+/).filter(Boolean).length === length) ?? null;
}

interface WordRow {
  w: string;
  s: "deck" | "listed";
  p: string | null;
  d: unknown[];
  g: string[];
  k: PlecoSeed | null;
  l: string[];
}

function wordRows(corpus: Corpus, dict: Dict): WordRow[] {
  const rows: WordRow[] = [];
  for (const w of corpus.words.values()) {
    // A word card filed only under a sentence deck is lesson vocabulary: not
    // the owner's, and not on a list to learn from.
    if (!w.known && !w.inList) continue;
    const defs = definitionsFor(dict, w.w, ownPinyin(w.w, w.prons), w.defn);
    rows.push({
      w: w.w,
      s: w.known ? "deck" : "listed",
      p: ownPinyin(w.w, w.prons) ?? defs.find((d) => !d.own)?.p ?? null,
      d: defs,
      g: w.known ? glossesOf(defs) : [],
      k: w.pleco,
      // Pleco's 歌词 lists are filed under Spotify, with the songs added here.
      l: w.lists.map(songListOf),
    });
  }
  return rows;
}

function sourcesOf(corpus: Corpus, settings: Settings, pools: number[]): string[] {
  const names = new Map(corpus.categories.map((c) => [c.id, c.name]));
  const out = new Set<string>();
  for (const p of pools) out.add(settings.roles[p] === "words" ? OWN_SOURCE : (names.get(p) ?? OWN_SOURCE));
  if (!out.size) out.add(OWN_SOURCE);
  return [...out].sort();
}

interface CardSeed {
  kind: CardKind;
  word?: string;
  sentenceId?: number;
  meaningId?: number;
  schedule: Schedule;
}

/** Insert cards that don't exist yet. A card that does is left exactly as it is. */
export async function insertCards(sql: Sql, owner: string, cards: CardSeed[]): Promise<number> {
  let inserted = 0;
  for (const batch of batches(cards)) {
    const payload = JSON.stringify(
      batch.map((c) => ({ k: c.kind, w: c.word ?? null, s: c.sentenceId ?? null, m: c.meaningId ?? null, ...c.schedule })),
    );
    const rows = (await sql`
      insert into chongfuxi_card
        (owner_email, kind, word, sentence_id, meaning_id,
         state, due, stability, difficulty, reps, lapses, scheduled_days, last_review)
      select ${owner}, e.value->>'k', e.value->>'w', (e.value->>'s')::bigint, (e.value->>'m')::bigint,
             (e.value->>'state')::smallint,
             to_timestamp((e.value->>'due')::double precision / 1000),
             (e.value->>'stability')::double precision,
             (e.value->>'difficulty')::double precision,
             (e.value->>'reps')::int,
             (e.value->>'lapses')::int,
             (e.value->>'scheduledDays')::int,
             to_timestamp((e.value->>'lastReview')::double precision / 1000)
      from jsonb_array_elements(${payload}::jsonb) e
      on conflict do nothing
      returning id
    `) as unknown as unknown[];
    inserted += rows.length;
  }
  return inserted;
}

export interface UnlockResult {
  sentences: number;
  readable: number;
  oneAway: number;
  /** Sentences that became readable in this pass. */
  unlocked: number;
  /** Sentences that stopped being readable (a name unmarked). */
  relocked: number;
}

/**
 * Work out, for every sentence, the words still blocking it, and bring the
 * sentence cards into line: a sentence that became readable gets its card, and
 * one that stopped being readable has its card set aside.
 *
 * Run after anything that changes which words are known — an import, a name
 * marked or unmarked, a word suspended or brought back. Answering cards never does.
 *
 * @param by  the words that just became known, so a sentence can remember
 *            which of them unlocked it
 */
export async function recomputeUnlocks(sql: Sql, owner: string, by: string[] = [], at = Date.now()): Promise<UnlockResult> {
  const words = await wordStanding(sql, owner);
  const universe = new Set(words.map((w) => w.word));
  const known = new Set(words.filter((w) => w.known).map((w) => w.word));
  const unlock = makeUnlock(known, universe, loadHeadwords());
  const fresh = new Set(by);

  const sentences = (await sql`
    select id::int as id, blockers, pleco from chongfuxi_sentence where owner_email = ${owner}
  `) as unknown as Array<{ id: number; blockers: string[] | null; pleco: PlecoSeed | null }>;
  const tokens = (await sql`
    select sentence_id::int as id, array_agg(word order by pos) as words
    from chongfuxi_token where owner_email = ${owner}
    group by sentence_id
  `) as unknown as Array<{ id: number; words: string[] }>;
  const wordsOf = new Map(tokens.map((t) => [t.id, t.words]));

  const changes: Array<{ id: number; b: string[]; u: boolean; by: string | null }> = [];
  const opened: Array<{ id: number; pleco: PlecoSeed | null }> = [];
  const closed: number[] = [];
  let readable = 0;
  let oneAway = 0;
  for (const s of sentences) {
    const toks = wordsOf.get(s.id) ?? [];
    const now = unlock.blockersOf(toks);
    if (now.length === 0) readable++;
    else if (now.length === 1) oneAway++;
    const was = s.blockers;
    if (was && was.length === now.length && was.every((w, i) => w === now[i])) continue;
    const becameReadable = now.length === 0 && (was === null || was.length > 0);
    if (becameReadable) opened.push({ id: s.id, pleco: s.pleco });
    if (now.length > 0 && was !== null && was.length === 0) closed.push(s.id);
    changes.push({ id: s.id, b: now, u: becameReadable, by: becameReadable ? (toks.find((w) => fresh.has(w)) ?? null) : null });
  }

  for (const batch of batches(changes, 2000)) {
    await sql`
      update chongfuxi_sentence s
      set blockers    = array(select jsonb_array_elements_text(e.value->'b')),
          unlocked_at = case when (e.value->>'u')::boolean then to_timestamp(${at}::double precision / 1000) else s.unlocked_at end,
          unlocked_by = case when (e.value->>'u')::boolean then e.value->>'by' else s.unlocked_by end
      from jsonb_array_elements(${JSON.stringify(batch)}::jsonb) e
      where s.owner_email = ${owner} and s.id = (e.value->>'id')::bigint
    `;
  }

  if (opened.length) {
    // One studied in Pleco starts from its score there; the rest start new.
    await insertCards(
      sql,
      owner,
      opened.map((s) => ({ kind: "sentence" as const, sentenceId: s.id, schedule: seedSchedule(s.pleco, "sentence", at) })),
    );
    // Woken as it unlocks, unless the owner put it away by hand.
    await ensureSuspendedSentences(sql);
    for (const batch of batches(opened.map((s) => s.id), 5000)) {
      await sql`
        update chongfuxi_card c set suspended = false
        where c.owner_email = ${owner} and c.kind = 'sentence' and c.suspended and c.sentence_id = any(${batch}::bigint[])
          and not exists (select 1 from chongfuxi_sentence_suspended x where x.owner_email = c.owner_email and x.sentence_id = c.sentence_id)
      `;
    }
  }
  for (const batch of batches(closed, 5000)) {
    await sql`
      update chongfuxi_card set suspended = true
      where owner_email = ${owner} and kind = 'sentence' and sentence_id = any(${batch}::bigint[])
    `;
  }

  return { sentences: sentences.length, readable, oneAway, unlocked: opened.length, relocked: closed.length };
}

export async function ingest(
  sql: Sql,
  owner: string,
  snapshot: PlecoSnapshot,
  file: { importId: string; fileName: string },
  dict: Dict,
  options: IngestOptions = {},
): Promise<IngestSummary> {
  const at = options.at ?? Date.now();
  const log = options.log ?? (() => {});
  const { settings, roles } = settingsFor(snapshot, { ...(await lastRoles(sql, owner)), ...options.roles });
  const corpus = buildCorpus(snapshot, settings);
  const entries = corpus.texts.filter((t) => isEntry(t, dict)).length;
  corpus.texts = corpus.texts.filter((t) => !isEntry(t, dict));
  const words = wordRows(corpus, dict);
  log(`${corpus.texts.length.toLocaleString("en-US")} sentences and ${words.length.toLocaleString("en-US")} words read from ${snapshot.cards.length.toLocaleString("en-US")} cards (${entries} dictionary entries and ${corpus.stats.cutShort} sentences cut short left out)`);

  // What is there already, to say what this adds.
  const existing = await wordStanding(sql, owner);
  const had = (await sql`
    select key, (blockers is not null and cardinality(blockers) = 0) as readable
    from chongfuxi_sentence where owner_email = ${owner}
  `) as unknown as Array<{ key: string; readable: boolean }>;
  const deckBefore = new Set(existing.filter((w) => w.status === "deck").map((w) => w.word));
  const readableBefore = new Set(had.filter((s) => s.readable).map((s) => s.key));
  const keysBefore = new Set(had.map((s) => s.key));

  const deck = words.filter((w) => w.s === "deck");
  const added = deck.filter((w) => !deckBefore.has(w.w)).map((w) => w.w);
  const suspended = new Set(existing.filter((w) => w.status === "deck" && !w.known).map((w) => w.word));
  const knownAfter = new Set([
    ...existing.filter((w) => w.known).map((w) => w.word),
    ...deck.map((w) => w.w).filter((w) => !suspended.has(w)),
  ]);
  const universeAfter = new Set([...existing.map((w) => w.word), ...words.map((w) => w.w)]);
  const unlock = makeUnlock(knownAfter, universeAfter, loadHeadwords());
  let readable = 0;
  let oneAway = 0;
  let unlocked = 0;
  for (const t of corpus.texts) {
    const n = unlock.blockersOf(t.words).length;
    if (n === 0) {
      readable++;
      if (!readableBefore.has(t.key)) unlocked++;
    } else if (n === 1) oneAway++;
  }

  const summary: IngestSummary = {
    fileName: file.fileName,
    dryRun: Boolean(options.dryRun),
    cards: snapshot.cards.length,
    words: { total: new Set([...deckBefore, ...deck.map((w) => w.w)]).size, added: added.length, sample: added.slice(0, 24) },
    sentences: {
      total: new Set([...keysBefore, ...corpus.texts.map((t) => t.key)]).size,
      added: corpus.texts.filter((t) => !keysBefore.has(t.key)).length,
      readable,
      oneAway,
      unlocked,
    },
    roles,
  };
  if (options.dryRun) return summary;

  // ---- words
  for (const batch of batches(words)) {
    await sql`
      insert into chongfuxi_word (owner_email, word, status, pinyin, defs, glosses, pleco, lists, import_id)
      select ${owner}, e.value->>'w', e.value->>'s', e.value->>'p',
             coalesce(e.value->'d', '[]'::jsonb),
             array(select jsonb_array_elements_text(coalesce(e.value->'g', '[]'::jsonb))),
             nullif(e.value->'k', 'null'::jsonb),
             array(select jsonb_array_elements_text(coalesce(e.value->'l', '[]'::jsonb))),
             ${file.importId}
      from jsonb_array_elements(${JSON.stringify(batch)}::jsonb) e
      on conflict (owner_email, word) do update set
        -- A deck word stays one; a marked name stays a name unless Pleco now has it as a word.
        status = case
          when chongfuxi_word.status = 'deck' or excluded.status = 'deck' then 'deck'
          when chongfuxi_word.status = 'name' then 'name'
          else excluded.status
        end,
        pinyin    = coalesce(excluded.pinyin, chongfuxi_word.pinyin),
        -- A definition the model wrote stays until the import brings one.
        defs      = case when jsonb_array_length(excluded.defs) = 0 and chongfuxi_word.defs @> '[{"ai": true}]'
                         then chongfuxi_word.defs else excluded.defs end,
        glosses   = case when jsonb_array_length(excluded.defs) = 0 and chongfuxi_word.defs @> '[{"ai": true}]'
                         then chongfuxi_word.glosses else excluded.glosses end,
        pleco     = coalesce(excluded.pleco, chongfuxi_word.pleco),
        -- Pleco's lists as Pleco has them now, and the songs added here kept.
        lists     = array(
          select distinct x from unnest(excluded.lists || array(
            select l from unnest(chongfuxi_word.lists) l where l like ${`${SPOTIFY_LIST}/%`}
          )) x
        ),
        import_id = excluded.import_id
    `;
  }
  log(`words written (${deck.length.toLocaleString("en-US")} in the deck)`);

  // ---- sentences, and the tokens of the new ones
  let tokenRows = 0;
  for (const batch of batches(corpus.texts)) {
    const payload = JSON.stringify(
      batch.map((t) => ({ k: t.key, z: t.zh, e: t.en, s: t.source, o: sourcesOf(corpus, settings, t.pools), p: t.pleco })),
    );
    const rows = (await sql`
      insert into chongfuxi_sentence (owner_email, key, zh, en, split, sources, pleco, import_id)
      select ${owner}, e.value->>'k', e.value->>'z', e.value->>'e', e.value->>'s',
             array(select jsonb_array_elements_text(e.value->'o')),
             nullif(e.value->'p', 'null'::jsonb),
             ${file.importId}
      from jsonb_array_elements(${payload}::jsonb) e
      on conflict (owner_email, key) do update set
        en      = coalesce(excluded.en, chongfuxi_sentence.en),
        sources = array(select distinct unnest(chongfuxi_sentence.sources || excluded.sources) order by 1),
        pleco   = coalesce(excluded.pleco, chongfuxi_sentence.pleco)
      returning id::int as id, key, (xmax = 0) as inserted
    `) as unknown as Array<{ id: number; key: string; inserted: boolean }>;
    const idOf = new Map(rows.filter((r) => r.inserted).map((r) => [r.key, r.id]));
    const fresh = batch.filter((t) => idOf.has(t.key)).map((t) => ({ i: idOf.get(t.key)!, w: t.words }));
    // A sentence's tokens are written once, with the sentence: its split is a
    // record of how it was read, and cards that showed it refer to it.
    for (const part of batches(fresh, TOKEN_BATCH)) {
      await sql`
        insert into chongfuxi_token (owner_email, sentence_id, pos, word)
        select ${owner}, (e.value->>'i')::bigint, (t.ord - 1)::int, t.word
        from jsonb_array_elements(${JSON.stringify(part)}::jsonb) e,
             jsonb_array_elements_text(e.value->'w') with ordinality as t(word, ord)
        on conflict do nothing
      `;
      tokenRows += part.reduce((n, s) => n + s.w.length, 0);
    }
  }
  log(`sentences written (${summary.sentences.added.toLocaleString("en-US")} new, ${tokenRows.toLocaleString("en-US")} tokens)`);

  // ---- a Read card for every deck word
  const seeds = deck.map((w) => ({ kind: "read" as const, word: w.w, schedule: seedSchedule(w.k, "read", at) }));
  const made = await insertCards(sql, owner, seeds);
  log(`${made.toLocaleString("en-US")} word cards made`);

  // ---- which sentences that leaves readable
  // On the first import everything readable is simply where things start; only
  // later does a sentence have a word that unlocked it.
  const result = await recomputeUnlocks(sql, owner, deckBefore.size ? added : [], at);
  log(`${result.readable.toLocaleString("en-US")} sentences readable (${result.unlocked.toLocaleString("en-US")} newly), ${result.oneAway.toLocaleString("en-US")} one word away`);

  await sql`
    update chongfuxi_import
    set settings = ${JSON.stringify({ roles, knownIfScored: settings.knownIfScored })}::jsonb,
        ingested = to_timestamp(${at}::double precision / 1000)
    where owner_email = ${owner} and id = ${file.importId}
  `;
  // Chengyu the import made known join 龙库.
  await reconcileLongku(sql, owner);
  // Definitions were written in the dictionary's order: where a word's record can't choose, its sentences do.
  await orderStoredDefs(sql, owner);

  return { ...summary, sentences: { ...summary.sentences, readable: result.readable, oneAway: result.oneAway, unlocked: result.unlocked } };
}

/**
 * Mark a word as a name — it stops blocking sentences and is never reviewed —
 * or take that back. Only words that aren't in the deck can be names.
 */
/**
 * Take sentences out of the corpus, for good: each is kept as it was in
 * chongfuxi_sentence_left_out (same id, with `reason`), since a review row or
 * the Learn log may name it. Its words in order go with it. Its sentence card
 * goes too, unless it was answered here: then it is retired, so it never
 * comes back, and its answers stay. Returns how many were taken out.
 */
export async function leaveOutSentences(sql: Sql, owner: string, ids: number[], reason: string): Promise<number> {
  if (!ids.length) return 0;
  const [, , , gone] = (await sql.transaction([
    sql`
      insert into chongfuxi_sentence_left_out (owner_email, id, key, zh, en, sources, reason)
      select owner_email, id, key, zh, en, sources, ${reason}
      from chongfuxi_sentence where owner_email = ${owner} and id = any(${ids}::bigint[])
      on conflict (owner_email, id) do nothing
    `,
    sql`
      update chongfuxi_card set retired = coalesce(retired, now())
      where owner_email = ${owner} and kind = 'sentence' and sentence_id = any(${ids}::bigint[]) and answered > 0
    `,
    sql`
      delete from chongfuxi_card
      where owner_email = ${owner} and kind = 'sentence' and sentence_id = any(${ids}::bigint[]) and answered = 0
    `,
    sql`delete from chongfuxi_sentence where owner_email = ${owner} and id = any(${ids}::bigint[]) returning id`,
  ])) as unknown as [unknown, unknown, unknown, Array<{ id: number }>];
  return gone.length;
}

export async function setName(sql: Sql, owner: string, word: string, on: boolean): Promise<UnlockResult> {
  if (on) {
    await sql`
      insert into chongfuxi_word (owner_email, word, status)
      values (${owner}, ${word}, 'name')
      on conflict (owner_email, word) do update set status = 'name'
      where chongfuxi_word.status = 'listed'
    `;
  } else {
    // Back to a candidate if it came from one of the Pleco lists, gone otherwise.
    await sql`
      update chongfuxi_word set status = 'listed'
      where owner_email = ${owner} and word = ${word} and status = 'name' and import_id is not null
    `;
    await sql`delete from chongfuxi_word where owner_email = ${owner} and word = ${word} and status = 'name'`;
  }
  return recomputeUnlocks(sql, owner, on ? [word] : []);
}

// ------------------------------------------------- sentences from elsewhere --

/** A sentence from a deck that isn't Pleco: just the text, its pinyin and a translation. */
export interface LooseSentence {
  zh: string;
  pinyin: string;
  en: string | null;
  source: string;
}

/** A sentence from another deck has at least this many characters. Two is a number and its measure word, or a name. */
const MIN_SENTENCE_HAN = 3;

export interface SourceCount {
  /** Sentences the deck has under this source. */
  found: number;
  /** One word, or under three characters (三天。 老三。): not something to read. */
  tooShort: number;
  /** The same sentence again, earlier in this file. */
  repeated: number;
  /** Already in the corpus, from Pleco or an earlier import. */
  already: number;
  added: number;
  /** Of the added, readable with the words known now. */
  readable: number;
  /** Of the added, split by the dictionary because the pinyin gave no word breaks. */
  byDictionary: number;
}

/** Longest word the dictionary split will look for. Longer entries are mostly phrases. */
const SPLIT_MAX = 4;

/**
 * Add sentences from another deck to the corpus. Sentences only: nothing here
 * creates or changes a word, so nothing becomes known that wasn't.
 *
 * Each sentence is split into words by its own pinyin when that marks word
 * breaks and fits the characters, otherwise by longest match against the
 * dictionary and the words the corpus has. A sentence already there (the same
 * characters) is left as it is and only gains the source's name.
 */
export async function ingestSentences(
  sql: Sql,
  owner: string,
  sentences: LooseSentence[],
  dict: Dict,
  options: {
    importId?: string;
    dryRun?: boolean;
    at?: number;
    log?: (line: string) => void;
    samples?: number;
    /** Take a sample every this many new sentences (a big deck: rarely; a few lessons: often). */
    sampleEvery?: number;
  } = {},
): Promise<{ bySource: Record<string, SourceCount>; total: SourceCount; samples: Array<{ zh: string; words: string[]; split: string; blockers: string[] }> }> {
  const log = options.log ?? (() => {});
  const wordRows = await wordStanding(sql, owner);
  const had = (await sql`
    select key from chongfuxi_sentence where owner_email = ${owner}
  `) as unknown as Array<{ key: string }>;
  const existing = new Set(had.map((h) => h.key));
  const universe = new Set(wordRows.map((w) => w.word));
  const unlock = makeUnlock(new Set(wordRows.filter((w) => w.known).map((w) => w.word)), universe, loadHeadwords());

  const vocab = dict.headwords(SPLIT_MAX);
  for (const w of universe) if ([...w].length <= SPLIT_MAX) vocab.add(w);
  const context = { charReadings: dict.readings as Map<string, Set<string>>, vocab, maxLen: SPLIT_MAX };

  const blank = (): SourceCount => ({ found: 0, tooShort: 0, repeated: 0, already: 0, added: 0, readable: 0, byDictionary: 0 });
  const bySource: Record<string, SourceCount> = {};
  const seen = new Map<string, string[]>();
  const rows: Array<{ k: string; z: string; e: string | null; s: string; o: string[]; w: string[] }> = [];
  const tagging = new Map<string, Set<string>>();
  const samples: Array<{ zh: string; words: string[]; split: string; blockers: string[] }> = [];

  for (const item of sentences) {
    const count = (bySource[item.source] ??= blank());
    count.found++;
    const han = [...item.zh].filter(isHan);
    const key = han.join("");
    // Pinyin spaced a syllable at a time (wǒ hěn xiàng wǒ bà ba) says nothing about words.
    const perSyllable = item.pinyin.trim().split(/\s+/).length >= han.length && han.length >= 3;
    const byPinyin = perSyllable ? null : wordsByPinyin(han, item.pinyin, dict.syllables, dict.readings);
    const words = byPinyin ?? segmentByDictionary(item.zh, context).words;
    if (words.length < 2 || han.length < MIN_SENTENCE_HAN) {
      count.tooShort++;
      continue;
    }
    if (seen.has(key)) {
      count.repeated++;
      const sources = seen.get(key)!;
      if (!sources.includes(item.source)) sources.push(item.source);
      continue;
    }
    if (existing.has(key)) {
      count.already++;
      (tagging.get(key) ?? tagging.set(key, new Set()).get(key)!).add(item.source);
      continue;
    }
    const sources = [item.source];
    seen.set(key, sources);
    const blockers = unlock.blockersOf(words);
    count.added++;
    if (!blockers.length) count.readable++;
    if (!byPinyin) count.byDictionary++;
    rows.push({ k: key, z: item.zh, e: item.en, s: byPinyin ? "pinyin" : "dictionary", o: sources, w: words });
    if (samples.length < (options.samples ?? 0) && rows.length % (options.sampleEvery ?? 997) === 1) samples.push({ zh: item.zh, words, split: byPinyin ? "pinyin" : "dictionary", blockers });
  }

  const total = blank();
  for (const c of Object.values(bySource)) for (const k of Object.keys(total) as Array<keyof SourceCount>) total[k] += c[k];
  if (options.dryRun) return { bySource, total, samples };

  for (const batch of batches(rows)) {
    const inserted = (await sql`
      insert into chongfuxi_sentence (owner_email, key, zh, en, split, sources, import_id)
      select ${owner}, e.value->>'k', e.value->>'z', e.value->>'e', e.value->>'s',
             array(select jsonb_array_elements_text(e.value->'o')), ${options.importId ?? null}
      from jsonb_array_elements(${JSON.stringify(batch.map(({ w: _w, ...r }) => r))}::jsonb) e
      on conflict (owner_email, key) do nothing
      returning id::int as id, key
    `) as unknown as Array<{ id: number; key: string }>;
    const idOf = new Map(inserted.map((r) => [r.key, r.id]));
    const fresh = batch.filter((r) => idOf.has(r.k)).map((r) => ({ i: idOf.get(r.k)!, w: r.w }));
    for (const part of batches(fresh, TOKEN_BATCH)) {
      await sql`
        insert into chongfuxi_token (owner_email, sentence_id, pos, word)
        select ${owner}, (e.value->>'i')::bigint, (t.ord - 1)::int, t.word
        from jsonb_array_elements(${JSON.stringify(part)}::jsonb) e,
             jsonb_array_elements_text(e.value->'w') with ordinality as t(word, ord)
        on conflict do nothing
      `;
    }
  }
  log(`${rows.length.toLocaleString("en-US")} sentences written`);

  // A sentence that was already there now also names this deck as a source.
  const tags = [...tagging].map(([k, set]) => ({ k, o: [...set] }));
  for (const batch of batches(tags, 2000)) {
    await sql`
      update chongfuxi_sentence s
      set sources = array(select distinct unnest(s.sources || array(select jsonb_array_elements_text(e.value->'o'))) order by 1)
      from jsonb_array_elements(${JSON.stringify(batch)}::jsonb) e
      where s.owner_email = ${owner} and s.key = e.value->>'k'
    `;
  }

  const result = await recomputeUnlocks(sql, owner, [], options.at);
  log(`${result.readable.toLocaleString("en-US")} sentences readable in all (${result.unlocked.toLocaleString("en-US")} of them new cards)`);
  return { bySource, total, samples };
}
