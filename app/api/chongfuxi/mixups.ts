// The mix-up map (the owner: "a visualized map of words I often confuse
// together"): words joined where the owner took one for the other. Built from
// what is already kept, no model: the notes written after a Forgot ("thought
// it was 发现": the card's word and each word the note names, or the partner
// Muse gave in answering it), and lookups comparing just two words ("发现 vs
// 发觉"). Words joined directly or through others make one cluster.

import type { MixupEdge, MixupMap, MixupNode } from "@chongfuxi/lib/api";
import { inOneWord } from "@chongfuxi/lib/revive";
import type { Sql } from "./db";
import { dictEntry, loadHeadwords } from "./headwords";
import { ensureLookupTables, lookupWords } from "./lookup";
import { allNotes } from "./notes";
import { NEAR_TOP, ensureKeys } from "./synonyms";
import { promptSenses, shownPinyin } from "./review";
import type { Definition } from "@chongfuxi/lib/dict";

/** What a note counts for, against a lookup: a note is a real mix-up, a lookup only a question. */
export const MIXUP_WEIGHT = { note: 2, lookup: 1 } as const;
/** Evidence kept on a pair, at most, newest first. */
const PAIR_EVIDENCE = 6;
/** Clusters sent, at most, the strongest first. */
const MAX_CLUSTERS = 60;
/**
 * Words sharing an English key with a mixed-up word (Synonyms' keys, near the
 * top of both entries), drawn faint beside it: at most this many a word, and
 * only from keys shared by this many words or fewer (wider ones say little).
 */
const SYNONYMS_PER_WORD = 3;
const SYNONYM_KEY_MAX = 12;

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export async function mixupMap(sql: Sql, owner: string): Promise<MixupMap> {
  const pairs = new Map<string, MixupEdge>();
  const join = (a: string, b: string, add: (e: MixupEdge) => void) => {
    if (!a || !b || a === b || a.includes(b) || b.includes(a)) return;
    const k = key(a, b);
    const e = pairs.get(k) ?? { a: a < b ? a : b, b: a < b ? b : a, weight: 0, notes: [], lookups: [] };
    add(e);
    pairs.set(k, e);
  };

  // Notes: a word card's word with each word named or given as partner; a sentence card's named words with each other.
  const notes = await allNotes(sql, owner);
  for (const n of notes) {
    const partners = n.answers.map((a) => a.partner).filter((p): p is string => !!p);
    const others = [...new Set([...n.named, ...partners])];
    const evidence = (e: MixupEdge) => {
      e.weight += MIXUP_WEIGHT.note;
      if (e.notes.length < PAIR_EVIDENCE) {
        e.notes.push({ id: n.id, at: n.at, kind: n.kind, word: n.word, note: n.note, sentence: n.sentence?.zh ?? null, difference: n.answers.find((a) => a.difference)?.difference ?? null });
      }
    };
    if (n.word) for (const o of others) join(n.word, o, evidence);
    else for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) join(others[i], others[j], evidence);
  }

  // Lookups naming just two words, not both inside one word asked about (不 and 着 in 不着痕迹).
  await ensureLookupTables(sql);
  const asked = (await sql`
    select query, (extract(epoch from at) * 1000)::double precision as at from chongfuxi_lookup
    where owner_email = ${owner} order by at desc limit 1000
  `) as unknown as Array<{ query: string; at: number }>;
  const named = await lookupWords(sql, owner, asked.map((a) => a.query));
  const heads = loadHeadwords();
  for (const a of asked) {
    const words = named.get(a.query) ?? [];
    if (words.length !== 2 || inOneWord(a.query, words[0], words[1], (w) => heads.has(w))) continue;
    join(words[0], words[1], (e) => {
      e.weight += MIXUP_WEIGHT.lookup;
      if (e.lookups.length < PAIR_EVIDENCE) e.lookups.push({ query: a.query, at: Math.round(a.at) });
    });
  }

  const edges = [...pairs.values()];
  const words = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
  if (!words.length) return { clusters: [], pairs: 0, notes: notes.length };

  // Words sharing an English key with each (the owner's ask: other synonyms, "super greyed out").
  const synonyms = await synonymsOf(sql, owner, words);
  const extra = [...new Set([...synonyms.values()].flat().map((x) => x.word))].filter((w) => !words.includes(w));

  // Each word as the app shows it, with its misses in the last 90 days.
  const rows = (await sql`
    select w.word, w.status, w.pinyin, w.defs,
           (select count(*)::int from chongfuxi_review r
            where r.owner_email = w.owner_email and r.word = w.word and r.grade = 'forgot'
              and r.cause in ('answer', 'tapped') and r.at > now() - interval '90 days') as misses
    from chongfuxi_word w where w.owner_email = ${owner} and w.word = any(${[...words, ...extra]}::text[])
  `) as unknown as Array<{ word: string; status: string; pinyin: string | null; defs: Definition[] | null; misses: number }>;
  const byWord = new Map(rows.map((r) => [r.word, r]));
  const nodeOf = (word: string): MixupNode => {
    const r = byWord.get(word);
    const d = r ? null : dictEntry(word);
    return {
      word,
      pinyin: r ? shownPinyin(r.pinyin, r.defs) : (d?.p ?? null),
      gloss: r ? promptSenses(r.defs ?? [], r.pinyin).slice(0, 2).join("; ") || null : (d?.gloss ?? null),
      standing: r?.status === "deck" ? "deck" : r?.status === "listed" ? "listed" : "dictionary",
      misses: r?.misses ?? 0,
    };
  };

  // Clusters: words joined directly or through others.
  const parent = new Map(words.map((w) => [w, w]));
  const find = (w: string): string => {
    let p = parent.get(w)!;
    while (p !== parent.get(p)) p = parent.get(p)!;
    parent.set(w, p);
    return p;
  };
  for (const e of edges) parent.set(find(e.a), find(e.b));
  const groups = new Map<string, { words: string[]; edges: MixupEdge[] }>();
  const faint = new Set<string>();
  for (const w of words) (groups.get(find(w)) ?? groups.set(find(w), { words: [], edges: [] }).get(find(w))!).words.push(w);
  for (const e of edges) groups.get(find(e.a))!.edges.push(e);
  const last = (e: MixupEdge) => Math.max(0, ...e.notes.map((n) => n.at), ...e.lookups.map((l) => l.at));
  // Each cluster's synonyms: a word not mixed up with anything joins the cluster of the first word it is a synonym of;
  // one already in this cluster gets a faint line; one mixed up elsewhere stays there (clusters are never joined by them).
  const placed = new Set(words);
  for (const g of groups.values()) {
    const had = new Set(g.words);
    const lines: MixupEdge[] = [];
    for (const w of [...g.words]) {
      for (const syn of synonyms.get(w) ?? []) {
        if (had.has(syn.word)) {
          if (!g.edges.some((e) => (e.a === w && e.b === syn.word) || (e.b === w && e.a === syn.word)) && !lines.some((e) => key(e.a, e.b) === key(w, syn.word)))
            lines.push({ a: w, b: syn.word, key: syn.key, weight: 0, notes: [], lookups: [] });
        } else if (!placed.has(syn.word)) {
          placed.add(syn.word);
          had.add(syn.word);
          g.words.push(syn.word);
          faint.add(syn.word);
          lines.push({ a: w, b: syn.word, key: syn.key, weight: 0, notes: [], lookups: [] });
        }
      }
    }
    g.edges.push(...lines);
  }
  const clusters = [...groups.values()]
    .map((g) => ({
      nodes: g.words.map((w) => (faint.has(w) ? { ...nodeOf(w), synonym: true } : nodeOf(w))),
      edges: g.edges.sort((x, y) => y.weight - x.weight),
      weight: g.edges.reduce((n, e) => n + e.weight, 0),
      last: Math.max(...g.edges.map(last)),
    }))
    .sort((x, y) => y.weight - x.weight || y.last - x.last)
    .slice(0, MAX_CLUSTERS);
  return { clusters, pairs: edges.length, notes: notes.length };
}

/**
 * For each word, up to SYNONYMS_PER_WORD others sharing an English key with
 * it near the top of both entries (Synonyms' `chongfuxi_gloss_key`), in the
 * deck first, with the key; keys shared by more than SYNONYM_KEY_MAX words
 * are left out.
 */
async function synonymsOf(sql: Sql, owner: string, words: string[]): Promise<Map<string, Array<{ word: string; key: string }>>> {
  const out = new Map<string, Array<{ word: string; key: string }>>();
  if (!words.length) return out;
  await ensureKeys(sql, owner);
  const rows = (await sql`
    with mine as (
      select word, key, rank from chongfuxi_gloss_key where owner_email = ${owner} and word = any(${words}::text[]) and rank <= ${NEAR_TOP}
    ), small as (
      select key from chongfuxi_gloss_key where owner_email = ${owner} and key in (select key from mine)
      group by key having count(*) <= ${SYNONYM_KEY_MAX}
    )
    select m.word, o.word as other, m.key
    from mine m
    join small using (key)
    join chongfuxi_gloss_key o on o.owner_email = ${owner} and o.key = m.key and o.word <> m.word and o.rank <= ${NEAR_TOP}
    join chongfuxi_word w on w.owner_email = ${owner} and w.word = o.word
    order by m.word, (w.status = 'deck') desc, m.rank + o.rank, char_length(o.word), o.word
  `) as unknown as Array<{ word: string; other: string; key: string }>;
  for (const r of rows) {
    if (r.other.includes(r.word) || r.word.includes(r.other)) continue;
    const list = out.get(r.word) ?? out.set(r.word, []).get(r.word)!;
    if (list.length < SYNONYMS_PER_WORD && !list.some((x) => x.word === r.other)) list.push({ word: r.other, key: r.key });
  }
  return out;
}
