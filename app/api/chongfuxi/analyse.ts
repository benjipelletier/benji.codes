// A text against the corpus: how much of it the owner can read, word by word
// and sentence by sentence, and which words would open up the most of it.
//
// The text is cut into sentences as the Texts import cuts them
// (lib/texts.ts) and split into words by the same dictionary matching, so a
// word counts as known exactly as it does for unlocking a deck's sentences:
// known, or made of known words (孩子们), with the blame for an unreadable word
// on the part to learn (lib/unlock.ts). A known word whose Read card is new
// here, or under three weeks strong, counts as still being learnt.
//
// Only the text is kept (chongfuxi_text); the analysis is worked out again
// each time, against what is known then, so a text gets easier as words are
// learnt.

import type { Sql } from "./db";
import { hskOf, wordLooks } from "./review";
import type { TextAnalysis, TextListed, TextToken, TextUnknown, WordStanding } from "@chongfuxi/lib/api";
import type { Dict } from "@chongfuxi/lib/dict";
import { isHan } from "@chongfuxi/lib/hanzi";
import { mainSenses } from "@chongfuxi/lib/senses";
import { segmentByDictionary } from "@chongfuxi/lib/segment";
import { splitSentences } from "@chongfuxi/lib/texts";
import { makeUnlock } from "@chongfuxi/lib/unlock";
import type { Definition } from "@chongfuxi/lib/dict";

/** Longest text analysed, in characters: a long article, or a film's captions. */
export const TEXT_MAX = 200_000;
/** Words matched as one at most, as the Texts import does. */
const SPLIT_MAX = 4;
/** A Read card this strong (days) or more is known with ease; below, still being learnt. */
const SETTLED_DAYS = 21;
/** Unknown words listed, most useful first. */
const UNKNOWN_MAX = 300;
/** A sentence a word alone holds back counts as this many times it stands in the way. */
const UNLOCK_WEIGHT = 4;

const HSK_LEVELS = ["1", "2", "3", "4", "5", "6", "7-9"];

interface Row {
  word: string;
  status: "deck" | "listed" | "name";
}

/** Analyse a text: nothing is written. */
export async function analyse(
  sql: Sql,
  owner: string,
  dict: Dict,
  input: { text: string; kind: TextAnalysis["kind"]; title: string | null; url: string | null; id?: number | null; at?: number; savedAs?: string | null },
): Promise<TextAnalysis> {
  const rows = (await sql`select word, status from chongfuxi_word where owner_email = ${owner}`) as unknown as Row[];
  const universe = new Set(rows.map((r) => r.word));
  const status = new Map(rows.map((r) => [r.word, r.status]));
  const unlock = makeUnlock(new Set(rows.filter((r) => r.status !== "listed").map((r) => r.word)), universe);
  const vocab = dict.headwords(SPLIT_MAX);
  for (const w of universe) if ([...w].length <= SPLIT_MAX) vocab.add(w);
  const context = { charReadings: dict.readings as Map<string, Set<string>>, vocab, maxLen: SPLIT_MAX };

  // Paragraphs of sentences of words, in order.
  const paragraphs = input.text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => splitSentences(line).map((zh) => ({ zh, words: segmentByDictionary(zh, context).words })));
  const all = paragraphs.flat();
  const textWords = [...new Set(all.flatMap((s) => s.words))];

  // Deck words still being learnt: a Read card new here, or not yet three weeks strong.
  const deckHere = textWords.filter((w) => status.get(w) === "deck");
  const cards = deckHere.length
    ? ((await sql`
        select word, state::int as state, stability from chongfuxi_card
        where owner_email = ${owner} and kind = 'read' and meaning_id is null and word = any(${deckHere}::text[])
      `) as unknown as Array<{ word: string; state: number; stability: number }>)
    : [];
  const settling = new Set(cards.filter((c) => c.state === 0 || c.stability < SETTLED_DAYS).map((c) => c.word));

  const standing = new Map<string, WordStanding>();
  const blamed = new Map<string, string[]>();
  for (const w of textWords) {
    const blockers = unlock.blockersOf([w]);
    blamed.set(w, blockers);
    standing.set(w, blockers.length ? "unknown" : settling.has(w) ? "learning" : "known");
  }

  // The text as tokens: each word where it stands in the sentence, what lies between kept as it is.
  const tokensOf = (zh: string, words: string[]): TextToken[] => {
    const out: TextToken[] = [];
    let at = 0;
    for (const w of words) {
      const i = zh.indexOf(w, at);
      if (i < 0) continue;
      if (i > at) out.push({ t: zh.slice(at, i) });
      out.push({ t: w, k: standing.get(w) });
      at = i + w.length;
    }
    if (at < zh.length) out.push({ t: zh.slice(at) });
    return out;
  };

  // Sentences: readable, one word away; and what stands in the way, how often, and what it would unlock.
  let readable = 0;
  let oneAway = 0;
  const count = new Map<string, number>();
  const unlocks = new Map<string, number>();
  for (const s of all) {
    if (!s.words.length) continue;
    const blockers = unlock.blockersOf(s.words);
    if (!blockers.length) readable++;
    if (blockers.length === 1) {
      oneAway++;
      unlocks.set(blockers[0], (unlocks.get(blockers[0]) ?? 0) + 1);
    }
    for (const w of s.words) for (const b of blamed.get(w) ?? []) count.set(b, (count.get(b) ?? 0) + 1);
  }
  const counted = all.filter((s) => s.words.length).length;

  const tokens = all.flatMap((s) => s.words);
  const knownTokens = tokens.filter((w) => standing.get(w) !== "unknown").length;
  const uniqueKnown = textWords.filter((w) => standing.get(w) !== "unknown").length;
  const learning = textWords.filter((w) => standing.get(w) === "learning").length;

  // The words to learn, most useful first, with what the deck has on them.
  // Worth: each time it stands in the way, and more for each sentence it alone holds back.
  const worth = (w: string) => count.get(w)! + UNLOCK_WEIGHT * (unlocks.get(w) ?? 0);
  const wanted = [...count.keys()].sort((a, b) => worth(b) - worth(a) || a.localeCompare(b)).slice(0, UNKNOWN_MAX);
  const details = [...new Set([...wanted, ...textWords])];
  const info = details.length
    ? new Map(
        ((await sql`
          select word, pinyin, defs, lists from chongfuxi_word
          where owner_email = ${owner} and word = any(${details}::text[])
        `) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[]; lists: string[] | null }>).map((r) => [r.word, r]),
      )
    : new Map<string, { word: string; pinyin: string | null; defs: Definition[]; lists: string[] | null }>();
  const lookOf = await wordLooks(sql, owner, textWords);
  const unknown: TextUnknown[] = wanted.map((w) => {
    const row = info.get(w);
    const look = lookOf(w);
    return {
      word: w,
      pinyin: look?.p ?? row?.pinyin ?? null,
      gloss: row?.defs?.length ? mainSenses(row.defs, row.pinyin, { n: 2 }).join("; ") || look?.gloss || null : (look?.gloss ?? null),
      hsk: hskOf(row?.lists ?? []),
      count: count.get(w)!,
      unlocks: unlocks.get(w) ?? 0,
      listed: status.get(w) === "listed",
      addable: universe.has(w) || dict.has(w),
    };
  });

  // HSK 3.0 levels of the distinct words, and how many of each are known.
  const levels = new Map<string, { words: number; known: number }>();
  for (const w of textWords) {
    const v3 = hskOf(info.get(w)?.lists ?? []).v3;
    const level = v3 ? (v3.startsWith("7") ? "7-9" : v3) : "none";
    const slot = levels.get(level) ?? { words: 0, known: 0 };
    slot.words++;
    if (standing.get(w) !== "unknown") slot.known++;
    levels.set(level, slot);
  }

  return {
    id: input.id ?? null,
    kind: input.kind,
    title: input.title,
    url: input.url,
    at: input.at ?? Date.now(),
    savedAs: input.savedAs ?? null,
    words: { total: tokens.length, known: knownTokens, unique: textWords.length, uniqueKnown, learning },
    sentences: { total: counted, readable, oneAway },
    paragraphs: paragraphs.map((p) => p.map((s) => tokensOf(s.zh, s.words))),
    unknown,
    hsk: [...HSK_LEVELS, "none"].filter((l) => levels.has(l)).map((level) => ({ level, ...levels.get(level)! })),
    looks: Object.fromEntries(textWords.map((w) => [w, lookOf(w)])),
  };
}

/** A title for a pasted text: its first line, when short, else its opening characters. */
export function titleOf(text: string): string {
  const first = text.trim().split("\n")[0].trim();
  const han = [...first].filter(isHan).length;
  return han <= 30 ? first.slice(0, 60) : `${[...first].slice(0, 16).join("")}…`;
}

export async function saveText(
  sql: Sql,
  owner: string,
  t: { kind: TextAnalysis["kind"]; title: string | null; url: string | null; text: string },
): Promise<{ id: number; at: number }> {
  const rows = (await sql`
    insert into chongfuxi_text (owner_email, kind, title, url, text)
    values (${owner}, ${t.kind}, ${t.title}, ${t.url}, ${t.text})
    returning id::int as id, (extract(epoch from at) * 1000)::double precision as at
  `) as unknown as Array<{ id: number; at: number }>;
  return rows[0];
}

export async function getText(
  sql: Sql,
  owner: string,
  id: number,
): Promise<{ id: number; kind: TextAnalysis["kind"]; title: string | null; url: string | null; text: string; at: number; savedAs: string | null } | null> {
  const rows = (await sql`
    select id::int as id, kind, title, url, text, saved_as as "savedAs", (extract(epoch from at) * 1000)::double precision as at
    from chongfuxi_text where owner_email = ${owner} and id = ${id}
  `) as unknown as Array<{ id: number; kind: TextAnalysis["kind"]; title: string | null; url: string | null; text: string; at: number; savedAs: string | null }>;
  return rows[0] ?? null;
}

export async function listTexts(sql: Sql, owner: string): Promise<TextListed[]> {
  return (await sql`
    select id::int as id, kind, title, url, (extract(epoch from at) * 1000)::double precision as at,
           char_length(text)::int as chars, saved_as as "savedAs"
    from chongfuxi_text where owner_email = ${owner}
    order by at desc limit 100
  `) as unknown as TextListed[];
}
