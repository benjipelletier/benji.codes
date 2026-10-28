// Getting ready to watch a drama (the owner's ask: "pre study a script or
// subtitles, using my corpus as a backbone and muse analysis helping", for
// 隐秘的角落 episode 1). The owner's agent (Muse) finds an episode's subtitles
// and hands them in (agent/episodes, POST); the app splits them into timed
// lines, simplified, and measures them against the deck as the text analyser
// does. Muse reads back the words not known, each with how often it is said
// and where (GET ?id=), and preps the episode (agent/episodes/prep): the
// words ranked must know / nice to know / skip, the names in it, the scenes
// as chapters with what happens (spoilers are fine, the owner said), the
// culture and slang, and questions to answer after watching. The must-know
// words are filed as a Muse list (Muse/<show>/<episode>), so its Learn and
// Review do the studying. The lines stay out of the sentence corpus and its
// cards (the owner's choice for now), and are served to the owner only: the
// app is readable by anyone, and subtitles aren't ours to publish.

import type {
  EpisodeCard,
  EpisodeChapterPlan,
  EpisodeLine,
  EpisodeLineNote,
  EpisodeListed,
  EpisodePlan,
  EpisodePlanWord,
  EpisodeProgress,
  EpisodeScene,
  EpisodeTrouble,
  EpisodeView,
  EpisodeWord,
  LineNoteKind,
  LineWordInfo,
  Retell,
  TextToken,
} from "@chongfuxi/lib/api";
import type { Dict } from "@chongfuxi/lib/dict";
import { isStudyDay } from "@chongfuxi/lib/day";
import type { Sql } from "./db";
import { AgentError, MUSE_LIST, writeList } from "./agent";
import { addWords } from "./additions";
import { analyse } from "./analyse";
import { ownersDay } from "./daily";
import { notesForWord } from "./notes";
import { ReadingError, gradeAnswer } from "./reading";
import { rescueHooks, stuckWords } from "./rescue";
import { hskOf } from "./review";
import { simplified } from "./spotify";
import { videoId } from "./youtube";

/** Lines an episode may have, and characters a line. */
const LINES_MAX = 3000;
const LINE_MAX = 200;
/** Unknown words handed to Muse, each with up to this many of the lines it is said in. */
const WORDS_FOR_MUSE = 400;
const LINES_PER_WORD = 4;
/** Scenes cut at the pauses until Muse preps: a gap this long starts one, and a scene has at least this many lines. */
const SCENE_GAP_MS = 8000;
const SCENE_MIN_LINES = 8;
/** Scenes, words, questions Muse may give. */
const SCENES_MAX = 40;
const QUESTIONS_MAX = 8;
const HAN = /[㐀-鿿]/;

export class EpisodeError extends Error {}

let ready = false;
async function ensureTables(sql: Sql) {
  if (ready) return;
  await sql`
    create table if not exists chongfuxi_episode (
      owner_email text not null,
      id bigint generated always as identity,
      show text not null,
      episode text not null,
      title text,
      source text,
      at timestamptz not null default now(),
      lines jsonb not null,
      prep jsonb,
      prepped_at timestamptz,
      model text,
      known real,
      primary key (owner_email, id),
      unique (owner_email, show, episode)
    )
  `;
  await sql`
    create table if not exists chongfuxi_episode_retell (
      owner_email text not null,
      episode_id bigint not null,
      q int not null,
      at timestamptz not null default now(),
      answer text not null,
      result jsonb not null
    )
  `;
  // Muse's notes on lines, like Genius annotations.
  await sql`alter table chongfuxi_episode add column if not exists notes jsonb`;
  await sql`alter table chongfuxi_episode add column if not exists notes_at timestamptz`;
  // How each practice line was last answered.
  await sql`
    create table if not exists chongfuxi_episode_card (
      owner_email text not null,
      episode_id bigint not null,
      i int not null,
      result text not null,
      tries int not null default 1,
      at timestamptz not null default now(),
      primary key (owner_email, episode_id, i)
    )
  `;
  // How ready the owner was for an episode, one row a study day (the latest measure that day).
  await sql`
    create table if not exists chongfuxi_episode_progress (
      owner_email text not null,
      episode_id bigint not null,
      day date not null,
      at timestamptz not null default now(),
      known real not null,
      ready real not null,
      lines real not null,
      must_left int not null,
      primary key (owner_email, episode_id, day)
    )
  `;
  await sql`alter table chongfuxi_episode_progress add column if not exists prepped real not null default 0`;
  // The episode on YouTube, played in the app with the script following it, and how far the subtitles' clock is from the video's.
  await sql`alter table chongfuxi_episode add column if not exists video text`;
  await sql`alter table chongfuxi_episode add column if not exists offset_ms int not null default 0`;
  // Chapters done in Practice's chapter by chapter round, and the chapter retellings.
  await sql`
    create table if not exists chongfuxi_episode_chapter (
      owner_email text not null,
      episode_id bigint not null,
      chapter int not null,
      done_at timestamptz not null default now(),
      primary key (owner_email, episode_id, chapter)
    )
  `;
  await sql`
    create table if not exists chongfuxi_episode_chapter_retell (
      owner_email text not null,
      episode_id bigint not null,
      chapter int not null,
      at timestamptz not null default now(),
      answer text not null,
      result jsonb not null
    )
  `;
  // Words learnt for the show only, in Practice: never in the deck, never scheduled, counted for this episode.
  await sql`
    create table if not exists chongfuxi_episode_prepped (
      owner_email text not null,
      episode_id bigint not null,
      word text not null,
      at timestamptz not null default now(),
      primary key (owner_email, episode_id, word)
    )
  `;
  ready = true;
}

/** "00:01:02,345" or "0:01:02.34" → ms. */
function stamp(t: string): number | null {
  const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const frac = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + frac;
}

/** A cue's text lines → its Chinese (simplified) and its English, if the file is bilingual. */
function cue(text: string[]): { zh: string; en: string | null } | null {
  const clean = text
    .flatMap((l) => l.split(/\\[Nn]/))
    .map((l) => l.replace(/\{[^}]*\}/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  // A line given twice, simplified and traditional (subtitles made for both), is said once.
  const zh = [...new Set(clean.filter((l) => HAN.test(l)).map(simplified))].join(" ").slice(0, LINE_MAX);
  if (!zh) return null;
  const en = clean.filter((l) => !HAN.test(l) && /[a-z]/i.test(l)).join(" ").slice(0, LINE_MAX);
  return { zh, en: en || null };
}

/**
 * A subtitle file's cues: SRT or WebVTT (cues with "-->"), ASS/SSA
 * ("Dialogue:" lines), or plain text, a line each, spaced 2.5 s apart.
 */
function cues(raw: string): Array<{ s: number; e: number; text: string[] }> {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const out: Array<{ s: number; e: number; text: string[] }> = [];
  if (/^Dialogue:/m.test(text)) {
    for (const line of text.split("\n")) {
      const m = line.match(/^Dialogue:\s*[^,]*,([^,]+),([^,]+),(?:[^,]*,){6}(.*)$/);
      if (!m) continue;
      const s = stamp(m[1]);
      const e = stamp(m[2]);
      if (s !== null && e !== null) out.push({ s, e: Math.max(e, s), text: [m[3]] });
    }
  } else if (text.includes("-->")) {
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split("\n");
      const at = lines.findIndex((l) => l.includes("-->"));
      if (at < 0) continue;
      const [a, b] = lines[at].split("-->");
      const s = stamp(a);
      const e = stamp(b.trim().split(/\s+/)[0]);
      if (s !== null && e !== null) out.push({ s, e: Math.max(e, s), text: lines.slice(at + 1) });
    }
  } else {
    text.split("\n").forEach((l, i) => out.push({ s: i * 2500, e: i * 2500 + 2400, text: [l] }));
  }
  return out.sort((x, y) => x.s - y.s);
}

/**
 * Subtitles as timed lines. Lines without Chinese are dropped, and a line
 * said again at once is one. A bilingual file's English stays with its line.
 */
export function parseSubtitles(raw: string): EpisodeLine[] {
  const out: EpisodeLine[] = [];
  for (const { s, e, text } of cues(raw)) {
    const c = cue(text);
    if (!c) continue;
    const last = out[out.length - 1];
    if (last && last.zh === c.zh && s - last.e < 1500) {
      last.e = Math.max(last.e, e);
      continue;
    }
    out.push({ s, e, zh: c.zh, en: c.en });
  }
  return out.slice(0, LINES_MAX);
}

/** How far apart a line and an English cue may be and still be paired when they don't overlap. */
const NEAR_MS = 1000;

/**
 * An English subtitle file put onto the Chinese lines by time: each English
 * cue goes to the line it overlaps most (or the nearest, within a second),
 * a line's own English (a bilingual file's) kept first. Both must be timed
 * to the same release. Gives how many lines have English after.
 */
export function addEnglish(lines: EpisodeLine[], raw: string): number {
  const mid = (x: { s: number; e: number }) => (x.s + x.e) / 2;
  const extra = new Map<number, string[]>();
  for (const c of cues(raw)) {
    const en = c.text
      .flatMap((l) => l.split(/\\[Nn]/))
      .map((l) => l.replace(/\{[^}]*\}/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
      .filter((l) => l && !HAN.test(l) && /[a-z]/i.test(l))
      .join(" ");
    if (!en) continue;
    let best = -1;
    let score = -Infinity;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.s > c.e + NEAR_MS) break;
      if (l.e < c.s - NEAR_MS) continue;
      const overlap = Math.min(l.e, c.e) - Math.max(l.s, c.s);
      const sc = overlap > 0 ? overlap : -Math.abs(mid(l) - mid(c));
      if (sc > score) [best, score] = [i, sc];
    }
    if (best < 0) continue;
    const got = extra.get(best) ?? extra.set(best, []).get(best)!;
    if (!got.includes(en)) got.push(en);
  }
  for (const [i, ens] of extra) {
    const own = lines[i].en;
    lines[i].en = [own, ...ens.filter((x) => x !== own)].filter(Boolean).join(" ").slice(0, LINE_MAX) || null;
  }
  return lines.filter((l) => l.en).length;
}

/** Scenes cut at the pauses, as chapters until Muse preps the episode. */
export function autoScenes(lines: EpisodeLine[]): EpisodeScene[] {
  const starts = [0];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].s - lines[i - 1].e >= SCENE_GAP_MS && i - starts[starts.length - 1] >= SCENE_MIN_LINES) starts.push(i);
  }
  // The last scene too short: joined to the one before.
  if (starts.length > 1 && lines.length - starts[starts.length - 1] < SCENE_MIN_LINES) starts.pop();
  return starts.map((start, n) => ({ start, title: `第${n + 1}段`, titleEn: `Scene ${n + 1}`, summary: "", summaryEn: "", notes: [] }));
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

type Prep = {
  words: Array<{ word: string; tier: EpisodeWord["tier"]; note: string | null; keep?: boolean | null }>;
  names: string[];
  scenes: EpisodeScene[];
  questions: Array<{ zh: string; en: string }>;
};

type Row = {
  id: number;
  show: string;
  episode: string;
  title: string | null;
  at: number;
  lines: EpisodeLine[];
  prep: Prep | null;
  model: string | null;
  known: number | null;
  notes: EpisodeLineNote[] | null;
  /** When it last changed: subtitles, prep or line notes. */
  updated: number;
  /** Its YouTube video id, and video time minus subtitle time (ms). */
  video: string | null;
  offset_ms: number;
  source: string | null;
};

async function rowOf(sql: Sql, owner: string, id: number): Promise<Row> {
  await ensureTables(sql);
  const [row] = (await sql`
    select id::int as id, show, episode, title, (extract(epoch from at) * 1000)::double precision as at, lines, prep, model, known, notes,
           (extract(epoch from greatest(at, prepped_at, notes_at)) * 1000)::double precision as updated, video, offset_ms, source
    from chongfuxi_episode where owner_email = ${owner} and id = ${id}
  `) as unknown as Row[];
  if (!row) throw new EpisodeError("No such episode.");
  return row;
}

const listed = (r: Row): EpisodeListed => ({
  id: r.id,
  show: r.show,
  episode: r.episode,
  title: r.title,
  at: Math.round(r.at),
  lineCount: r.lines.length,
  duration: r.lines.length ? r.lines[r.lines.length - 1].e : 0,
  prepped: r.prep !== null,
  known: r.known,
  updatedAt: Math.round(r.updated),
});

/** The episodes, newest first: names and figures only. Readable by anyone. */
export async function listEpisodes(sql: Sql, owner: string, dict?: Dict): Promise<EpisodeListed[]> {
  await ensureTables(sql);
  if (dict) await measureStale(sql, owner, dict);
  const rows = (await sql`
    select id::int as id, show, episode, title, (extract(epoch from at) * 1000)::double precision as at,
           jsonb_build_array() as lines, prep is not null as prepped, model, known,
           jsonb_array_length(lines)::int as n, coalesce((lines->-1->>'e')::double precision, 0) as duration,
           (extract(epoch from greatest(at, prepped_at, notes_at)) * 1000)::double precision as updated
    from chongfuxi_episode where owner_email = ${owner}
    order by show, episode
  `) as unknown as Array<Omit<Row, "prep"> & { prepped: boolean; n: number; duration: number; updated: number }>;
  return rows.map((r) => ({
    id: r.id,
    show: r.show,
    episode: r.episode,
    title: r.title,
    at: Math.round(r.at),
    lineCount: r.n,
    duration: r.duration,
    prepped: r.prepped,
    known: r.known,
    updatedAt: Math.round(r.updated),
  }));
}

/** An episode's lines measured against the deck: each line's tokens, the words not known with counts and where, the looks. */
/** Which of these words are deck words. */
async function inDeck(sql: Sql, owner: string, words: string[]): Promise<Set<string>> {
  if (!words.length) return new Set();
  const rows = (await sql`
    select word from chongfuxi_word where owner_email = ${owner} and status = 'deck' and word = any(${words}::text[])
  `) as unknown as Array<{ word: string }>;
  return new Set(rows.map((x) => x.word));
}

/**
 * Muse's must-know words not in the deck. They count as new in the episode
 * even when they read through their parts (福利院 from 福利 + 院, by the
 * unlock rule for a known word with something added): Muse picked them
 * because they aren't known.
 */
async function mustNew(sql: Sql, owner: string, prep: Prep | null): Promise<Set<string>> {
  const must = (prep?.words ?? []).filter((w) => w.tier === "must").map((w) => w.word);
  const deck = await inDeck(sql, owner, must);
  return new Set(must.filter((w) => !deck.has(w)));
}

/**
 * A word's standing in an episode: names known; a word prepped for the show
 * (and not known otherwise) still being learnt; a must-know not in the deck
 * new; else as the analyser has it.
 */
const standingIn = (t: TextToken, names: Set<string>, fresh: Set<string>, prepped: Set<string>): TextToken =>
  !t.k
    ? t
    : names.has(t.t)
      ? { t: t.t, k: "known" }
      : prepped.has(t.t) && (t.k === "unknown" || fresh.has(t.t))
        ? { t: t.t, k: "learning" }
        : fresh.has(t.t)
          ? { t: t.t, k: "unknown" }
          : t;

/** The words prepped for the show in an episode. */
async function preppedIn(sql: Sql, owner: string, id: number): Promise<Set<string>> {
  const rows = (await sql`
    select word from chongfuxi_episode_prepped where owner_email = ${owner} and episode_id = ${id}
  `) as unknown as Array<{ word: string }>;
  return new Set(rows.map((r) => r.word));
}

async function measure(sql: Sql, owner: string, dict: Dict, r: Row) {
  const a = await analyse(sql, owner, dict, { text: r.lines.map((l) => l.zh).join("\n"), kind: "paste", title: r.title, url: null });
  // analyse makes a paragraph of each line (none is empty), so they pair up in order.
  const names = new Set(r.prep?.names ?? []);
  const [fresh, prepped] = await Promise.all([mustNew(sql, owner, r.prep), preppedIn(sql, owner, r.id)]);
  const tokens: TextToken[][] = a.paragraphs.map((p) => p.flat().map((t) => standingIn(t, names, fresh, prepped)));
  const where = new Map<string, number[]>();
  tokens.forEach((line, i) => {
    for (const t of line) {
      if (t.k !== "unknown") continue;
      const at = where.get(t.t) ?? where.set(t.t, []).get(t.t)!;
      if (at[at.length - 1] !== i) at.push(i);
    }
  });
  // Every word not known, from the lines themselves: the analyser lists only its top 300, and a
  // must-know said once or twice fell off that list and read as learnt.
  const said = new Map<string, number>();
  const info = new Map(a.unknown.map((u) => [u.word, u]));
  for (const line of tokens) for (const t of line) if (t.k === "unknown") said.set(t.t, (said.get(t.t) ?? 0) + 1);
  const unknown = [...said]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([word, count]) => ({
      word,
      count,
      pinyin: info.get(word)?.pinyin ?? a.looks[word]?.p ?? null,
      gloss: info.get(word)?.gloss ?? a.looks[word]?.gloss ?? null,
    }));
  return { a, tokens, where, unknown, prepped };
}

const BRIEF = `Prepare the learner to watch this episode of a Chinese drama. You get its subtitle lines (index, time, Chinese, and English when there is one) and the words in it they don't know yet, each with how often it is said and in which lines. POST to /api/chongfuxi/agent/episodes/prep:
{ "id": …, "words": [{ "word", "tier": "must" | "nice" | "skip", "keep"?: true | false, "note" }], "names": [...], "scenes": [{ "start", "title", "titleEn", "summary", "summaryEn", "notes": [...], "question": { "zh", "en" } }], "questions": [{ "zh", "en" }] }
Any of words, names, scenes and questions left out keeps what was sent before, so a part can be sent again alone.
- words: rank the unknown words. "must": words they need to follow the plot or that recur (said often, or key to a scene); about 15 to 40. "nice": worth knowing but not needed. "skip": one-offs, filler, or too rare to be worth it now. "note": a few words on how it is used here, when it isn't obvious (slang, a meaning other than the dictionary's first). "keep": whether the word is worth keeping in their deck after the show (common, useful beyond it) or only for this show (plot words, rare, slang, a one-off): words they learn for the show alone never enter their deck. Leave it out to let the app decide (an HSK word, or one in several of their sentences, is kept).
- names: every person and place name as written in the subtitles (they will stop counting as unknown).
- scenes: cut the episode into 8 to 25 scenes like YouTube chapters, by where the story moves on. "start" is the index of the scene's first line; the first starts at 0. "title" a short chapter title in simple Chinese (4 to 12 characters, like 陈警官在面馆), "titleEn" the same in English. "summary" what happens, in 1 to 3 simple Chinese sentences; "summaryEn" the same in English. Spoilers are fine. "notes": slang, dialect, culture or references in the scene a learner would miss. "question": one simple question in Chinese (with English) about what happens in the scene, for them to answer after watching it chapter by chapter, needing the scene's key words.
- questions: 3 to 5 questions in simple Chinese (with English) to answer after watching, about what happened and why, needing the episode's key words.

If the episode is on YouTube, give its link so the learner can watch it in the app with the script following: POST /api/chongfuxi/agent/episodes { "id": …, "video": "<YouTube link>" } (or "video" with the subtitles). Subtitles timed to another release can be shifted with { "id": …, "offset": <video time minus subtitle time, ms> }.

Then annotate lines like Genius annotates lyrics, in as many POSTs as you like to /api/chongfuxi/agent/episodes/lines:
{ "id": …, "lines": [{ "i": <line index>, "quote": "<the exact run of the line it is about, or omit for the whole line>", "kind": "trouble" | "slang" | "grammar" | "culture" | "meaning" | "listening", "text": "…", "words": ["corpus words it is about"] }], "replace": false }
- First every line with one of their trouble words ("trouble" in the material, with why: a stuck word's pattern, a recent Forgot, their own note): kind "trouble", saying how the word is used here and what to tell it apart from, in their terms (the partner they mix it up with, what they wrote).
- Then lines that are hard to follow for other reasons: slang or dialect, a grammar point, a cultural reference, a meaning other than the dictionary's, or something hard to catch by ear (fast, swallowed, a homophone).
- "text" is 1 to 3 sentences in English, Chinese in Chinese; don't translate the line (the English is shown already). Skip lines with nothing worth saying. A note replaces the one already on its line.`;

/** What Muse needs to prep an episode, or the list of episodes and whether each is prepped. Readable by the agent. */
export async function episodeMaterial(sql: Sql, owner: string, dict: Dict, id: number) {
  const r = await rowOf(sql, owner, id);
  const { a, tokens, where, unknown } = await measure(sql, owner, dict, r);
  const at = wordLines(tokens);
  const trouble = await troubleIn(sql, owner, [...at.keys()]);
  return {
    id: r.id,
    show: r.show,
    episode: r.episode,
    brief: BRIEF,
    prepped: r.prep !== null,
    known: a.words.total ? Math.round((a.words.known / a.words.total) * 1000) / 1000 : 0,
    lines: r.lines.map((l, i) => ({
      i,
      at: clock(l.s),
      zh: l.zh,
      ...(l.en ? { en: l.en } : {}),
      // Words in it not known yet.
      new: (tokens[i] ?? []).filter((t) => t.k === "unknown").length,
    })),
    // Words in the episode they have had trouble with, and the lines they are said in: annotate those lines first.
    trouble: [...trouble.values()].map((t) => ({ ...t, lines: (at.get(t.word) ?? []).slice(0, TROUBLE_LINES) })),
    // Lines you have already annotated.
    annotated: (r.notes ?? []).map((n) => n.i),
    // Practice lines they last marked Again (heard, then read): worth a note if they have none.
    again: ((await sql`
      select i, tries from chongfuxi_episode_card where owner_email = ${owner} and episode_id = ${id} and result = 'again' order by i
    `) as unknown as Array<{ i: number; tries: number }>),
    // How many lines have English: few means the English file was missing or timed to another release.
    english: r.lines.filter((l) => l.en).length,
    unknown: unknown.slice(0, WORDS_FOR_MUSE).map((u) => ({
      word: u.word,
      count: u.count,
      pinyin: u.pinyin,
      gloss: u.gloss,
      lines: (where.get(u.word) ?? []).slice(0, LINES_PER_WORD),
    })),
  };
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Keep an episode's subtitles, as Muse found them; the same show and
 * episode again replaces the lines and drops the prep (its scenes point at
 * lines). Answers with the material to prep it from.
 */
export async function writeEpisode(
  sql: Sql,
  owner: string,
  dict: Dict,
  input: { show?: unknown; episode?: unknown; title?: unknown; subtitles?: unknown; english?: unknown; source?: unknown; video?: unknown },
) {
  await ensureTables(sql);
  const show = str(input.show, 60);
  const episode = str(input.episode, 30);
  if (!show || !episode) throw new AgentError("Give the show and the episode (\"E01\").");
  if (typeof input.subtitles !== "string" || !input.subtitles.trim()) throw new AgentError("Give the subtitles as text (SRT, WebVTT, ASS, or a line each).");
  const lines = parseSubtitles(input.subtitles);
  if (lines.length < 5) throw new AgentError(`Only ${lines.length} lines with Chinese were found: is it the Chinese track?`);
  if (typeof input.english === "string" && input.english.trim()) addEnglish(lines, input.english);
  // The video to play it with: given, or the source when that is a YouTube link.
  const video = videoId(str(input.video, 500)) ?? videoId(str(input.source, 500));
  const [row] = (await sql`
    insert into chongfuxi_episode (owner_email, show, episode, title, source, lines, video)
    values (${owner}, ${show}, ${episode}, ${str(input.title, 120) || null}, ${str(input.source, 500) || null}, ${JSON.stringify(lines)}::jsonb, ${video})
    on conflict (owner_email, show, episode) do update set
      title = coalesce(excluded.title, chongfuxi_episode.title), source = excluded.source, lines = excluded.lines,
      video = coalesce(excluded.video, chongfuxi_episode.video),
      at = now(), prep = null, prepped_at = null, model = null, known = null
    returning id::int as id
  `) as unknown as Array<{ id: number }>;
  return episodeMaterial(sql, owner, dict, row.id);
}

/** Keep Muse's prep: checked against the episode, the must-know words filed as a Muse list. */
export async function writePrep(sql: Sql, owner: string, dict: Dict, input: Record<string, unknown>) {
  const id = typeof input.id === "number" ? input.id : 0;
  const r = await rowOf(sql, owner, id);
  const n = r.lines.length;
  const words = (Array.isArray(input.words) ? input.words : [])
    .map((w) => (w ?? {}) as Record<string, unknown>)
    .map((w) => ({
      word: str(w.word, 12),
      tier: (w.tier === "must" || w.tier === "nice" || w.tier === "skip" ? w.tier : "nice") as EpisodeWord["tier"],
      note: str(w.note, 200) || null,
      keep: typeof w.keep === "boolean" ? w.keep : null,
    }))
    .filter((w) => HAN.test(w.word));
  const names = [...new Set((Array.isArray(input.names) ? input.names : []).map((x) => str(x, 12)).filter((x) => HAN.test(x)))];
  const starts = new Set<number>();
  const scenes = (Array.isArray(input.scenes) ? input.scenes : [])
    .map((x) => (x ?? {}) as Record<string, unknown>)
    .map((x) => ({
      start: typeof x.start === "number" ? Math.trunc(x.start) : -1,
      title: str(x.title, 60),
      titleEn: str(x.titleEn, 80),
      summary: str(x.summary, 400),
      summaryEn: str(x.summaryEn, 600),
      notes: (Array.isArray(x.notes) ? x.notes : []).map((t) => str(t, 300)).filter(Boolean).slice(0, 6),
      question: (() => {
        const q = (x.question ?? null) as Record<string, unknown> | null;
        return q && HAN.test(str(q.zh, 200)) ? { zh: str(q.zh, 200), en: str(q.en, 300) } : null;
      })(),
    }))
    .filter((x) => x.start >= 0 && x.start < n && !starts.has(x.start) && starts.add(x.start))
    .sort((a, b) => a.start - b.start)
    .slice(0, SCENES_MAX);
  if (scenes.length) scenes[0].start = 0;
  const questions = (Array.isArray(input.questions) ? input.questions : [])
    .map((q) => (q ?? {}) as Record<string, unknown>)
    .map((q) => ({ zh: str(q.zh, 200), en: str(q.en, 300) }))
    .filter((q) => HAN.test(q.zh))
    .slice(0, QUESTIONS_MAX);
  // A part left out keeps what was there, so the scenes (say) can be sent again alone.
  const given = (k: string) => Array.isArray(input[k]);
  const old = r.prep;
  if (!old && !words.length && !scenes.length) throw new AgentError("Give at least the words or the scenes.");
  if (!given("words") && !given("names") && !given("scenes") && !given("questions")) throw new AgentError("Give the words, names, scenes or questions.");
  const prep: Prep = {
    words: given("words") || !old ? words : old.words,
    names: given("names") || !old ? names : old.names,
    scenes: given("scenes") || !old ? scenes : old.scenes,
    questions: given("questions") || !old ? questions : old.questions,
  };
  await sql`
    update chongfuxi_episode set prep = ${JSON.stringify(prep)}::jsonb, prepped_at = now(), model = ${str(input.model, 60) || "Muse"}
    where owner_email = ${owner} and id = ${id}
  `;
  const must = prep.words.filter((w) => w.tier === "must").map((w) => w.word);
  const list = given("words") && must.length ? await writeList(sql, owner, dict, { path: [r.show, r.episode], words: must, replace: true }) : null;
  return { id, words: prep.words.length, must: must.length, names: prep.names.length, scenes: prep.scenes.length, questions: prep.questions.length, list };
}

/** Episodes measured on the list each time it is read, at most, when today's measure is missing (each is a full analysis). */
const MEASURE_ON_LIST = 3;

/** Shares (0–1) of an episode's word occurrences known, known once the must-knows are learnt, and lines readable. */
function readiness(tokens: TextToken[][], must: Set<string>, prepped: Set<string> = new Set()) {
  let all = 0;
  let known = 0;
  let ready = 0;
  let readable = 0;
  let prep = 0;
  const left = new Set<string>();
  const perLine = tokens.map((line) => {
    const ws = line.filter((t) => t.k);
    all += ws.length;
    const k = ws.filter((t) => t.k !== "unknown").length;
    known += k;
    prep += ws.filter((t) => t.k === "learning" && prepped.has(t.t)).length;
    const m = ws.filter((t) => t.k === "unknown" && must.has(t.t));
    for (const t of m) left.add(t.t);
    ready += k + m.length;
    if (ws.length && k === ws.length) readable++;
    return { words: ws.length, known: k };
  });
  return {
    coverage: {
      known: all ? known / all : 0,
      ready: all ? ready / all : 0,
      lines: tokens.length ? readable / tokens.length : 0,
      prepped: all ? prep / all : 0,
    },
    mustLeft: left.size,
    perLine,
  };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Today's measure of an episode, kept (one a study day, the latest wins), and the share known on the episode's row. */
async function record(sql: Sql, owner: string, id: number, r: ReturnType<typeof readiness>) {
  const day = await ownersDay(sql, owner);
  const c = r.coverage;
  await sql`
    insert into chongfuxi_episode_progress (owner_email, episode_id, day, known, ready, lines, must_left, prepped)
    values (${owner}, ${id}, ${day}, ${round3(c.known)}, ${round3(c.ready)}, ${round3(c.lines)}, ${r.mustLeft}, ${round3(c.prepped)})
    on conflict (owner_email, episode_id, day) do update set
      at = now(), known = excluded.known, ready = excluded.ready, lines = excluded.lines, must_left = excluded.must_left, prepped = excluded.prepped
  `;
  await sql`update chongfuxi_episode set known = ${round3(c.known)} where owner_email = ${owner} and id = ${id}`;
}

async function progressOf(sql: Sql, owner: string, id: number): Promise<EpisodeProgress[]> {
  return (await sql`
    select to_char(day, 'YYYY-MM-DD') as day, known, ready, lines, must_left as "mustLeft", prepped
    from chongfuxi_episode_progress where owner_email = ${owner} and episode_id = ${id} order by day
  `) as unknown as EpisodeProgress[];
}

const mustOf = (prep: Prep | null) => new Set((prep?.words ?? []).filter((w) => w.tier === "must").map((w) => w.word));

/** Measure the episodes not yet measured today, a few at a time, so their graphs grow without opening each. */
async function measureStale(sql: Sql, owner: string, dict: Dict) {
  const day = await ownersDay(sql, owner);
  const stale = (await sql`
    select e.id::int as id from chongfuxi_episode e
    where e.owner_email = ${owner}
      and not exists (select 1 from chongfuxi_episode_progress p where p.owner_email = e.owner_email and p.episode_id = e.id and p.day = ${day})
    order by e.at desc limit ${MEASURE_ON_LIST}
  `) as unknown as Array<{ id: number }>;
  for (const { id } of stale) {
    const r = await rowOf(sql, owner, id);
    const { tokens, prepped } = await measure(sql, owner, dict, r);
    await record(sql, owner, id, readiness(tokens, mustOf(r.prep), prepped));
  }
}

/** The episode opened for study, measured against the deck now. Owner only. */
export async function openEpisode(sql: Sql, owner: string, dict: Dict, id: number): Promise<EpisodeView> {
  const r = await rowOf(sql, owner, id);
  const { a, tokens, unknown, prepped } = await measure(sql, owner, dict, r);
  const prep = r.prep;
  const tier = new Map((prep?.words ?? []).map((w) => [w.word, w]));
  const order = { must: 0, nice: 1, skip: 2 } as const;
  const words: EpisodeWord[] = unknown
    .map((u) => ({
      word: u.word,
      tier: tier.get(u.word)?.tier ?? ("nice" as const),
      note: tier.get(u.word)?.note ?? null,
      count: u.count,
      pinyin: u.pinyin,
      gloss: u.gloss,
      inDeck: false,
    }))
    .sort((x, y) => order[x.tier] - order[y.tier] || y.count - x.count);
  // Must-know words no longer unknown still show: as learnt when they are in the deck now, so the
  // list says what was done; otherwise (read through their parts, or split differently in the
  // lines) as they are, with how often they are said.
  const must = (prep?.words ?? []).filter((w) => w.tier === "must");
  const rest = must.filter((w) => !words.some((x) => x.word === w.word));
  const deck = rest.length
    ? new Set(
        ((await sql`
          select word from chongfuxi_word where owner_email = ${owner} and status = 'deck' and word = any(${rest.map((w) => w.word)}::text[])
        `) as unknown as Array<{ word: string }>).map((x) => x.word),
      )
    : new Set<string>();
  const saidAll = new Map<string, number>();
  for (const line of tokens) for (const t of line) if (t.k) saidAll.set(t.t, (saidAll.get(t.t) ?? 0) + 1);
  for (const w of [...rest].reverse()) {
    const entry = dict.lookup(w.word)[0];
    const look = a.looks[w.word] ?? (entry ? { p: entry.p, gloss: entry.senses.slice(0, 2).join("; ") } : null);
    words.unshift({ word: w.word, tier: "must", note: w.note, count: saidAll.get(w.word) ?? 0, pinyin: look?.p ?? null, gloss: look?.gloss ?? null, inDeck: deck.has(w.word) });
  }
  words.sort((x, y) => order[x.tier] - order[y.tier] || Number(x.inDeck) - Number(y.inDeck) || y.count - x.count);
  const measured = readiness(tokens, mustOf(prep), prepped);
  const lineKnown = measured.perLine;
  const sceneList = prep?.scenes.length ? prep.scenes : autoScenes(r.lines);
  const scenes = sceneList.map((sc, i) => {
    const end = i + 1 < sceneList.length ? sceneList[i + 1].start : r.lines.length;
    const part = lineKnown.slice(sc.start, end);
    const w = part.reduce((n, x) => n + x.words, 0);
    return { ...sc, end, known: w ? part.reduce((n, x) => n + x.known, 0) / w : 1 };
  });
  const knownShare = measured.coverage.known;
  await record(sql, owner, id, measured);
  // The words worth a practice line: must-knows not learnt, then the owner's trouble words.
  const trouble = await troubleIn(sql, owner, [...wordLines(tokens).keys()]);
  const targets = new Map<string, "must" | "trouble">();
  for (const w of words) if (w.tier === "must" && !w.inDeck) targets.set(w.word, "must");
  for (const w of trouble.keys()) if (!targets.has(w)) targets.set(w, "trouble");
  const retells = (await sql`
    select q, answer, result, (extract(epoch from at) * 1000)::double precision as at
    from chongfuxi_episode_retell where owner_email = ${owner} and episode_id = ${id} order by at
  `) as unknown as Array<{ q: number; answer: string; result: Omit<Retell, "q" | "answer" | "at">; at: number }>;
  return {
    ...listed({ ...r, known: knownShare }),
    model: r.model,
    lines: r.lines.map((l, i) => ({ ...l, tokens: tokens[i] ?? [{ t: l.zh }] })),
    scenes,
    autoScenes: !prep?.scenes.length,
    words,
    names: prep?.names ?? [],
    questions: prep?.questions ?? [],
    retells: retells.map((t) => ({ ...t.result, q: t.q, answer: t.answer, at: Math.round(t.at) })),
    coverage: measured.coverage,
    progress: await progressOf(sql, owner, id),
    notes: r.notes ?? [],
    trouble: Object.fromEntries(trouble),
    deck: await deckOf(sql, owner, id, pickDeck(r.lines, tokens, targets, (r.notes ?? []).map((n) => n.i))),
    plan: await (async () => {
      const progress = await chapterProgress(sql, owner, id);
      return planOf(sql, owner, r, tokens, unknown, measured, prepped, scenes, progress.done, progress.retells);
    })(),
    looks: a.looks,
    list: must.length ? `${MUSE_LIST}/${r.show}/${r.episode}` : null,
    video: r.video ?? videoId(r.source ?? ""),
    offset: r.offset_ms,
  };
}

/** An answer to one of the episode's questions, graded against its lines. Owner only. */
export async function gradeEpisodeAnswer(sql: Sql, owner: string, id: number, q: number, answer: string): Promise<Retell> {
  const r = await rowOf(sql, owner, id);
  const said = answer.trim().slice(0, 600);
  if (!HAN.test(said)) throw new ReadingError("Answer in Chinese.");
  const question = r.prep?.questions[q];
  if (!question) throw new ReadingError("No such question.");
  const result = await gradeAnswer(r.lines.map((l) => l.zh).join("\n"), `${r.show} ${r.episode}`, question, said);
  await sql`insert into chongfuxi_episode_retell (owner_email, episode_id, q, answer, result) values (${owner}, ${id}, ${q}, ${said}, ${JSON.stringify(result)}::jsonb)`;
  return { ...result, q, answer: said, at: Date.now() };
}

const TROUBLE_DAYS = 30;
const NOTE_DAYS = 90;
/** Lines named for each trouble word in Muse's material. */
const TROUBLE_LINES = 8;
const LINE_NOTE_KINDS: LineNoteKind[] = ["trouble", "slang", "grammar", "culture", "meaning", "listening"];
const LINE_NOTES_MAX = 1500;
const LINE_NOTE_TEXT = 500;

/**
 * Words among these the owner has had trouble with: a stuck word (its
 * category and why), else a Forgot on its cards lately, else a note written
 * about it after a Forgot.
 */
export async function troubleIn(sql: Sql, owner: string, words: string[]): Promise<Map<string, EpisodeTrouble>> {
  const out = new Map<string, EpisodeTrouble>();
  if (!words.length) return out;
  const set = new Set(words);
  for (const s of await stuckWords(sql, owner)) {
    if (set.has(s.word)) out.set(s.word, { word: s.word, kind: s.category, why: s.why, partner: s.partner });
  }
  const forgot = (await sql`
    select word, count(*)::int as n from chongfuxi_review
    where owner_email = ${owner} and kind in ('read', 'produce') and grade = 'forgot' and cause = 'answer'
      and at > now() - ${`${TROUBLE_DAYS} days`}::interval and word = any(${words}::text[])
    group by word
  `) as unknown as Array<{ word: string; n: number }>;
  for (const f of forgot) {
    if (!out.has(f.word)) out.set(f.word, { word: f.word, kind: "forgot", why: `Forgot ${f.n} ${f.n === 1 ? "time" : "times"} in ${TROUBLE_DAYS} days`, partner: null });
  }
  const noted = (await sql`
    select word, comment from chongfuxi_review
    where owner_email = ${owner} and comment is not null and word = any(${words}::text[]) and at > now() - ${`${NOTE_DAYS} days`}::interval
    order by at desc
  `) as unknown as Array<{ word: string; comment: string }>;
  for (const n of noted) {
    if (!out.has(n.word)) out.set(n.word, { word: n.word, kind: "note", why: `You wrote: “${n.comment.slice(0, 120)}”`, partner: null });
  }
  return out;
}

/** The distinct words of the lines (tokens with a standing), and the lines each is said in. */
function wordLines(tokens: TextToken[][]): Map<string, number[]> {
  const at = new Map<string, number[]>();
  tokens.forEach((line, i) => {
    for (const t of line) {
      if (!t.k) continue;
      const list = at.get(t.t) ?? at.set(t.t, []).get(t.t)!;
      if (list[list.length - 1] !== i) list.push(i);
    }
  });
  return at;
}

/**
 * Muse's notes on lines, like Genius annotations (POST agent/episodes/lines):
 * { id, lines: [{ i, quote?, kind, text, words? }], replace? }. A note
 * replaces the one on its line; `replace` drops every other. The quote must
 * be a run of the line as written, else the note is on the whole line.
 */
export async function writeLineNotes(sql: Sql, owner: string, input: Record<string, unknown>) {
  const id = typeof input.id === "number" ? input.id : 0;
  const r = await rowOf(sql, owner, id);
  const failed: Array<{ i: unknown; why: string }> = [];
  const given: EpisodeLineNote[] = [];
  for (const raw of Array.isArray(input.lines) ? input.lines : []) {
    const x = (raw ?? {}) as Record<string, unknown>;
    const i = typeof x.i === "number" && Number.isInteger(x.i) ? x.i : -1;
    const line = r.lines[i];
    if (!line) {
      failed.push({ i: x.i, why: "no such line" });
      continue;
    }
    const text = str(x.text, LINE_NOTE_TEXT);
    if (!text) {
      failed.push({ i, why: "no text" });
      continue;
    }
    const kind = LINE_NOTE_KINDS.includes(x.kind as LineNoteKind) ? (x.kind as LineNoteKind) : "meaning";
    const q = str(x.quote, 200);
    const quote = q && line.zh.includes(q) && q !== line.zh ? q : null;
    const words = (Array.isArray(x.words) ? x.words : [])
      .map((w) => str(w, 12))
      .filter((w) => HAN.test(w))
      .slice(0, 6);
    given.push({ i, quote, kind, text, words });
  }
  const byLine = new Map<number, EpisodeLineNote>(input.replace === true ? [] : (r.notes ?? []).map((n) => [n.i, n]));
  for (const n of given) byLine.set(n.i, n);
  const notes = [...byLine.values()].sort((a, b) => a.i - b.i).slice(0, LINE_NOTES_MAX);
  await sql`update chongfuxi_episode set notes = ${JSON.stringify(notes)}::jsonb, notes_at = now() where owner_email = ${owner} and id = ${id}`;
  return { written: given.length, notes: notes.length, failed };
}

/** A line's words as they live in the owner's corpus: cards, notes, lookups, sentences, a kit's hook. Owner only. */
export async function lineWords(sql: Sql, owner: string, dict: Dict, id: number, i: number): Promise<LineWordInfo[]> {
  const r = await rowOf(sql, owner, id);
  const line = r.lines[i];
  if (!line) throw new EpisodeError("No such line.");
  const a = await analyse(sql, owner, dict, { text: line.zh, kind: "paste", title: null, url: null });
  const names = new Set(r.prep?.names ?? []);
  const [fresh, prepped] = await Promise.all([mustNew(sql, owner, r.prep), preppedIn(sql, owner, r.id)]);
  const toks = a.paragraphs.flat(2).filter((t) => t.k).map((t) => standingIn(t, names, fresh, prepped));
  const words = [...new Set(toks.map((t) => t.t))];
  if (!words.length) return [];
  const standing = new Map(toks.map((t) => [t.t, t.k!]));
  // A word read through its parts rather than in the deck: the deck words it splits into, longest first.
  const throughParts = words.filter((w) => standing.get(w) !== "unknown" && !names.has(w) && [...w].length > 1);
  const pieces = throughParts.flatMap((w) => {
    const c = [...w];
    const out: string[] = [];
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j <= c.length; j++) out.push(c.slice(i, j).join(""));
    return out;
  });
  const deckPieces = await inDeck(sql, owner, [...new Set(pieces)]);
  const partsOf = (w: string): string[] | null => {
    if (deckPieces.has(w)) return null;
    const c = [...w];
    const out: string[] = [];
    for (let i = 0; i < c.length; ) {
      let j = c.length;
      while (j > i + 1 && !deckPieces.has(c.slice(i, j).join(""))) j--;
      out.push(c.slice(i, j).join(""));
      i = j;
    }
    return out.length > 1 ? out : null;
  };
  const [status, cards, lookups, sentences, hooks] = await Promise.all([
    sql`select word, status from chongfuxi_word where owner_email = ${owner} and word = any(${words}::text[])` as unknown as Promise<Array<{ word: string; status: LineWordInfo["status"] }>>,
    sql`
      select word, kind, stability, (extract(epoch from due) * 1000)::double precision as due, answered, lapses, suspended
      from chongfuxi_card where owner_email = ${owner} and kind in ('read', 'produce') and meaning_id is null and word = any(${words}::text[])
      order by kind desc
    ` as unknown as Promise<Array<{ word: string } & LineWordInfo["cards"][number]>>,
    sql`
      select w as word, l.query, l.verdict from unnest(${words}::text[]) as w
      join lateral (select query, verdict from chongfuxi_lookup where owner_email = ${owner} and strpos(query, w) > 0 order by at desc limit 2) l on true
      where char_length(w) > 1
    ` as unknown as Promise<Array<{ word: string; query: string; verdict: string | null }>>,
    sql`
      select t.word, count(distinct s.id)::int as "all",
             count(distinct s.id) filter (where cardinality(s.blockers) = 0)::int as readable,
             (array_agg(json_build_object('zh', s.zh, 'en', s.en) order by abs(char_length(s.zh) - 12))
               filter (where cardinality(s.blockers) = 0 and s.en is not null))[1] as example
      from chongfuxi_token t join chongfuxi_sentence s on s.owner_email = t.owner_email and s.id = t.sentence_id
      where t.owner_email = ${owner} and t.word = any(${words}::text[])
      group by t.word
    ` as unknown as Promise<Array<{ word: string; all: number; readable: number; example: { zh: string; en: string | null } | null }>>,
    rescueHooks(sql, owner, words),
  ]);
  const statusOf = new Map(status.map((x) => [x.word, x.status]));
  // Notes only for the words worth it (one a single character is in nearly every note).
  const notes = new Map(
    await Promise.all(
      words.map(async (w): Promise<[string, LineWordInfo["notes"]]> => [w, [...w].length > 1 || standing.get(w) !== "known" ? (await notesForWord(sql, owner, w)).slice(0, 2) : []]),
    ),
  );
  const said = (w: string) => r.lines.reduce((n, l) => n + (l.zh.split(w).length - 1), 0);
  return words.map((w) => {
    const look = a.looks[w];
    const sen = sentences.find((x) => x.word === w);
    return {
      word: w,
      standing: standing.get(w)!,
      pinyin: look?.p ?? null,
      gloss: look?.gloss ?? null,
      status: statusOf.get(w) ?? null,
      cards: cards
        .filter((c) => c.word === w)
        .map((c) => ({ kind: c.kind, stability: c.stability, due: Math.round(c.due), answered: c.answered, lapses: c.lapses, suspended: c.suspended })),
      hook: hooks.get(w) ?? null,
      notes: notes.get(w) ?? [],
      lookups: lookups.filter((x) => x.word === w).map((x) => ({ query: x.query, verdict: x.verdict })),
      sentences: { readable: sen?.readable ?? 0, all: sen?.all ?? 0, example: sen?.example ?? null },
      inEpisode: said(w),
      parts: throughParts.includes(w) ? partsOf(w) : null,
    };
  });
}

/** A word said this many times or more gets a second practice line. */
const SECOND_LINE_AT = 3;
/** The length a practice line is best at, in characters. */
const LINE_IDEAL = 12;

/**
 * The lines to practise (the owner: "a lot of sentences to get through…
 * only do the tough ones"): for each target word its easiest line (the
 * fewest other words not known, then nearest twelve characters, then one
 * with English), a second for a word said three times or more, and every
 * line Muse annotated. A line serving several words is one card. Story order.
 */
export function pickDeck(
  lines: EpisodeLine[],
  tokens: TextToken[][],
  targets: Map<string, "must" | "trouble">,
  noteLines: number[],
): Array<{ i: number; words: string[]; why: EpisodeCard["why"] }> {
  const at = wordLines(tokens);
  const picked = new Map<number, { words: Set<string>; why: Set<EpisodeCard["why"][number]> }>();
  const add = (i: number, word: string | null, why: EpisodeCard["why"][number]) => {
    const card = picked.get(i) ?? picked.set(i, { words: new Set(), why: new Set() }).get(i)!;
    if (word) card.words.add(word);
    card.why.add(why);
  };
  const han = (s: string) => (s.match(/\p{Script=Han}/gu) ?? []).length;
  for (const [word, why] of targets) {
    const found = at.get(word) ?? [];
    if (!found.length) continue;
    const cost = (i: number) =>
      (tokens[i] ?? []).filter((t) => t.k === "unknown" && t.t !== word).length * 10 +
      Math.abs(han(lines[i].zh) - LINE_IDEAL) / 3 +
      (lines[i].en ? 0 : 2);
    const best = [...found].sort((x, y) => cost(x) - cost(y) || x - y);
    add(best[0], word, why);
    // A second line away from the first, so it is heard in another moment.
    const second = found.length >= SECOND_LINE_AT ? best.find((i) => Math.abs(i - best[0]) > 2) : undefined;
    if (second !== undefined) add(second, word, why);
  }
  for (const i of noteLines) if (lines[i]) add(i, null, "note");
  return [...picked.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([i, c]) => ({ i, words: [...c.words], why: [...c.why] }));
}

/** The picked lines with how each was last answered. */
async function deckOf(sql: Sql, owner: string, id: number, cards: ReturnType<typeof pickDeck>): Promise<EpisodeCard[]> {
  const rows = (await sql`
    select i, result, tries from chongfuxi_episode_card where owner_email = ${owner} and episode_id = ${id}
  `) as unknown as Array<{ i: number; result: "got" | "again"; tries: number }>;
  const done = new Map(rows.map((r) => [r.i, r]));
  return cards.map((c) => ({ ...c, result: done.get(c.i)?.result ?? null, tries: done.get(c.i)?.tries ?? 0 }));
}

/** A practice line answered: Got it or Again. Touches no schedule. Owner only. */
export async function answerEpisodeCard(sql: Sql, owner: string, id: number, i: number, result: unknown) {
  const r = await rowOf(sql, owner, id);
  if (!r.lines[i]) throw new EpisodeError("No such line.");
  if (result !== "got" && result !== "again") throw new EpisodeError("Give got or again.");
  await sql`
    insert into chongfuxi_episode_card (owner_email, episode_id, i, result)
    values (${owner}, ${id}, ${i}, ${result})
    on conflict (owner_email, episode_id, i) do update set result = excluded.result, tries = chongfuxi_episode_card.tries + 1, at = now()
  `;
  return { ok: true };
}

/** Words a round of prep asks for at most (the owner's cap: a quick pre-watch prep, not 100%). */
export const PREP_MAX = 15;
/** A word in this many of the owner's sentences is worth keeping, if it is on no HSK list. */
const KEEP_SENTENCES = 5;
/** Lines a planned word is learnt from. */
const PLAN_LINES = 3;

/** Key words a chapter asks for at most, and lines to listen to after watching it. */
export const CHAPTER_WORDS = 5;
const CHAPTER_LISTEN = 3;

/**
 * What to learn next to be ready for an episode (the owner: "I don't need to
 * be 100% comprehension… I'm worried about having words in my deck that I'll
 * never see again after the show"). The words not known, ranked by what each
 * does for the episode (how many lines it alone keeps unreadable, how often
 * it is said, must-knows first), Muse's skips left out, at most PREP_MAX;
 * each split into worth keeping (an HSK word, one in KEEP_SENTENCES of the
 * owner's sentences, or Muse says so: it goes to the deck) or for the show
 * only (learnt here, never in the deck). The rest is listed to skip. With
 * readiness now and once the plan is learnt. And chapter by chapter (the
 * owner: "more bite size… watching this episode chapter by chapter"): each
 * chapter's key words, ranked the same way within it, and the lines to
 * listen to after watching it.
 */
async function planOf(
  sql: Sql,
  owner: string,
  r: Row,
  tokens: TextToken[][],
  unknown: Array<{ word: string; count: number; pinyin: string | null; gloss: string | null }>,
  measured: ReturnType<typeof readiness>,
  prepped: Set<string>,
  scenes: Array<{ start: number; end: number }>,
  done: Set<number>,
  retells: Map<number, Retell[]>,
): Promise<EpisodePlan> {
  const muse = new Map((r.prep?.words ?? []).map((w) => [w.word, w]));
  const info = new Map(unknown.map((u) => [u.word, u]));
  const notes = new Set((r.notes ?? []).map((n) => n.i));
  // Within a run of lines: how many each word alone keeps unreadable, how often it is said, the lines it is in.
  const measure = (from: number, to: number) => {
    const unlocks = new Map<string, number>();
    const said = new Map<string, number>();
    const linesOf = new Map<string, number[]>();
    for (let i = from; i < to; i++) {
      const fresh = (tokens[i] ?? []).filter((t) => t.k === "unknown").map((t) => t.t);
      for (const w of fresh) said.set(w, (said.get(w) ?? 0) + 1);
      const distinct = [...new Set(fresh)];
      if (distinct.length === 1) unlocks.set(distinct[0], (unlocks.get(distinct[0]) ?? 0) + 1);
      for (const w of distinct) (linesOf.get(w) ?? linesOf.set(w, []).get(w)!).push(i);
    }
    const score = (w: string) => (unlocks.get(w) ?? 0) * 3 + (said.get(w) ?? 0) + (muse.get(w)?.tier === "must" ? 8 : 0);
    const ranked = [...said.keys()].filter((w) => muse.get(w)?.tier !== "skip").sort((x, y) => score(y) - score(x) || (said.get(y) ?? 0) - (said.get(x) ?? 0));
    return { unlocks, said, linesOf, ranked };
  };
  const whole = measure(0, tokens.length);
  const chosen = whole.ranked.slice(0, PREP_MAX);
  const picked = new Set(chosen);
  const skip = unknown
    .filter((u) => !picked.has(u.word))
    .sort((x, y) => y.count - x.count)
    .slice(0, 40)
    .map((u) => ({ word: u.word, count: u.count }));
  const byChapter = scenes.map((sc) => ({ sc, m: measure(sc.start, sc.end) }));
  const chapterWords = byChapter.map(({ m }) => m.ranked.slice(0, CHAPTER_WORDS));

  // Worth keeping: on an HSK list, or common in the owner's own sentences.
  const words = [...new Set([...chosen, ...chapterWords.flat()])];
  const [listed, inSentences] = words.length
    ? await Promise.all([
        sql`select word, lists from chongfuxi_word where owner_email = ${owner} and word = any(${words}::text[])` as unknown as Promise<
          Array<{ word: string; lists: string[] }>
        >,
        sql`
          select word, count(distinct sentence_id)::int as n from chongfuxi_token
          where owner_email = ${owner} and word = any(${words}::text[]) group by word
        ` as unknown as Promise<Array<{ word: string; n: number }>>,
      ])
    : [[], []];
  const lists = new Map(listed.map((x) => [x.word, x.lists ?? []]));
  const count = new Map(inSentences.map((x) => [x.word, x.n]));
  const keepWhy = (w: string): string | null => {
    const said = muse.get(w)?.keep;
    if (said === false) return null;
    const hsk = hskOf(lists.get(w) ?? []);
    if (hsk.v3) return `HSK 3.0 · ${hsk.v3}`;
    if (hsk.old) return `HSK ${hsk.old}`;
    const n = count.get(w) ?? 0;
    if (n >= KEEP_SENTENCES) return `in ${n} of your sentences`;
    return said === true ? "Muse: worth keeping" : null;
  };
  // Lines to learn it from: the fewest other new words, then nearest twelve characters, then with English.
  const easiest = (w: string, among: number[]) =>
    among
      .map((i) => ({ i, other: new Set(tokens[i].filter((t) => t.k === "unknown" && t.t !== w).map((t) => t.t)).size }))
      .sort(
        (a, b) =>
          a.other - b.other ||
          Math.abs(r.lines[a.i].zh.length - 12) - Math.abs(r.lines[b.i].zh.length - 12) ||
          Number(!r.lines[a.i].en) - Number(!r.lines[b.i].en) ||
          a.i - b.i,
      )
      .slice(0, PLAN_LINES)
      .map((x) => x.i);
  const planWord = (w: string, m: ReturnType<typeof measure>): EpisodePlanWord => ({
    word: w,
    pinyin: info.get(w)?.pinyin ?? null,
    gloss: info.get(w)?.gloss ?? null,
    note: muse.get(w)?.note ?? null,
    must: muse.get(w)?.tier === "must",
    count: m.said.get(w) ?? 0,
    unlocks: m.unlocks.get(w) ?? 0,
    keepWhy: keepWhy(w),
    lines: easiest(w, m.linesOf.get(w) ?? []),
  });
  const planned = chosen.map((w) => planWord(w, whole));

  // After watching a chapter, its lines to listen to: those with its key words, Muse's notes, then the most new words; 5 to 30 characters.
  const listenIn = (sc: { start: number; end: number }, keys: string[]) => {
    const key = new Set(keys);
    const scored: Array<{ i: number; score: number }> = [];
    for (let i = sc.start; i < sc.end; i++) {
      const zh = r.lines[i].zh;
      if (zh.length < 5 || zh.length > 30) continue;
      const toks = tokens[i] ?? [];
      const score =
        (toks.some((t) => key.has(t.t)) ? 4 : 0) +
        (notes.has(i) ? 2 : 0) +
        toks.filter((t) => t.k === "unknown" || t.k === "learning").length;
      scored.push({ i, score });
    }
    return scored
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, CHAPTER_LISTEN)
      .map((x) => x.i)
      .sort((a, b) => a - b);
  };
  const chapters: EpisodeChapterPlan[] = byChapter.map(({ sc, m }, c) => ({
    words: chapterWords[c].map((w) => planWord(w, m)),
    listen: listenIn(sc, chapterWords[c]),
    done: done.has(c),
    retells: retells.get(c) ?? [],
  }));

  // Readiness once they are learnt: as words still being learnt, as they will be.
  const after = readiness(
    tokens.map((line) => line.map((t) => (t.k === "unknown" && picked.has(t.t) ? { t: t.t, k: "learning" as const } : t))),
    new Set(),
  ).coverage;
  return {
    chapters,
    keep: planned.filter((w) => w.keepWhy),
    show: planned.filter((w) => !w.keepWhy),
    skip,
    prepped: [...prepped],
    now: { known: measured.coverage.known, lines: measured.coverage.lines },
    after: { known: after.known, lines: after.lines },
  };
}

/** Chapters done, and the chapter retellings by chapter. */
async function chapterProgress(sql: Sql, owner: string, id: number) {
  const [done, said] = await Promise.all([
    sql`select chapter from chongfuxi_episode_chapter where owner_email = ${owner} and episode_id = ${id}` as unknown as Promise<Array<{ chapter: number }>>,
    sql`
      select chapter, answer, result, (extract(epoch from at) * 1000)::double precision as at
      from chongfuxi_episode_chapter_retell where owner_email = ${owner} and episode_id = ${id} order by at
    ` as unknown as Promise<Array<{ chapter: number; answer: string; result: Omit<Retell, "q" | "answer" | "at">; at: number }>>,
  ]);
  const retells = new Map<number, Retell[]>();
  for (const x of said) (retells.get(x.chapter) ?? retells.set(x.chapter, []).get(x.chapter)!).push({ ...x.result, q: 0, answer: x.answer, at: Math.round(x.at) });
  return { done: new Set(done.map((d) => d.chapter)), retells };
}

/** A chapter's default question, when Muse wrote none. */
const CHAPTER_QUESTION = { zh: "这一段发生了什么？", en: "What happened in this part?" };

/**
 * A chapter of an episode's chapter by chapter round: `done` marks it
 * watched and checked; `answer` is a retelling, graded at Look up's model
 * and effort (never lower) against the chapter's lines, by Muse's question
 * for it or "这一段发生了什么？". Owner only.
 */
export async function chapterStep(sql: Sql, owner: string, input: Record<string, unknown>): Promise<{ done?: true; retell?: Retell }> {
  const id = typeof input.id === "number" ? input.id : 0;
  const r = await rowOf(sql, owner, id);
  const scenes = r.prep?.scenes.length ? r.prep.scenes : autoScenes(r.lines);
  const c = typeof input.chapter === "number" ? input.chapter : -1;
  const sc = scenes[c];
  if (!sc) throw new EpisodeError("No such chapter.");
  if (input.done === true) {
    await sql`
      insert into chongfuxi_episode_chapter (owner_email, episode_id, chapter) values (${owner}, ${id}, ${c})
      on conflict (owner_email, episode_id, chapter) do update set done_at = now()
    `;
    return { done: true };
  }
  const said = str(input.answer, 600);
  if (!HAN.test(said)) throw new ReadingError("Answer in Chinese.");
  const end = c + 1 < scenes.length ? scenes[c + 1].start : r.lines.length;
  const body = r.lines.slice(sc.start, end).map((l) => l.zh).join("\n");
  const question = sc.question ?? CHAPTER_QUESTION;
  const result = await gradeAnswer(body, `${r.show} ${r.episode} · ${sc.title}`, question, said);
  await sql`
    insert into chongfuxi_episode_chapter_retell (owner_email, episode_id, chapter, answer, result)
    values (${owner}, ${id}, ${c}, ${said}, ${JSON.stringify(result)}::jsonb)
  `;
  return { retell: { ...result, q: 0, answer: said, at: Date.now() } };
}

/**
 * A word learnt in an episode's Practice. Worth keeping: into the deck (one
 * addition, source `episode:<show> <episode>`) and through Learn at once, so
 * its first real review is the next study day, like a word finished on the
 * Learn ladder. For the show only: kept as prepped for this episode, never
 * in the deck. Owner only.
 */
export async function learnEpisodeWord(sql: Sql, owner: string, dict: Dict, input: Record<string, unknown>) {
  const id = typeof input.id === "number" ? input.id : 0;
  const r = await rowOf(sql, owner, id);
  const word = str(input.learnt, 12);
  if (!HAN.test(word) || !r.lines.some((l) => l.zh.includes(word))) throw new EpisodeError("That word isn't in this episode.");
  const day = input.day;
  if (!isStudyDay(day)) throw new EpisodeError("Which study day?");
  if (input.keep === true) {
    await addWords(sql, owner, `episode:${r.show} ${r.episode}`, [word], dict);
    await sql`
      update chongfuxi_card c
      set learned_at = now(), learn_step = null,
          due = greatest(c.due, to_timestamp(${day.cutoff}::double precision / 1000) + interval '1 second')
      where c.owner_email = ${owner} and c.word = ${word} and c.kind = 'read' and c.state = 0 and c.learned_at is null
    `;
    await sql`delete from chongfuxi_episode_prepped where owner_email = ${owner} and episode_id = ${id} and word = ${word}`;
    return { word, kept: true };
  }
  await sql`
    insert into chongfuxi_episode_prepped (owner_email, episode_id, word) values (${owner}, ${id}, ${word})
    on conflict do nothing
  `;
  return { word, kept: false };
}

/** Video time minus subtitle time, at most this far either way (ms). */
const OFFSET_MAX = 10 * 60_000;

/**
 * The episode's YouTube video (a link or an id; "" takes it off), or how far
 * the subtitles' clock is from the video's: `offset` is video time minus
 * subtitle time, in ms. Owner, or the agent.
 */
export async function setEpisodeVideo(sql: Sql, owner: string, input: Record<string, unknown>) {
  const id = typeof input.id === "number" ? input.id : 0;
  await rowOf(sql, owner, id);
  if (typeof input.video === "string") {
    const raw = input.video.trim();
    const video = raw === "" ? null : (videoId(raw) ?? (/^[\w-]{11}$/.test(raw) ? raw : null));
    if (raw && !video) throw new EpisodeError("That isn't a YouTube link.");
    await sql`update chongfuxi_episode set video = ${video} where owner_email = ${owner} and id = ${id}`;
    return { id, video };
  }
  if (typeof input.offset === "number" && Number.isFinite(input.offset)) {
    const offset = Math.round(Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, input.offset)));
    await sql`update chongfuxi_episode set offset_ms = ${offset} where owner_email = ${owner} and id = ${id}`;
    return { id, offset };
  }
  throw new EpisodeError("Give { id, video } or { id, offset }.");
}
