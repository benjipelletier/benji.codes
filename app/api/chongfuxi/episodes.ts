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
  EpisodeLine,
  EpisodeLineNote,
  EpisodeListed,
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
import type { Sql } from "./db";
import { AgentError, MUSE_LIST, writeList } from "./agent";
import { analyse } from "./analyse";
import { ownersDay } from "./daily";
import { notesForWord } from "./notes";
import { ReadingError, gradeAnswer } from "./reading";
import { rescueHooks, stuckWords } from "./rescue";
import { simplified } from "./spotify";

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
  words: Array<{ word: string; tier: EpisodeWord["tier"]; note: string | null }>;
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
};

async function rowOf(sql: Sql, owner: string, id: number): Promise<Row> {
  await ensureTables(sql);
  const [row] = (await sql`
    select id::int as id, show, episode, title, (extract(epoch from at) * 1000)::double precision as at, lines, prep, model, known, notes
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
});

/** The episodes, newest first: names and figures only. Readable by anyone. */
export async function listEpisodes(sql: Sql, owner: string, dict?: Dict): Promise<EpisodeListed[]> {
  await ensureTables(sql);
  if (dict) await measureStale(sql, owner, dict);
  const rows = (await sql`
    select id::int as id, show, episode, title, (extract(epoch from at) * 1000)::double precision as at,
           jsonb_build_array() as lines, prep is not null as prepped, model, known,
           jsonb_array_length(lines)::int as n, coalesce((lines->-1->>'e')::double precision, 0) as duration
    from chongfuxi_episode where owner_email = ${owner}
    order by show, episode
  `) as unknown as Array<Omit<Row, "prep"> & { prepped: boolean; n: number; duration: number }>;
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
  }));
}

/** An episode's lines measured against the deck: each line's tokens, the words not known with counts and where, the looks. */
async function measure(sql: Sql, owner: string, dict: Dict, r: Row) {
  const a = await analyse(sql, owner, dict, { text: r.lines.map((l) => l.zh).join("\n"), kind: "paste", title: r.title, url: null });
  // analyse makes a paragraph of each line (none is empty), so they pair up in order.
  const names = new Set(r.prep?.names ?? []);
  const tokens: TextToken[][] = a.paragraphs.map((p) => p.flat().map((t) => (t.k && names.has(t.t) ? { t: t.t, k: "known" as const } : t)));
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
  return { a, tokens, where, unknown };
}

const BRIEF = `Prepare the learner to watch this episode of a Chinese drama. You get its subtitle lines (index, time, Chinese, and English when there is one) and the words in it they don't know yet, each with how often it is said and in which lines. POST to /api/chongfuxi/agent/episodes/prep:
{ "id": …, "words": [{ "word", "tier": "must" | "nice" | "skip", "note" }], "names": [...], "scenes": [{ "start", "title", "titleEn", "summary", "summaryEn", "notes": [...] }], "questions": [{ "zh", "en" }] }
Any of words, names, scenes and questions left out keeps what was sent before, so a part can be sent again alone.
- words: rank the unknown words. "must": words they need to follow the plot or that recur (said often, or key to a scene); about 15 to 40. "nice": worth knowing but not needed. "skip": one-offs, filler, or too rare to be worth it now. "note": a few words on how it is used here, when it isn't obvious (slang, a meaning other than the dictionary's first).
- names: every person and place name as written in the subtitles (they will stop counting as unknown).
- scenes: cut the episode into 8 to 25 scenes like YouTube chapters, by where the story moves on. "start" is the index of the scene's first line; the first starts at 0. "title" a short chapter title in simple Chinese (4 to 12 characters, like 陈警官在面馆), "titleEn" the same in English. "summary" what happens, in 1 to 3 simple Chinese sentences; "summaryEn" the same in English. Spoilers are fine. "notes": slang, dialect, culture or references in the scene a learner would miss.
- questions: 3 to 5 questions in simple Chinese (with English) to answer after watching, about what happened and why, needing the episode's key words.

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
  input: { show?: unknown; episode?: unknown; title?: unknown; subtitles?: unknown; english?: unknown; source?: unknown },
) {
  await ensureTables(sql);
  const show = str(input.show, 60);
  const episode = str(input.episode, 30);
  if (!show || !episode) throw new AgentError("Give the show and the episode (\"E01\").");
  if (typeof input.subtitles !== "string" || !input.subtitles.trim()) throw new AgentError("Give the subtitles as text (SRT, WebVTT, ASS, or a line each).");
  const lines = parseSubtitles(input.subtitles);
  if (lines.length < 5) throw new AgentError(`Only ${lines.length} lines with Chinese were found: is it the Chinese track?`);
  if (typeof input.english === "string" && input.english.trim()) addEnglish(lines, input.english);
  const [row] = (await sql`
    insert into chongfuxi_episode (owner_email, show, episode, title, source, lines)
    values (${owner}, ${show}, ${episode}, ${str(input.title, 120) || null}, ${str(input.source, 500) || null}, ${JSON.stringify(lines)}::jsonb)
    on conflict (owner_email, show, episode) do update set
      title = coalesce(excluded.title, chongfuxi_episode.title), source = excluded.source, lines = excluded.lines,
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
function readiness(tokens: TextToken[][], must: Set<string>) {
  let all = 0;
  let known = 0;
  let ready = 0;
  let readable = 0;
  const left = new Set<string>();
  const perLine = tokens.map((line) => {
    const ws = line.filter((t) => t.k);
    all += ws.length;
    const k = ws.filter((t) => t.k !== "unknown").length;
    known += k;
    const m = ws.filter((t) => t.k === "unknown" && must.has(t.t));
    for (const t of m) left.add(t.t);
    ready += k + m.length;
    if (ws.length && k === ws.length) readable++;
    return { words: ws.length, known: k };
  });
  return {
    coverage: { known: all ? known / all : 0, ready: all ? ready / all : 0, lines: tokens.length ? readable / tokens.length : 0 },
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
    insert into chongfuxi_episode_progress (owner_email, episode_id, day, known, ready, lines, must_left)
    values (${owner}, ${id}, ${day}, ${round3(c.known)}, ${round3(c.ready)}, ${round3(c.lines)}, ${r.mustLeft})
    on conflict (owner_email, episode_id, day) do update set
      at = now(), known = excluded.known, ready = excluded.ready, lines = excluded.lines, must_left = excluded.must_left
  `;
  await sql`update chongfuxi_episode set known = ${round3(c.known)} where owner_email = ${owner} and id = ${id}`;
}

async function progressOf(sql: Sql, owner: string, id: number): Promise<EpisodeProgress[]> {
  return (await sql`
    select to_char(day, 'YYYY-MM-DD') as day, known, ready, lines, must_left as "mustLeft"
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
    const { tokens } = await measure(sql, owner, dict, r);
    await record(sql, owner, id, readiness(tokens, mustOf(r.prep)));
  }
}

/** The episode opened for study, measured against the deck now. Owner only. */
export async function openEpisode(sql: Sql, owner: string, dict: Dict, id: number): Promise<EpisodeView> {
  const r = await rowOf(sql, owner, id);
  const { a, tokens, unknown } = await measure(sql, owner, dict, r);
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
  const measured = readiness(tokens, mustOf(prep));
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
    trouble: Object.fromEntries(await troubleIn(sql, owner, [...wordLines(tokens).keys()])),
    looks: a.looks,
    list: must.length ? `${MUSE_LIST}/${r.show}/${r.episode}` : null,
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
  await sql`update chongfuxi_episode set notes = ${JSON.stringify(notes)}::jsonb where owner_email = ${owner} and id = ${id}`;
  return { written: given.length, notes: notes.length, failed };
}

/** A line's words as they live in the owner's corpus: cards, notes, lookups, sentences, a kit's hook. Owner only. */
export async function lineWords(sql: Sql, owner: string, dict: Dict, id: number, i: number): Promise<LineWordInfo[]> {
  const r = await rowOf(sql, owner, id);
  const line = r.lines[i];
  if (!line) throw new EpisodeError("No such line.");
  const a = await analyse(sql, owner, dict, { text: line.zh, kind: "paste", title: null, url: null });
  const names = new Set(r.prep?.names ?? []);
  const toks = a.paragraphs.flat(2).filter((t) => t.k);
  const words = [...new Set(toks.map((t) => t.t))];
  if (!words.length) return [];
  const standing = new Map(toks.map((t) => [t.t, names.has(t.t) ? ("known" as const) : t.k!]));
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
    };
  });
}
