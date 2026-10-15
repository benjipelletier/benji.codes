// Evidence for Look up: what the owner's own corpus, the deck and CC-CEDICT
// say, as functions the model calls (lookup.ts). Facts come from here, never
// from the model: every sentence, count and reading it cites must have come
// back from one of these in the same lookup, which the check after the model
// makes sure of (`Seen`).
//
// The corpus is the owner's sentences (most with an English translation, so
// they work as a small parallel corpus) and their words in order
// (chongfuxi_token), which give word pairs: what comes before or after a word.

import type { Sql } from "./db";
import { dictEntries, englishToChinese } from "./headwords";
import { displayPinyin } from "@chongfuxi/lib/hanzi";

/** What a lookup has been shown, for checking the answer against. */
export interface Seen {
  /** Sentence ids the tools returned. */
  sentences: Set<number>;
  /** Counts the tools returned, by the word (or "a+b" pair) they count. */
  counts: Map<string, Set<number>>;
  /** Words the dictionary tool was asked about and found. */
  looked: Set<string>;
}

export const newSeen = (): Seen => ({ sentences: new Set(), counts: new Map(), looked: new Set() });

function saw(seen: Seen, key: string, n: number) {
  const set = seen.counts.get(key) ?? new Set<number>();
  set.add(n);
  seen.counts.set(key, set);
}

const HAN = "[㐀-鿿]";
/** English words too common to search on. */
const STOP = new Set(
  "a an the to of in on at for with and or but is are was were be been am i you he she it we they my your his her its our their me him us them this that these those do does did have has had not no so as by from up out about into over get got".split(
    " ",
  ),
);

/** "developed depression" → ["develop%", "depression%"]: each word's stem, as a pattern matching its forms. */
function englishPatterns(english: string): string[] {
  return english
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .slice(0, 5)
    .map((w) => {
      const stem = w.length > 5 ? w.replace(/(ing|ed|es|s)$/, "") : w;
      return `%${stem}%`;
    });
}

export interface SentenceHit {
  id: number;
  zh: string;
  en: string | null;
  /** Readable now; otherwise the words still in the way. */
  readable: boolean;
  blockers: string[];
}

/**
 * The owner's sentences with every one of these English words in the
 * translation and every one of these Chinese words in the sentence, readable
 * first, shortest first. And how many there are in all.
 */
export async function searchSentences(
  sql: Sql,
  owner: string,
  seen: Seen,
  q: { english?: string; chinese?: string[]; limit?: number },
): Promise<{ total: number; sentences: SentenceHit[] }> {
  const en = q.english ? englishPatterns(q.english) : [];
  const zh = (q.chinese ?? []).map((w) => w.trim()).filter(Boolean).slice(0, 4);
  if (!en.length && !zh.length) return { total: 0, sentences: [] };
  const limit = Math.min(Math.max(q.limit ?? 10, 1), 20);
  const rows = (await sql`
    select s.id::int as id, s.zh, s.en, s.blockers, count(*) over ()::int as total
    from chongfuxi_sentence s
    where s.owner_email = ${owner}
      and not exists (select 1 from unnest(${en}::text[]) p where s.en is null or s.en not ilike p)
      and not exists (select 1 from unnest(${zh}::text[]) w where strpos(s.zh, w) = 0)
    order by cardinality(s.blockers), char_length(s.zh), s.id
    limit ${limit}
  `) as unknown as Array<{ id: number; zh: string; en: string | null; blockers: string[]; total: number }>;
  const total = rows[0]?.total ?? 0;
  rows.forEach((r) => seen.sentences.add(r.id));
  if (zh.length === 1) saw(seen, zh[0], total);
  return {
    total,
    sentences: rows.map((r) => ({ id: r.id, zh: r.zh, en: r.en, readable: r.blockers.length === 0, blockers: r.blockers })),
  };
}

/**
 * The words that come just before (or after) this one in the owner's
 * sentences, within `window` words, by how many sentences have the pair:
 * what it goes with, as far as this corpus knows.
 */
export async function neighbours(
  sql: Sql,
  owner: string,
  seen: Seen,
  q: { word: string; side: "before" | "after"; window?: number },
): Promise<{ word: string; side: string; sentencesWithWord: number; pairs: Array<{ word: string; sentences: number }> }> {
  const word = q.word.trim();
  const w = Math.min(Math.max(q.window ?? 1, 1), 3);
  const before = q.side === "before";
  const [{ n }] = (await sql`
    select count(distinct sentence_id)::int as n from chongfuxi_token where owner_email = ${owner} and word = ${word}
  `) as unknown as Array<{ n: number }>;
  const rows = (await sql`
    select o.word, count(distinct t.sentence_id)::int as sentences
    from chongfuxi_token t
    join chongfuxi_token o on o.owner_email = t.owner_email and o.sentence_id = t.sentence_id
      and (case when ${before}::boolean then o.pos between t.pos - ${w} and t.pos - 1 else o.pos between t.pos + 1 and t.pos + ${w} end)
    where t.owner_email = ${owner} and t.word = ${word} and o.word ~ ${HAN}
    group by o.word
    order by sentences desc, o.word
    limit 25
  `) as unknown as Array<{ word: string; sentences: number }>;
  saw(seen, word, n);
  for (const r of rows) saw(seen, before ? `${r.word}+${word}` : `${word}+${r.word}`, r.sentences);
  return { word, side: q.side, sentencesWithWord: n, pairs: rows };
}

/** How many of the owner's sentences have `first` followed by `second` within `window` words, with a few of them. */
export async function together(
  sql: Sql,
  owner: string,
  seen: Seen,
  q: { first: string; second: string; window?: number },
): Promise<{ first: string; second: string; sentences: number; examples: SentenceHit[] }> {
  const w = Math.min(Math.max(q.window ?? 2, 1), 4);
  const rows = (await sql`
    select s.id::int as id, s.zh, s.en, s.blockers, count(*) over ()::int as total
    from chongfuxi_sentence s
    where s.owner_email = ${owner} and exists (
      select 1 from chongfuxi_token a join chongfuxi_token b
        on b.owner_email = a.owner_email and b.sentence_id = a.sentence_id and b.pos between a.pos + 1 and a.pos + ${w}
      where a.owner_email = s.owner_email and a.sentence_id = s.id and a.word = ${q.first} and b.word = ${q.second}
    )
    order by cardinality(s.blockers), char_length(s.zh), s.id
    limit 5
  `) as unknown as Array<{ id: number; zh: string; en: string | null; blockers: string[]; total: number }>;
  const total = rows[0]?.total ?? 0;
  rows.forEach((r) => seen.sentences.add(r.id));
  saw(seen, `${q.first}+${q.second}`, total);
  return {
    first: q.first,
    second: q.second,
    sentences: total,
    examples: rows.map((r) => ({ id: r.id, zh: r.zh, en: r.en, readable: r.blockers.length === 0, blockers: r.blockers })),
  };
}

/** Where a word stands in the deck: not in it, or in it with its Read card's strength in days. */
async function standing(sql: Sql, owner: string, words: string[]) {
  if (!words.length) return new Map<string, { status: string; strengthDays: number | null }>();
  const rows = (await sql`
    select w.word, w.status, c.stability
    from chongfuxi_word w
    left join chongfuxi_card c on c.owner_email = w.owner_email and c.kind = 'read' and c.meaning_id is null and c.word = w.word
    where w.owner_email = ${owner} and w.word = any(${words}::text[])
  `) as unknown as Array<{ word: string; status: string; stability: number | null }>;
  return new Map(rows.map((r) => [r.word, { status: r.status, strengthDays: r.stability === null ? null : Math.round(r.stability) }]));
}

/** How many of the owner's sentences have each word as a word of its own. */
async function corpusCounts(sql: Sql, owner: string, words: string[]) {
  if (!words.length) return new Map<string, number>();
  const rows = (await sql`
    select word, count(distinct sentence_id)::int as n from chongfuxi_token
    where owner_email = ${owner} and word = any(${words}::text[])
    group by word
  `) as unknown as Array<{ word: string; n: number }>;
  return new Map(rows.map((r) => [r.word, r.n]));
}

/** Each word's CC-CEDICT entries, whether it is in the deck (and how strong), and how many of the owner's sentences have it. */
export async function dictionary(sql: Sql, owner: string, seen: Seen, q: { words: string[] }) {
  const words = [...new Set(q.words.map((w) => w.trim()).filter(Boolean))].slice(0, 12);
  const [deck, counts] = await Promise.all([standing(sql, owner, words), corpusCounts(sql, owner, words)]);
  return words.map((word) => {
    const entries = dictEntries(word);
    if (entries.length) seen.looked.add(word);
    const n = counts.get(word) ?? 0;
    saw(seen, word, n);
    const d = deck.get(word);
    return {
      word,
      inDictionary: entries.length > 0,
      entries: entries.slice(0, 4).map((e) => ({ pinyin: displayPinyin(e.p), senses: e.senses.slice(0, 6) })),
      deck: d ? (d.status === "deck" ? { inDeck: true, strengthDays: d.strengthDays } : { inDeck: false, listedAs: d.status }) : { inDeck: false },
      sentencesInCorpus: n,
    };
  });
}

/** Chinese headwords whose dictionary senses say this English, with how often each appears in the owner's sentences. */
export async function englishCandidates(sql: Sql, owner: string, seen: Seen, q: { english: string }) {
  const found = englishToChinese(q.english, 40);
  const counts = await corpusCounts(
    sql,
    owner,
    found.map((f) => f.word),
  );
  for (const f of found) saw(seen, f.word, counts.get(f.word) ?? 0);
  return found
    .map((f) => ({ word: f.word, pinyin: displayPinyin(f.p), sense: f.sense, exact: f.score === 3, sentencesInCorpus: counts.get(f.word) ?? 0 }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.sentencesInCorpus - a.sentencesInCorpus)
    .slice(0, 25);
}
