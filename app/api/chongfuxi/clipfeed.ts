// Clips to scroll through like TikTok, to test listening (the owner: "scroll
// through parts of chapters or whole episodes as if it's tiktok, to help me
// test my comprehension, maybe organized by what words are waiting for review
// or recently reviewed or having trouble"). A clip is a line of one of the
// owner's episodes with the lines either side when they run on (a gap under
// CLIP_GAP), at most CLIP_LINES lines. By words: the deck words due today,
// answered lately, forgotten lately or just through Learn, each heard in up
// to PER_WORD clips, the words taking turns, most urgent first; or a whole
// episode in order. Nothing here is written: the screen keeps its own tally.
// Owner only, as the subtitles are.

import type { ClipMode, EpisodeLine, FeedClip, ClipFeed } from "@chongfuxi/lib/api";
import type { Definition } from "@chongfuxi/lib/dict";
import type { StudyDay } from "@chongfuxi/lib/day";
import type { Sql } from "./db";
import { EpisodeError, ensureTables } from "./episodes";
import { shownPinyin } from "./review";
import { videoId } from "./youtube";

/** Lines either side join a clip when the gap to them is under this (ms). */
const CLIP_GAP = 1500;
/** At most this many lines a clip. */
const CLIP_LINES = 3;
/** A whole episode is cut into clips of about this long (ms), at most CLIP_LINES lines. */
const EPISODE_CLIP_MS = 10_000;
/** Clips a word is heard in, at most. */
const PER_WORD = 2;
/** Clips in a feed, at most. */
const FEED_MAX = 80;
/** Words looked for, at most, by urgency. */
const WORDS_MAX = 1500;
/** Recently: answered in the last this many days; trouble: forgotten in this many; just learnt: through Learn in this many. */
const RECENT_DAYS = 3;
const TROUBLE_DAYS = 30;
const LEARNT_DAYS = 14;
/** Words are matched as written, two to six characters: a lone character is inside every other word. */
const WORD_MIN = 2;
const WORD_MAX = 6;

export const CLIP_MODES: ClipMode[] = ["due", "recent", "trouble", "learnt", "episode"];

/** The deck words a mode is about, most urgent first. */
async function focusWords(sql: Sql, owner: string, mode: Exclude<ClipMode, "episode">, day: StudyDay): Promise<string[]> {
  const deck = `exists (select 1 from chongfuxi_word w where w.owner_email = $1 and w.word = x.word and w.status = 'deck') and char_length(x.word) between ${WORD_MIN} and ${WORD_MAX}`;
  const q =
    mode === "due"
      ? // Read or Recall cards due before the day ends, not waiting for Learn, the most overdue first.
        `select x.word from (
           select c.word, min(c.due) as at from chongfuxi_card c
           where c.owner_email = $1 and c.kind in ('read', 'produce') and c.meaning_id is null and c.word is not null
             and c.retired is null and not c.suspended and c.due <= to_timestamp($2::double precision / 1000)
             and not (c.kind = 'read' and c.state = 0 and c.learned_at is null)
           group by c.word) x
         where ${deck} order by x.at, x.word limit $3`
      : mode === "recent"
        ? `select x.word from (
             select r.word, max(r.at) as at from chongfuxi_review r
             where r.owner_email = $1 and r.cause = 'answer' and r.kind in ('read', 'produce') and r.word is not null
               and r.at > to_timestamp($2::double precision / 1000) - interval '${RECENT_DAYS + 1} days'
             group by r.word) x
           where ${deck} order by x.at desc, x.word limit $3`
        : mode === "trouble"
          ? // Forgotten on its cards, or tapped in a forgotten sentence; the most often first.
            `select x.word from (
               select r.word, count(*) as n, max(r.at) as at from chongfuxi_review r
               where r.owner_email = $1 and r.grade = 'forgot' and r.word is not null
                 and r.at > to_timestamp($2::double precision / 1000) - interval '${TROUBLE_DAYS + 1} days'
               group by r.word) x
             where ${deck} order by x.n desc, x.at desc, x.word limit $3`
          : `select x.word from (
               select c.word, max(c.learned_at) as at from chongfuxi_card c
               where c.owner_email = $1 and c.kind = 'read' and c.learned_at is not null and c.word is not null
                 and c.learned_at > to_timestamp($2::double precision / 1000) - interval '${LEARNT_DAYS + 1} days'
               group by c.word) x
             where ${deck} order by x.at desc, x.word limit $3`;
  const rows = (await sql.query(q, [owner, day.cutoff, WORDS_MAX])) as unknown as Array<{ word: string }>;
  return rows.map((r) => r.word);
}

type EpRow = { id: number; show: string; episode: string; lines: EpisodeLine[]; video: string | null; source: string | null; offset_ms: number };

/** The words of `words` said in a run of text. */
function wordsIn(zh: string, words: Set<string>): string[] {
  const chars = [...zh];
  const found = new Set<string>();
  for (let a = 0; a < chars.length; a++)
    for (let n = WORD_MIN; n <= WORD_MAX && a + n <= chars.length; n++) {
      const w = chars.slice(a, a + n).join("");
      if (words.has(w)) found.add(w);
    }
  // A word inside another found one (发现 in 发现了… is fine, 现 never: two characters at least) counts once, as the longer.
  return [...found].filter((w) => ![...found].some((o) => o !== w && o.includes(w)));
}

/** A line with the lines either side that run on into it, at most CLIP_LINES. */
function around(lines: EpisodeLine[], i: number): [number, number] {
  let from = i;
  let to = i;
  if (i > 0 && lines[i].s - lines[i - 1].e < CLIP_GAP) from = i - 1;
  if (to - from + 1 < CLIP_LINES && i + 1 < lines.length && lines[i + 1].s - lines[i].e < CLIP_GAP) to = i + 1;
  return [from, to];
}

const clipOf = (r: EpRow, from: number, to: number, words: string[]): FeedClip => ({
  key: `${r.id}:${from}`,
  id: r.id,
  show: r.show,
  episode: r.episode,
  video: r.video ?? videoId(r.source ?? ""),
  offset: r.offset_ms,
  from,
  lines: r.lines.slice(from, to + 1),
  words,
});

async function looksOf(sql: Sql, owner: string, words: string[]): Promise<ClipFeed["looks"]> {
  if (!words.length) return {};
  const rows = (await sql`
    select word, pinyin, defs, glosses from chongfuxi_word where owner_email = ${owner} and word = any(${words})
  `) as unknown as Array<{ word: string; pinyin: string | null; defs: Definition[] | null; glosses: string[] | null }>;
  return Object.fromEntries(rows.map((r) => [r.word, { pinyin: shownPinyin(r.pinyin, r.defs) || null, gloss: r.glosses?.[0] ?? null }]));
}

/**
 * The feed for a mode, across every episode or, with `id`, one. By words:
 * every line saying one of them, as clips; then each word in turn, most
 * urgent first, takes its best clip not yet taken (another episode than
 * its first, then one with the video, the most of the words, the shortest), a second round
 * after the first, up to PER_WORD each and FEED_MAX in all. A whole
 * episode: its lines in order, cut where a clip would pass
 * EPISODE_CLIP_MS or CLIP_LINES, or at a gap of CLIP_GAP or more, each
 * marked with the words due, forgotten or just learnt it says.
 */
export async function clipFeed(sql: Sql, owner: string, mode: ClipMode, day: StudyDay, id?: number): Promise<ClipFeed> {
  await ensureTables(sql);
  const eps = (
    id
      ? await sql`select id::int as id, show, episode, lines, video, source, offset_ms from chongfuxi_episode where owner_email = ${owner} and id = ${id}`
      : await sql`select id::int as id, show, episode, lines, video, source, offset_ms from chongfuxi_episode where owner_email = ${owner} order by at desc`
  ) as unknown as EpRow[];
  if (id && !eps.length) throw new EpisodeError("No such episode.");

  if (mode === "episode") {
    if (!id) throw new EpisodeError("A whole episode needs its id.");
    const [r] = eps;
    const marks = new Set((await Promise.all((["due", "trouble", "learnt"] as const).map((m) => focusWords(sql, owner, m, day)))).flat());
    const clips: FeedClip[] = [];
    let from = 0;
    for (let i = 0; i < r.lines.length; i++) {
      const next = r.lines[i + 1];
      const end = !next || i - from + 1 >= CLIP_LINES || next.e - r.lines[from].s > EPISODE_CLIP_MS || next.s - r.lines[i].e >= CLIP_GAP;
      if (!end) continue;
      clips.push(clipOf(r, from, i, wordsIn(r.lines.slice(from, i + 1).map((l) => l.zh).join(""), marks)));
      from = i + 1;
    }
    const said = [...new Set(clips.flatMap((c) => c.words))];
    return { mode, clips, looks: await looksOf(sql, owner, said), words: said.length };
  }

  const focus = await focusWords(sql, owner, mode, day);
  const set = new Set(focus);
  // Every line saying a focus word, as its clip, by word.
  const byWord = new Map<string, Array<{ clip: FeedClip; n: number; ms: number }>>();
  for (const r of eps)
    r.lines.forEach((l, i) => {
      if (!wordsIn(l.zh, set).length) return;
      const [from, to] = around(r.lines, i);
      const said = wordsIn(r.lines.slice(from, to + 1).map((x) => x.zh).join(""), set);
      const clip = clipOf(r, from, to, said);
      for (const w of said) {
        const list = byWord.get(w) ?? [];
        list.push({ clip, n: said.length, ms: r.lines[to].e - r.lines[from].s });
        byWord.set(w, list);
      }
    });
  // With the video first (it is heard from the video), then the most of the words, then the shortest.
  for (const list of byWord.values()) list.sort((a, b) => Number(!!b.clip.video) - Number(!!a.clip.video) || b.n - a.n || a.ms - b.ms);
  const taken = new Set<string>();
  // Lines already in a clip taken, so clips overlapping one aren't taken too.
  const usedLines = new Set<string>();
  const usedEp = new Map<string, Set<number>>();
  const clips: FeedClip[] = [];
  const free = (c: FeedClip) => c.lines.every((_, k) => !usedLines.has(`${c.id}:${c.from + k}`));
  for (let round = 0; round < PER_WORD && clips.length < FEED_MAX; round++)
    for (const w of focus) {
      if (clips.length >= FEED_MAX) break;
      const options = (byWord.get(w) ?? []).filter((o) => !taken.has(o.clip.key) && free(o.clip));
      if (!options.length) continue;
      // Another episode than the one it was heard in first, when there is one.
      const seen = usedEp.get(w) ?? new Set<number>();
      const pick = options.find((o) => !seen.has(o.clip.id)) ?? options[0];
      taken.add(pick.clip.key);
      pick.clip.lines.forEach((_, k) => usedLines.add(`${pick.clip.id}:${pick.clip.from + k}`));
      seen.add(pick.clip.id);
      usedEp.set(w, seen);
      clips.push(pick.clip);
    }
  const heard = focus.filter((w) => byWord.has(w));
  return { mode, clips, looks: await looksOf(sql, owner, heard), words: heard.length };
}
