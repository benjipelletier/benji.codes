// Songs as word lists. The owner pastes a Spotify track link; the song's
// title and artist come from its Spotify page, its lyrics from LRCLIB (an
// open lyrics database; Spotify gives no lyrics to others), turned simplified
// where they are written traditional, and split into words by the same
// dictionary matching as a text (analyse.ts). The words are filed under the
// list "Spotify/<title>", as a Pleco list's are filed under theirs, so the
// Lists screen browses, adds, learns and reviews them like any list.
//
// Only the words are kept, with the song's title, artist and link
// (chongfuxi_song): lists are readable by anyone, and lyrics aren't ours to
// publish.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { definitionsFor, type Definition, type Dict } from "@chongfuxi/lib/dict";
import { segmentByDictionary } from "@chongfuxi/lib/segment";
import { mainEntry } from "@chongfuxi/lib/senses";
import type { Sql } from "./db";

/** The top-level list songs go under; Pleco's 歌词 lists are moved there (`moveSongLists`). */
export const SPOTIFY_LIST = "Spotify";
/** Lists Pleco brought that are songs, and where they go now. */
const PLECO_SONGS = "歌词";
/** Words one song may file, at most. */
const SONG_WORDS_MAX = 600;
/** Words matched as one at most, as a text's are. */
const SPLIT_MAX = 4;
const UA = "chongfuxi (https://benji.codes/chongfuxi)";

export class SongError extends Error {}

let ready = false;
/** The table, made on first use so a deploy needs no migration first. Same as sql/001_init.sql. */
async function ensure(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_song (
      owner_email text not null,
      list text not null,
      track_id text,
      url text,
      title text not null,
      artist text,
      lyrics_from text not null,
      words integer not null,
      added timestamptz not null default now(),
      primary key (owner_email, list)
    )
  `;
  ready = true;
}

let moved = false;
/**
 * Pleco's 歌词 lists are songs: they go under Spotify, with the songs added
 * since. Once per server start (an import moves them too, `songListOf`), so
 * nothing is written once it is done.
 */
export async function moveSongLists(sql: Sql, owner: string): Promise<void> {
  if (moved) return;
  await sql`
    update chongfuxi_word
    set lists = array(
      select case when l = ${PLECO_SONGS} or l like ${`${PLECO_SONGS}/%`} then ${SPOTIFY_LIST} || substr(l, ${PLECO_SONGS.length + 1}) else l end
      from unnest(lists) l
    )
    where owner_email = ${owner}
      and exists (select 1 from unnest(lists) l where l = ${PLECO_SONGS} or l like ${`${PLECO_SONGS}/%`})
  `;
  moved = true;
}

/** A Pleco list path as it is filed now: 歌词/一千年以后 → Spotify/一千年以后. */
export function songListOf(path: string): string {
  return path === PLECO_SONGS || path.startsWith(`${PLECO_SONGS}/`) ? SPOTIFY_LIST + path.slice(PLECO_SONGS.length) : path;
}

/** The song lists, with what is known of each: for the Lists screen. */
export async function songsOf(sql: Sql, owner: string): Promise<Map<string, { title: string; artist: string | null; url: string | null }>> {
  await ensure(sql);
  const rows = (await sql`
    select list, title, artist, url from chongfuxi_song where owner_email = ${owner}
  `) as unknown as Array<{ list: string; title: string; artist: string | null; url: string | null }>;
  return new Map(rows.map((r) => [r.list, { title: r.title, artist: r.artist, url: r.url }]));
}

/** The track id in a Spotify link: open.spotify.com/(intl-xx/)track/<id>, or spotify:track:<id>. */
export function trackId(link: string): string | null {
  return link.match(/(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/)?.[1] ?? null;
}

const entities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/**
 * A track's title and artist, from its public page: the page title reads
 * "<title> - song and lyrics by <artist> | Spotify"; failing that, og:title,
 * and og:description's first part ("<artist> · <album> · Song · <year>").
 */
export function readTrackPage(html: string): { title: string; artist: string | null } | null {
  const page = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const byline = page && entities(page).match(/^(.*?) - (?:song|single)(?: and lyrics)? by (.*?) \| Spotify$/i);
  if (byline) return { title: byline[1].trim(), artist: byline[2].trim() || null };
  const meta = (p: string) => html.match(new RegExp(`<meta[^>]+property="${p}"[^>]+content="([^"]*)"`))?.[1];
  const title = meta("og:title");
  if (!title) return null;
  const artist = meta("og:description")?.split(" · ")[0]?.trim();
  return { title: entities(title).trim(), artist: artist ? entities(artist) : null };
}

async function trackInfo(id: string): Promise<{ title: string; artist: string | null }> {
  const res = await fetch(`https://open.spotify.com/track/${id}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; chongfuxi)", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new SongError(`Spotify didn't give the song (${res.status}).`);
  const found = readTrackPage(await res.text());
  if (found) return found;
  // The embed's own description: the title only.
  const o = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${id}`)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  const title = o.ok ? ((await o.json()) as { title?: string }).title : undefined;
  if (!title) throw new SongError("Couldn't read the song's title from Spotify.");
  return { title, artist: null };
}

interface LrcRecord {
  trackName?: string;
  artistName?: string;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const textOf = (r: LrcRecord) => r.plainLyrics || (r.syncedLyrics ?? "").replace(/^\[[^\]]*\]\s*/gm, "");

/** The song's lyrics from LRCLIB: by title and artist, else by title alone (an artist written another way). */
async function lyricsFor(title: string, artist: string | null): Promise<string | null> {
  const search = async (params: Record<string, string>) => {
    const res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams(params)}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    return ((await res.json()) as LrcRecord[]).filter((r) => !r.instrumental && textOf(r).trim());
  };
  if (artist) {
    const hit = (await search({ track_name: title, artist_name: artist }))[0];
    if (hit) return textOf(hit);
  }
  const any = await search({ track_name: title });
  const same = artist ? any.find((r) => r.artistName && (r.artistName.includes(artist) || artist.includes(r.artistName))) : null;
  return (same ?? any[0]) ? textOf(same ?? any[0]) : null;
}

let toSimp: Map<string, string> | null = null;
/**
 * Traditional characters to simplified, from CC-CEDICT's single-character
 * entries: only those that are never themselves a simplified character (so
 * 後 → 后, but 著 and 乾 stay), each to its usual simplified form.
 */
function simplifier(): Map<string, string> {
  if (toSimp) return toSimp;
  const lines = readFileSync(join(process.cwd(), "chongfuxi", "data", "cedict.txt"), "utf8").split("\n");
  const simplifiedChars = new Set<string>();
  const pairs = new Map<string, Map<string, number>>();
  for (const line of lines) {
    if (!line || line[0] === "#") continue;
    const [simp, trad] = line.split("\t");
    for (const c of simp) simplifiedChars.add(c);
    if (!trad || [...simp].length !== [...trad].length) continue;
    [...trad].forEach((t, i) => {
      const s = [...simp][i];
      if (t === s) return;
      const n = pairs.get(t) ?? new Map<string, number>();
      n.set(s, (n.get(s) ?? 0) + 1);
      pairs.set(t, n);
    });
  }
  toSimp = new Map();
  for (const [t, counts] of pairs) {
    if (simplifiedChars.has(t)) continue;
    toSimp.set(t, [...counts].sort((a, b) => b[1] - a[1])[0][0]);
  }
  return toSimp;
}

export const simplified = (text: string) => {
  const map = simplifier();
  return [...text].map((c) => map.get(c) ?? c).join("");
};

/** Credit lines (作词：…, 作曲 / 编曲 …) say who wrote it, not the song. */
const CREDIT = /^[^:：]{0,10}[词詞曲][^:：]{0,4}[:：]/;

/** The song's words, in the order they first come, as the dictionary splits its lines. */
export function songWords(lyrics: string, dict: Dict, corpus: Set<string>): string[] {
  const vocab = dict.headwords(SPLIT_MAX);
  for (const w of corpus) if ([...w].length <= SPLIT_MAX) vocab.add(w);
  const context = { charReadings: dict.readings as Map<string, Set<string>>, vocab, maxLen: SPLIT_MAX };
  const seen = new Set<string>();
  for (const line of simplified(lyrics).split(/\n+/)) {
    if (!line.trim() || CREDIT.test(line)) continue;
    for (const w of segmentByDictionary(line, context).words) {
      if (/^[㐀-鿿]+$/.test(w) && (dict.has(w) || corpus.has(w))) seen.add(w);
    }
  }
  return [...seen];
}

/**
 * File a song's words under Spotify/<title>. Given a link, the song is looked
 * up and its lyrics fetched; given lyrics too (pasted when none were found),
 * those are used. Words not yet in the corpus come in as list words, with
 * CC-CEDICT's definitions, as a Pleco list's do; none is added to the deck.
 */
export async function addSong(
  sql: Sql,
  owner: string,
  dict: Dict,
  input: { link: string; lyrics?: string | null },
): Promise<{ list: string; title: string; artist: string | null; words: number; fresh: number } | { needLyrics: true; title: string; artist: string | null }> {
  await ensure(sql);
  const id = trackId(input.link);
  if (!id) throw new SongError("That isn't a Spotify song link (open.spotify.com/track/…).");
  const { title, artist } = await trackInfo(id);
  const pasted = input.lyrics?.trim();
  const lyrics = pasted || (await lyricsFor(title, artist));
  if (!lyrics) return { needLyrics: true, title, artist };

  const corpus = new Set(
    ((await sql`select word from chongfuxi_word where owner_email = ${owner}`) as unknown as Array<{ word: string }>).map((r) => r.word),
  );
  const words = songWords(lyrics, dict, corpus).slice(0, SONG_WORDS_MAX);
  if (!words.length) throw new SongError("No Chinese words in those lyrics.");

  // Its own list: by title, or by title and artist when another song has the title.
  const name = title.replace(/\//g, "／");
  const taken = (await sql`
    select list, track_id from chongfuxi_song where owner_email = ${owner} and list = ${`${SPOTIFY_LIST}/${name}`}
  `) as unknown as Array<{ list: string; track_id: string | null }>;
  const list = taken[0] && taken[0].track_id !== id && artist ? `${SPOTIFY_LIST}/${name} · ${artist.replace(/\//g, "／")}` : `${SPOTIFY_LIST}/${name}`;

  const fresh = words.filter((w) => !corpus.has(w));
  const rows = fresh.map((w) => {
    const defs = definitionsFor(dict, w, null, null) as Definition[];
    return { w, p: mainEntry(defs, null)?.p ?? null, d: defs };
  });
  await sql.transaction([
    // New words come in as list words, as a Pleco list's do.
    sql`
      insert into chongfuxi_word (owner_email, word, status, pinyin, defs, lists)
      select ${owner}, e.value->>'w', 'listed', e.value->>'p', coalesce(e.value->'d', '[]'::jsonb), array[${list}]::text[]
      from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) e
      on conflict (owner_email, word) do nothing
    `,
    // Every word of it, new or not, filed under the song.
    sql`
      update chongfuxi_word set lists = lists || array[${list}]::text[]
      where owner_email = ${owner} and word = any(${words}::text[]) and not (${list} = any(lists))
    `,
    sql`
      insert into chongfuxi_song (owner_email, list, track_id, url, title, artist, lyrics_from, words)
      values (${owner}, ${list}, ${id}, ${`https://open.spotify.com/track/${id}`}, ${title}, ${artist}, ${pasted ? "pasted" : "lrclib"}, ${words.length})
      on conflict (owner_email, list) do update set
        track_id = excluded.track_id, url = excluded.url, title = excluded.title, artist = excluded.artist,
        lyrics_from = excluded.lyrics_from, words = excluded.words, added = now()
    `,
  ]);
  return { list, title, artist, words: words.length, fresh: fresh.length };
}
