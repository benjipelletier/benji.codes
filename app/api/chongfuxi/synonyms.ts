// Words with the same English, and how they differ. Every deck and list
// word's senses are cut into English keys (lib/synonyms.ts) and kept in
// chongfuxi_gloss_key, made again when the words change; a key shared by two
// or more deck words near the top of their entries is a group (经历, 经验,
// 阅历 by "experience"). Cards › Synonyms lists the groups that trip the owner
// most; a group's page puts its words side by side from the data (senses,
// characters, the words around them in the owner's sentences, an example,
// the owner's record), with the dictionary's other words for the key on a
// toggle, and the model's comparison on request (compareGroup, owner only).
// The owner asked for it, to tell apart words like 经历 and 经验.

import Anthropic from "@anthropic-ai/sdk";
import type { Sql } from "./db";
import type { SynonymCompare, SynonymGroup, SynonymGroupRow, SynonymWord } from "@chongfuxi/lib/api";
import type { Definition } from "@chongfuxi/lib/dict";
import { zhShown } from "@chongfuxi/lib/hanzi";
import { KEY_VERSION, MAX_GROUP, keyOf, senseKeys } from "@chongfuxi/lib/synonyms";
import { allEntries, dictEntries, dictEntry } from "./headwords";
import { EFFORT, MODEL } from "./lookup";
import { hskOf, shownPinyin } from "./review";
import { wordSentences } from "./wordpage";

export class SynonymError extends Error {}

/** A key is a group's only when it comes this early in at least two of its words' entries (0 first). */
export const NEAR_TOP = 2;
/** Groups listed at a time. */
const LIST = 60;
/** Dictionary words shown after the owner's (always, greyed), at most. */
const DICTIONARY = 30;
/** Recent enough to count towards a group's trouble. */
const TROUBLE_DAYS = 90;
const DAY = 86_400_000;

let ready = false;
async function ensureTables(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_gloss_key (
      owner_email text not null,
      key text not null,
      word text not null,
      rank smallint not null,
      sense text not null,
      primary key (owner_email, key, word)
    )
  `;
  await sql`create index if not exists chongfuxi_gloss_key_word on chongfuxi_gloss_key (owner_email, word)`;
  await sql`
    create table if not exists chongfuxi_gloss_meta (
      owner_email text primary key,
      built_at timestamptz not null default now(),
      words int not null,
      version int not null
    )
  `;
  await sql`
    create table if not exists chongfuxi_synonym_compare (
      owner_email text not null,
      key text not null,
      at timestamptz not null default now(),
      model text not null,
      words text[] not null,
      compare jsonb not null,
      primary key (owner_email, key)
    )
  `;
  ready = true;
}

/**
 * The keys, made again when the deck and list words (with a definition)
 * aren't the ones last cut (a digest of them and their definitions), or the
 * cutting has changed.
 */
export async function ensureKeys(sql: Sql, owner: string) {
  await ensureTables(sql);
  const [now] = (await sql`
    select (coalesce(sum(hashtext(word || ':' || defs::text)::bigint), 0) % 2147483647)::int as digest
    from chongfuxi_word where owner_email = ${owner} and status in ('deck', 'listed') and jsonb_array_length(defs) > 0
  `) as unknown as Array<{ digest: number }>;
  // A digest of the words and their definitions: any word added, removed or redefined changes it.
  const stamp = now.digest;
  const [meta] = (await sql`select words, version from chongfuxi_gloss_meta where owner_email = ${owner}`) as unknown as Array<{
    words: number;
    version: number;
  }>;
  if (meta && meta.words === stamp && meta.version === KEY_VERSION) return;

  const rows = (await sql`
    select word, defs from chongfuxi_word
    where owner_email = ${owner} and status in ('deck', 'listed') and jsonb_array_length(defs) > 0
  `) as unknown as Array<{ word: string; defs: Definition[] }>;
  const keys = rows.flatMap((r) =>
    senseKeys(r.defs.filter((d) => !d.own).flatMap((d) => d.senses)).map((k) => ({ k: k.key, w: r.word, r: k.rank, s: k.sense.slice(0, 200) })),
  );
  await sql`delete from chongfuxi_gloss_key where owner_email = ${owner}`;
  for (let i = 0; i < keys.length; i += 5000) {
    await sql`
      insert into chongfuxi_gloss_key (owner_email, key, word, rank, sense)
      select ${owner}, k.k, k.w, k.r, k.s from jsonb_to_recordset(${JSON.stringify(keys.slice(i, i + 5000))}::jsonb) as k(k text, w text, r int, s text)
      on conflict do nothing
    `;
  }
  await sql`
    insert into chongfuxi_gloss_meta (owner_email, built_at, words, version) values (${owner}, now(), ${stamp}, ${KEY_VERSION})
    on conflict (owner_email) do update set built_at = now(), words = excluded.words, version = excluded.version
  `;
}

/**
 * Every English key of the deck and list words, made again first if the
 * words changed, with the stamp they were made at (for callers keeping an
 * index of them, Look up's fuzzy type-ahead).
 */
export async function glossKeys(sql: Sql, owner: string): Promise<{ stamp: string; rows: Array<{ key: string; word: string; rank: number }> } | null> {
  await ensureKeys(sql, owner);
  const [meta] = (await sql`select words, version, built_at::text as at from chongfuxi_gloss_meta where owner_email = ${owner}`) as unknown as Array<{
    words: number;
    version: number;
    at: string;
  }>;
  if (!meta) return null;
  const rows = (await sql`select key, word, rank::int as rank from chongfuxi_gloss_key where owner_email = ${owner}`) as unknown as Array<{
    key: string;
    word: string;
    rank: number;
  }>;
  return { stamp: `${meta.words}:${meta.version}:${meta.at}`, rows };
}

/** The stamp the keys were made at, without reading them: whether a kept index still holds. */
export async function glossStamp(sql: Sql, owner: string): Promise<string | null> {
  await ensureKeys(sql, owner);
  const [meta] = (await sql`select words, version, built_at::text as at from chongfuxi_gloss_meta where owner_email = ${owner}`) as unknown as Array<{
    words: number;
    version: number;
    at: string;
  }>;
  return meta ? `${meta.words}:${meta.version}:${meta.at}` : null;
}

/** Forgots on each word lately (its cards, and trips in sentences), and pairs tapped together in forgotten sentences. */
async function troubleOf(sql: Sql, owner: string, words: string[]) {
  const forgot = new Map<string, number>();
  const pairs = new Map<string, number>();
  if (!words.length) return { forgot, pairs };
  const since = new Date(Date.now() - TROUBLE_DAYS * DAY);
  const rows = (await sql`
    select word, count(*)::int as n from chongfuxi_review
    where owner_email = ${owner} and kind in ('read', 'produce') and cause in ('answer', 'tapped') and grade = 'forgot'
      and at > ${since} and word = any(${words}::text[])
    group by word
  `) as unknown as Array<{ word: string; n: number }>;
  for (const r of rows) forgot.set(r.word, r.n);
  const tapped = (await sql`
    select tapped from chongfuxi_review
    where owner_email = ${owner} and kind = 'sentence' and grade = 'forgot' and cause = 'answer'
      and cardinality(tapped) > 1 and tapped && ${words}::text[]
  `) as unknown as Array<{ tapped: string[] }>;
  const set = new Set(words);
  for (const t of tapped) {
    const ws = [...new Set(t.tapped.filter((w) => set.has(w)))].sort();
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) pairs.set(`${ws[i]}|${ws[j]}`, (pairs.get(`${ws[i]}|${ws[j]}`) ?? 0) + 1);
  }
  return { forgot, pairs };
}

/**
 * The groups, those that trip the owner most first: two or more deck words
 * sharing a key near the top of their entries, the key shared by no more
 * than MAX_GROUP words. `q` finds groups by English (a key starting with
 * it) or by a word in them.
 */
export async function synonymGroups(sql: Sql, owner: string, q = ""): Promise<SynonymGroupRow[]> {
  await ensureKeys(sql, owner);
  const query = q.trim().toLowerCase();
  const han = /[㐀-鿿]/.test(query);
  const rows = (await sql.query(
    `with g as (
       select k.key, array_agg(k.word order by k.rank, char_length(k.word), k.word) as words,
              array_agg(w.status = 'deck' order by k.rank, char_length(k.word), k.word) as deck,
              count(*) filter (where w.status = 'deck' and k.rank <= $2) as near,
              sum(k.rank) as ranks
       from chongfuxi_gloss_key k
       join chongfuxi_word w on w.owner_email = k.owner_email and w.word = k.word
       where k.owner_email = $1
       group by k.key
       having count(*) <= $3
     )
     select key, words, deck from g
     where near >= 2 ${query ? (han ? "and $4 = any(words)" : "and (key = $4 or key like $4 || '%' or key like '% ' || $4 || '%')") : ""}
     order by ranks, key`,
    [owner, NEAR_TOP, MAX_GROUP, ...(query ? [query] : [])],
  )) as unknown as Array<{ key: string; words: string[]; deck: boolean[] }>;
  // Keys with exactly the same words are one group, under the first found (the nearest the top of their entries).
  const bySet = new Map<string, { key: string; words: string[]; deck: boolean[]; also: string[] }>();
  for (const r of rows) {
    const set = [...r.words].sort().join("|");
    const had = bySet.get(set);
    if (had) had.also.push(r.key);
    else bySet.set(set, { ...r, also: [] });
  }
  const merged = [...bySet.values()];
  const all = [...new Set(merged.flatMap((r) => r.words))];
  const { forgot, pairs } = await troubleOf(sql, owner, all);
  const mine = merged
    .map((r) => {
      const ws = r.words;
      let confused = 0;
      for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) confused += pairs.get([ws[i], ws[j]].sort().join("|")) ?? 0;
      return {
        key: r.key,
        also: r.also,
        words: ws.map((w, i) => ({ word: w, inDeck: r.deck[i] })),
        trouble: ws.reduce((n, w) => n + (forgot.get(w) ?? 0), 0) + 3 * confused,
        confused,
      };
    })
    .sort((a, b) => (query && !han ? Number(b.key === query) - Number(a.key === query) : 0) || b.trouble - a.trouble || b.words.length - a.words.length || a.key.localeCompare(b.key))
    .slice(0, LIST);
  if (!query) return mine;

  // A search also looks in the dictionary: the keys of a Chinese word (yours or not), or the English
  // asked for, each as a group of your words with it (any number) and the dictionary's.
  const keys = han
    ? senseKeys(dictEntries(query).flatMap((e) => e.senses)).filter((k) => k.rank <= NEAR_TOP).map((k) => k.key)
    : [keyOf(query)].filter((k): k is string => k !== null);
  const known = new Set(mine.flatMap((g) => [g.key, ...g.also]));
  const extra: SynonymGroupRow[] = [];
  for (const key of keys) {
    if (known.has(key)) continue;
    const dict = dictionaryFor(key);
    const ownRows = (await sql`
      select k.word, w.status = 'deck' as deck from chongfuxi_gloss_key k join chongfuxi_word w on w.owner_email = k.owner_email and w.word = k.word
      where k.owner_email = ${owner} and k.key = ${key} order by k.rank, char_length(k.word)
    `) as unknown as Array<{ word: string; deck: boolean }>;
    const ownWords = new Set(ownRows.map((r) => r.word));
    const others = [...new Set(dict.filter((d) => [...d.word].length > 1 && !ownWords.has(d.word)).sort((a, b) => a.rank - b.rank).map((d) => d.word))];
    if (ownRows.length + others.length < 2 || ownRows.length + others.length > MAX_GROUP * 3) continue;
    extra.push({
      key,
      also: [],
      words: [...ownRows.map((r) => ({ word: r.word, inDeck: r.deck })), ...others.slice(0, 8).map((w) => ({ word: w, inDeck: false, dictionary: true }))],
      trouble: 0,
      confused: 0,
      // One of the owner's groups when two or more of its words are in the deck; else the dictionary's.
      fromDictionary: ownRows.filter((r) => r.deck).length < 2,
    });
  }
  return [...mine, ...extra];
}

/** The keys of one word that make groups, each with its other words: for the word page. */
export async function keysOfWord(sql: Sql, owner: string, word: string): Promise<Array<{ key: string; words: string[] }>> {
  await ensureKeys(sql, owner);
  const rows = (await sql`
    select k.key, array_agg(o.word order by o.rank, char_length(o.word), o.word) filter (where o.word <> ${word}) as words, count(*)::int as n
    from chongfuxi_gloss_key k
    join chongfuxi_gloss_key o on o.owner_email = k.owner_email and o.key = k.key
    join chongfuxi_word w on w.owner_email = o.owner_email and w.word = o.word
    where k.owner_email = ${owner} and k.word = ${word}
    group by k.key, k.rank
    having count(*) between 2 and ${MAX_GROUP}
    order by k.rank, count(*) desc
  `) as unknown as Array<{ key: string; words: string[] | null; n: number }>;
  return rows.filter((r) => r.words?.length).map((r) => ({ key: r.key, words: r.words! }));
}

/** CC-CEDICT's words for each key, made once per server instance on first use of the dictionary toggle. */
let dictionaryIndex: Map<string, Array<{ word: string; p: string; rank: number; senses: string[] }>> | null = null;
function dictionaryFor(key: string) {
  if (!dictionaryIndex) {
    dictionaryIndex = new Map();
    for (const [word, list] of allEntries()) {
      for (const e of list) {
        if (/^[A-Z]/.test(e.p)) continue;
        const senses = e.senses.split("/").filter(Boolean);
        for (const k of senseKeys(senses)) {
          if (k.rank > NEAR_TOP) continue;
          const at = dictionaryIndex.get(k.key);
          const item = { word, p: e.p, rank: k.rank, senses };
          if (at) at.push(item);
          else dictionaryIndex.set(k.key, [item]);
        }
      }
    }
  }
  return dictionaryIndex.get(key) ?? [];
}

/** A group's page: its words side by side, with the dictionary's other words for the key when asked. */
export async function synonymGroup(sql: Sql, owner: string, key: string, withDictionary: boolean): Promise<SynonymGroup | null> {
  await ensureKeys(sql, owner);
  const own = (await sql`
    select k.word, k.sense, w.status, w.pinyin, w.defs, w.lists
    from chongfuxi_gloss_key k join chongfuxi_word w on w.owner_email = k.owner_email and w.word = k.word
    where k.owner_email = ${owner} and k.key = ${key}
    order by w.status = 'deck' desc, k.rank, char_length(k.word), k.word
  `) as unknown as Array<{ word: string; sense: string; status: "deck" | "listed"; pinyin: string | null; defs: Definition[]; lists: string[] | null }>;
  // A key none of the owner's words has can still be a dictionary group, found by a search.
  if (!own.length && (!withDictionary || dictionaryFor(key).length < 2)) return null;
  const words = own.map((o) => o.word);

  const around = (await sql`
    select t.word, n.word as other, (n.pos < t.pos) as before, count(*)::int as n
    from chongfuxi_token t
    join chongfuxi_token n on n.owner_email = t.owner_email and n.sentence_id = t.sentence_id and n.pos in (t.pos - 1, t.pos + 1)
    where t.owner_email = ${owner} and t.word = any(${words}::text[]) and n.word ~ '[\\u3400-\\u9fff]'
    group by t.word, n.word, (n.pos < t.pos)
  `) as unknown as Array<{ word: string; other: string; before: boolean; n: number }>;
  const top = (word: string, before: boolean) =>
    around
      .filter((a) => a.word === word && a.before === before)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((a) => ({ word: a.other, n: a.n }));

  const records = (await sql`
    select w.word,
           (select c.stability from chongfuxi_card c where c.owner_email = w.owner_email and c.word = w.word and c.kind = 'read' and c.meaning_id is null and c.state <> 0) as strength,
           (select count(*)::int from chongfuxi_review r where r.owner_email = w.owner_email and r.word = w.word
              and r.kind in ('read', 'produce') and r.cause in ('answer', 'tapped') and r.grade = 'forgot') as forgot,
           (select count(distinct t.sentence_id)::int from chongfuxi_token t where t.owner_email = w.owner_email and t.word = w.word) as sentences
    from chongfuxi_word w where w.owner_email = ${owner} and w.word = any(${words}::text[])
  `) as unknown as Array<{ word: string; strength: number | null; forgot: number; sentences: number }>;
  const examples = await Promise.all(words.map((w) => wordSentences(sql, owner, w, "readable", 0, 1)));

  const chars = (word: string) => [...word].map((ch) => ({ ch, gloss: [...word].length > 1 ? (dictEntry(ch)?.gloss ?? null) : null }));
  const out: SynonymWord[] = own.map((o, i) => {
    const r = records.find((x) => x.word === o.word);
    const ex = examples[i][0];
    return {
      word: o.word,
      pinyin: shownPinyin(o.pinyin, o.defs),
      status: o.status,
      senses: o.defs.filter((d) => !d.own).flatMap((d) => d.senses),
      shared: o.sense,
      hsk: hskOf(o.lists ?? []),
      chars: chars(o.word),
      before: top(o.word, true),
      after: top(o.word, false),
      example: ex ? { id: ex.id, zh: ex.zh, en: ex.en } : null,
      record: r ? { strength: r.strength, forgot: r.forgot, sentences: r.sentences } : null,
    };
  });
  if (withDictionary) {
    const mine = new Set(words);
    const extra = dictionaryFor(key)
      // Single characters are mostly bound forms there (历, 涉): words only.
      .filter((d) => !mine.has(d.word) && [...d.word].length > 1)
      .sort((a, b) => a.rank - b.rank || [...a.word].length - [...b.word].length)
      .filter((d, i, all) => all.findIndex((x) => x.word === d.word) === i)
      .slice(0, DICTIONARY);
    for (const d of extra) {
      out.push({
        word: d.word,
        pinyin: d.p,
        status: "dictionary",
        senses: d.senses,
        shared: d.senses[d.rank] ?? d.senses[0],
        hsk: null,
        chars: chars(d.word),
        before: [],
        after: [],
        example: null,
        record: null,
      });
    }
  }

  const { pairs } = await troubleOf(sql, owner, words);
  const confused = [...pairs].map(([k, n]) => ({ a: k.split("|")[0], b: k.split("|")[1], n })).sort((a, b) => b.n - a.n);
  return { key, words: out, confused, compare: await compareOf(sql, owner, key, words) };
}

// ------------------------------------------------------------------ the model's comparison --

const SYSTEM = `You explain to a learner of Chinese how words that share an English translation differ, so they can choose the right one. You are given the words (each with its pinyin, dictionary senses, the words most often next to it in the learner's own sentences, and the learner's record with it), the sentences the learner forgot with two of them confused, and some of the learner's readable sentences using each.

Give:
- summary: two or three plain sentences on the heart of the difference.
- dimensions: 2 to 5 rows of a comparison table, each a dimension where they differ (what it applies to, register, part of speech, grammar it takes, connotation, typical partner words), with what each word does on it in a few words. Use every word's exact Chinese as the keys of values.
- each: for every word, core (its essence in a short phrase), useWhen (one sentence), and one natural example sentence with its translation, showing that word's typical use.
- pitfalls: up to 3 common mistakes between them, especially the ones the learner's record shows.
- quiz: 3 to 6 "which one fits" questions. Each uses one of the learner's sentences by sentenceId, with the right word as answer; choices are the group's words (2 to 4 of them, including the answer) where only the answer fits. The app blanks the sentence itself. explain says in one sentence why the answer fits and the others don't.
Write in English, with Chinese only for Chinese words and sentences.`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, values: { type: "array", items: { type: "object", properties: { zh: { type: "string" }, text: { type: "string" } }, required: ["zh", "text"], additionalProperties: false } } },
        required: ["name", "values"],
        additionalProperties: false,
      },
    },
    each: {
      type: "array",
      items: {
        type: "object",
        properties: {
          zh: { type: "string" },
          core: { type: "string" },
          useWhen: { type: "string" },
          example: { type: "object", properties: { zh: { type: "string" }, en: { type: "string" } }, required: ["zh", "en"], additionalProperties: false },
        },
        required: ["zh", "core", "useWhen", "example"],
        additionalProperties: false,
      },
    },
    pitfalls: { type: "array", items: { type: "string" } },
    quiz: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentenceId: { type: "integer" },
          answer: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          explain: { type: "string" },
        },
        required: ["sentenceId", "answer", "choices", "explain"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "dimensions", "each", "pitfalls", "quiz"],
  additionalProperties: false,
} as const;

const clip = (v: unknown, n = 600) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, n) : "");

/**
 * The model's comparison, kept to what holds: table rows and words only for
 * the group's words, and quiz questions only on given sentences that hold
 * their answer, with options all from the group.
 */
export function checkCompare(
  raw: unknown,
  words: string[],
  sentences: Map<number, { zh: string; en: string | null }>,
): Omit<SynonymCompare, "at" | "model" | "words" | "stale"> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const summary = clip(r.summary);
  if (!summary) throw new SynonymError("The comparison came back without a summary.");
  const inGroup = (w: string) => words.includes(w);
  const dimensions = (Array.isArray(r.dimensions) ? r.dimensions : [])
    .map((d) => d as { name?: unknown; values?: unknown })
    .map((d) => ({
      name: clip(d.name, 60),
      values: Object.fromEntries(
        (Array.isArray(d.values) ? d.values : [])
          .map((v) => v as { zh?: unknown; text?: unknown })
          .map((v) => [clip(v.zh, 20), clip(v.text, 120)])
          .filter(([zh, text]) => inGroup(zh) && text),
      ),
    }))
    .filter((d) => d.name && Object.keys(d.values).length >= 2)
    .slice(0, 5);
  const each = (Array.isArray(r.each) ? r.each : [])
    .map((e) => e as Record<string, unknown>)
    .map((e) => {
      const ex = (e.example ?? {}) as Record<string, unknown>;
      return { zh: clip(e.zh, 20), core: clip(e.core, 120), useWhen: clip(e.useWhen, 300), example: { zh: clip(ex.zh, 200), en: clip(ex.en, 300) } };
    })
    .filter((e) => inGroup(e.zh) && e.core && e.example.zh.includes(e.zh));
  const pitfalls = (Array.isArray(r.pitfalls) ? r.pitfalls : []).map((p) => clip(p, 300)).filter(Boolean).slice(0, 3);
  const quiz: SynonymCompare["quiz"] = [];
  for (const item of Array.isArray(r.quiz) ? r.quiz : []) {
    const q = item as Record<string, unknown>;
    const answer = clip(q.answer, 20);
    const s = typeof q.sentenceId === "number" ? sentences.get(q.sentenceId) : undefined;
    const choices = [...new Set((Array.isArray(q.choices) ? q.choices : []).map((c) => clip(c, 20)))].filter(inGroup).slice(0, 4);
    if (!s || !inGroup(answer) || !s.zh.includes(answer) || choices.length < 2 || !choices.includes(answer)) continue;
    const at = s.zh.indexOf(answer);
    quiz.push({
      prompt: `${s.zh.slice(0, at)}${"＿".repeat(Math.max(2, [...answer].length))}${s.zh.slice(at + answer.length)}`,
      choices,
      answer,
      explain: clip(q.explain, 300),
      sentence: { id: q.sentenceId as number, en: s.en },
    });
  }
  return { summary, dimensions, each, pitfalls, quiz: quiz.slice(0, 6) };
}

async function compareOf(sql: Sql, owner: string, key: string, words: string[]): Promise<SynonymCompare | null> {
  await ensureTables(sql);
  const [row] = (await sql`
    select (extract(epoch from at) * 1000)::double precision as at, model, words, compare
    from chongfuxi_synonym_compare where owner_email = ${owner} and key = ${key}
  `) as unknown as Array<{ at: number; model: string; words: string[]; compare: Omit<SynonymCompare, "at" | "model" | "words" | "stale"> }>;
  if (!row) return null;
  const same = row.words.length === words.length && row.words.every((w) => words.includes(w));
  return { at: Math.round(row.at), model: row.model, words: row.words, stale: !same, ...row.compare };
}

/** Ask the model to compare the group's words (the owner's, not the dictionary's), and keep it. Owner only. */
export async function compareGroup(sql: Sql, owner: string, key: string): Promise<SynonymCompare> {
  const group = await synonymGroup(sql, owner, key, false);
  if (!group || group.words.length < 2) throw new SynonymError(`No group of your words shares "${key}".`);
  const apiKey = process.env.CHONGFUXI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new SynonymError("No Anthropic API key is set (CHONGFUXI_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY).");
  const words = group.words.map((w) => w.word);

  // Up to four readable sentences each, for the quiz.
  const sentences = new Map<number, { zh: string; en: string | null }>();
  const per = await Promise.all(words.map((w) => wordSentences(sql, owner, w, "readable", 0, 4)));
  per.flat().forEach((s) => sentences.set(s.id, { zh: s.zh, en: s.en }));
  const forgotten = (await sql`
    select s.zh, s.en, r.tapped from chongfuxi_review r join chongfuxi_sentence s on s.owner_email = r.owner_email and s.id = r.sentence_id
    where r.owner_email = ${owner} and r.kind = 'sentence' and r.grade = 'forgot' and r.cause = 'answer'
      and cardinality(array(select unnest(r.tapped) intersect select unnest(${words}::text[]))) >= 2
    order by r.seq desc limit 8
  `) as unknown as Array<{ zh: string; en: string | null; tapped: string[] }>;

  const lines = [
    `The English they share: "${key}".`,
    "",
    ...group.words.flatMap((w) => [
      `${w.word}${w.pinyin ? ` (${w.pinyin.replace(/@/g, " ")})` : ""}: ${w.senses.slice(0, 6).join("; ")}`,
      ...(w.before.length || w.after.length
        ? [`  next to it in the learner's sentences: ${[...w.before.map((b) => `${b.word}＿`), ...w.after.map((a) => `＿${a.word}`)].join(", ")}`]
        : []),
      ...(w.record ? [`  the learner: forgotten ${w.record.forgot} times; in ${w.record.sentences} of their sentences`] : []),
    ]),
    ...(forgotten.length
      ? ["", "Sentences the learner forgot, tapping two or more of these words:", ...forgotten.map((f) => `- ${zhShown(f.zh)}${f.en ? ` — ${f.en}` : ""} (tapped ${f.tapped.join(", ")})`)]
      : []),
    "",
    sentences.size ? "The learner's readable sentences (id: sentence — translation), for the quiz:" : "The learner has no readable sentences with these words: make no quiz.",
    ...[...sentences].map(([id, s]) => `${id}: ${s.zh}${s.en ? ` — ${s.en}` : ""}`),
  ];

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 10000,
    system: SYSTEM,
    output_config: { effort: EFFORT, format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user", content: lines.join("\n") }],
  });
  const text = message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  let given: unknown;
  try {
    given = JSON.parse(text);
  } catch {
    throw new SynonymError(message.stop_reason === "refusal" ? "The model declined." : "The comparison came back malformed.");
  }
  const compare = checkCompare(given, words, sentences);
  await sql`
    insert into chongfuxi_synonym_compare (owner_email, key, at, model, words, compare)
    values (${owner}, ${key}, now(), ${MODEL}, ${words}::text[], ${JSON.stringify(compare)}::jsonb)
    on conflict (owner_email, key) do update set at = now(), model = excluded.model, words = excluded.words, compare = excluded.compare
  `;
  console.log("synonyms compare", JSON.stringify({ key, words: words.length, usage: message.usage }));
  return (await compareOf(sql, owner, key, words))!;
}

/** Group-mates shown beside a word on its card back, at most. */
const CONTRAST_MATES = 2;

/**
 * For card backs: each word's latest comparison, as its core and those of up
 * to two group-mates (those it was mixed up with first), so the difference is
 * there when the card is. Words never compared have none.
 */
export async function contrastsFor(sql: Sql, owner: string, words: string[]): Promise<Map<string, { key: string; items: Array<{ zh: string; core: string }> }>> {
  const out = new Map<string, { key: string; items: Array<{ zh: string; core: string }> }>();
  if (!words.length) return out;
  await ensureTables(sql);
  const rows = (await sql`
    select key, words, compare->'each' as each from chongfuxi_synonym_compare
    where owner_email = ${owner} and words && ${words}::text[]
    order by at desc
  `) as unknown as Array<{ key: string; words: string[]; each: Array<{ zh: string; core: string }> | null }>;
  const { pairs } = await troubleOf(sql, owner, [...new Set(rows.flatMap((r) => r.words))]);
  for (const w of words) {
    const row = rows.find((r) => r.words.includes(w) && r.each?.some((e) => e.zh === w));
    if (!row) continue;
    const mixed = (o: string) => pairs.get([w, o].sort().join("|")) ?? 0;
    const own = row.each!.find((e) => e.zh === w)!;
    const mates = row.each!.filter((e) => e.zh !== w && e.core).sort((a, b) => mixed(b.zh) - mixed(a.zh)).slice(0, CONTRAST_MATES);
    if (mates.length) out.set(w, { key: row.key, items: [own, ...mates].map((e) => ({ zh: e.zh, core: e.core })) });
  }
  return out;
}
