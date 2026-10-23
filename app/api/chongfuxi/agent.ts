// Word lists written by the owner's agent (Muse), through a token only it
// holds (route agent/lists). Lists nest as Pleco's do, a path with "/"
// between levels, and every one lives under the top-level MUSE_LIST, so the
// agent can never touch the owner's Pleco, textbook or Spotify lists. Writing
// a list files its words under its path (chongfuxi_word.lists), as a Spotify
// song's are: a word not in the corpus comes in as a list word with
// CC-CEDICT's definitions, a deck word just gets the list. Nothing joins the
// deck and nothing is unlocked; a list's page adds, learns and reviews them
// like any list.

import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { definitionsFor, type Definition, type Dict } from "@chongfuxi/lib/dict";
import { mainEntry } from "@chongfuxi/lib/senses";
import type { Sql } from "./db";

export class AgentError extends Error {}

/** The top-level list every agent list lives under. */
export const MUSE_LIST = "Muse";
/** Levels below MUSE_LIST a path may have, and characters a level's name may run to. */
const MAX_DEPTH = 6;
const MAX_NAME = 60;
/** Lists in one request, and words in one list. */
export const MAX_LISTS = 50;
export const MAX_WORDS = 500;
/** Characters a word may run to. */
const MAX_WORD = 12;
const HAN = /^[㐀-鿿豈-﫿]+$/;

/**
 * Whether the request carries the agent's token (`Authorization: Bearer
 * <token>`), compared in constant time. Without CHONGFUXI_AGENT_TOKEN set
 * nothing is accepted.
 */
export function agentAllowed(req: NextRequest): boolean {
  const want = process.env.CHONGFUXI_AGENT_TOKEN;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!want || want.length < 32 || !got || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/**
 * A path as the agent gives it ("Travel/Airport", ["Travel", "Airport"], or
 * already under Muse), as kept: "Muse/Travel/Airport". Each level trimmed,
 * any "/" inside a name made "／", empty levels dropped.
 */
export function listPath(given: unknown): string {
  const parts = (Array.isArray(given) ? given : typeof given === "string" ? given.split("/") : [])
    .map((p) => (typeof p === "string" ? p.replace(/\//g, "／").replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean);
  if (parts[0] === MUSE_LIST) parts.shift();
  if (!parts.length) throw new AgentError("A list needs a name under Muse (\"Travel/Airport\").");
  if (parts.length > MAX_DEPTH) throw new AgentError(`A list can be at most ${MAX_DEPTH} levels deep.`);
  const long = parts.find((p) => p.length > MAX_NAME);
  if (long) throw new AgentError(`"${long.slice(0, 20)}…" is longer than ${MAX_NAME} characters.`);
  return [MUSE_LIST, ...parts].join("/");
}

export interface WrittenList {
  list: string;
  /** Words now filed under it. */
  words: number;
  /** Of them, new to the corpus (came in as list words). */
  fresh: number;
  /** Taken off it (replace). */
  removed: number;
  /** Given but not taken: not Chinese, too long, or a word neither the corpus nor the dictionary knows. */
  skipped: string[];
}

/**
 * File words under a list (made by being filed under). With `replace`, words
 * on it before but not given now are taken off it, and so are its lists
 * below (a list written whole); otherwise words are only added.
 */
export async function writeList(
  sql: Sql,
  owner: string,
  dict: Dict,
  input: { path: unknown; words: unknown; replace?: boolean },
): Promise<WrittenList> {
  const list = listPath(input.path);
  const given = Array.isArray(input.words) ? input.words : [];
  if (given.length > MAX_WORDS) throw new AgentError(`At most ${MAX_WORDS} words in a list.`);
  const corpus = new Set(
    ((await sql`select word from chongfuxi_word where owner_email = ${owner}`) as unknown as Array<{ word: string }>).map((r) => r.word),
  );
  const words: string[] = [];
  const skipped: string[] = [];
  for (const g of given) {
    const w = typeof g === "string" ? g.trim() : "";
    if (!w || w.length > MAX_WORD || !HAN.test(w) || (!corpus.has(w) && !dict.has(w))) {
      skipped.push(String(g).slice(0, 20));
      continue;
    }
    if (!words.includes(w)) words.push(w);
  }

  const fresh = words.filter((w) => !corpus.has(w));
  const rows = fresh.map((w) => {
    const defs = definitionsFor(dict, w, null, null) as Definition[];
    return { w, p: mainEntry(defs, null)?.p ?? null, d: defs };
  });
  const below = `${list}/%`;
  const [{ n: removed }] = input.replace
    ? ((await sql`
        select count(*)::int as n from chongfuxi_word
        where owner_email = ${owner} and not (word = any(${words}::text[]))
          and exists (select 1 from unnest(lists) l where l = ${list} or l like ${below})
      `) as unknown as Array<{ n: number }>)
    : [{ n: 0 }];
  await sql.transaction([
    // Written whole: off it (and its lists below) whatever isn't given now.
    ...(input.replace
      ? [
          sql`
            update chongfuxi_word set lists = array(select l from unnest(lists) l where l <> ${list} and l not like ${below})
            where owner_email = ${owner} and not (word = any(${words}::text[]))
              and exists (select 1 from unnest(lists) l where l = ${list} or l like ${below})
          `,
        ]
      : []),
    sql`
      insert into chongfuxi_word (owner_email, word, status, pinyin, defs, lists)
      select ${owner}, e.value->>'w', 'listed', e.value->>'p', coalesce(e.value->'d', '[]'::jsonb), array[${list}]::text[]
      from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) e
      on conflict (owner_email, word) do nothing
    `,
    sql`
      update chongfuxi_word set lists = lists || array[${list}]::text[]
      where owner_email = ${owner} and word = any(${words}::text[]) and not (${list} = any(lists))
    `,
  ]);
  return { list, words: words.length, fresh: fresh.length, removed, skipped };
}

/** Take a list off every word, and its lists below. Its words stay in the corpus (and the deck, if there). */
export async function removeList(sql: Sql, owner: string, path: unknown): Promise<{ list: string; words: number }> {
  const list = listPath(path);
  const below = `${list}/%`;
  const rows = (await sql`
    update chongfuxi_word set lists = array(select l from unnest(lists) l where l <> ${list} and l not like ${below})
    where owner_email = ${owner} and exists (select 1 from unnest(lists) l where l = ${list} or l like ${below})
    returning word
  `) as unknown as unknown[];
  return { list, words: rows.length };
}

/** The agent's lists, each with its words (in the deck or not), for it to read back what it wrote. */
export async function agentLists(sql: Sql, owner: string): Promise<Array<{ list: string; words: Array<{ word: string; inDeck: boolean }> }>> {
  const rows = (await sql`
    select l as list, w.word, w.status = 'deck' as in_deck
    from chongfuxi_word w, unnest(w.lists) l
    where w.owner_email = ${owner} and (l = ${MUSE_LIST} or l like ${`${MUSE_LIST}/%`})
    order by l, w.word
  `) as unknown as Array<{ list: string; word: string; in_deck: boolean }>;
  const out = new Map<string, Array<{ word: string; inDeck: boolean }>>();
  for (const r of rows) (out.get(r.list) ?? out.set(r.list, []).get(r.list)!).push({ word: r.word, inDeck: r.in_deck });
  return [...out.entries()].map(([list, words]) => ({ list, words }));
}
