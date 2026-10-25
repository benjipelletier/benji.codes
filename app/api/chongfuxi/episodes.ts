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

import type { EpisodeLine, EpisodeListed, EpisodeScene, EpisodeView, EpisodeWord, Retell, TextToken } from "@chongfuxi/lib/api";
import type { Dict } from "@chongfuxi/lib/dict";
import type { Sql } from "./db";
import { AgentError, MUSE_LIST, writeList } from "./agent";
import { analyse } from "./analyse";
import { ReadingError, gradeAnswer } from "./reading";
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
 * Subtitles as timed lines: SRT or WebVTT (cues with "-->"), ASS/SSA
 * ("Dialogue:" lines), or plain text, a line each, spaced 2.5 s apart.
 * Lines without Chinese are dropped, and a line said again at once is one.
 */
export function parseSubtitles(raw: string): EpisodeLine[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const out: EpisodeLine[] = [];
  const push = (s: number, e: number, c: { zh: string; en: string | null } | null) => {
    if (!c) return;
    const last = out[out.length - 1];
    if (last && last.zh === c.zh && s - last.e < 1500) {
      last.e = Math.max(last.e, e);
      return;
    }
    out.push({ s, e: Math.max(e, s), zh: c.zh, en: c.en });
  };
  if (/^Dialogue:/m.test(text)) {
    for (const line of text.split("\n")) {
      const m = line.match(/^Dialogue:\s*[^,]*,([^,]+),([^,]+),(?:[^,]*,){6}(.*)$/);
      if (!m) continue;
      const s = stamp(m[1]);
      const e = stamp(m[2]);
      if (s !== null && e !== null) push(s, e, cue([m[3]]));
    }
  } else if (text.includes("-->")) {
    for (const block of text.split(/\n\s*\n/)) {
      const lines = block.split("\n");
      const at = lines.findIndex((l) => l.includes("-->"));
      if (at < 0) continue;
      const [a, b] = lines[at].split("-->");
      const s = stamp(a);
      const e = stamp(b.trim().split(/\s+/)[0]);
      if (s !== null && e !== null) push(s, e, cue(lines.slice(at + 1)));
    }
  } else {
    text.split("\n").forEach((l, i) => push(i * 2500, i * 2500 + 2400, cue([l])));
  }
  return out.sort((x, y) => x.s - y.s).slice(0, LINES_MAX);
}

/** Scenes cut at the pauses, as chapters until Muse preps the episode. */
export function autoScenes(lines: EpisodeLine[]): EpisodeScene[] {
  const starts = [0];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].s - lines[i - 1].e >= SCENE_GAP_MS && i - starts[starts.length - 1] >= SCENE_MIN_LINES) starts.push(i);
  }
  // The last scene too short: joined to the one before.
  if (starts.length > 1 && lines.length - starts[starts.length - 1] < SCENE_MIN_LINES) starts.pop();
  return starts.map((start, n) => ({ start, title: `Scene ${n + 1}`, summary: "", summaryEn: "", notes: [] }));
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
};

async function rowOf(sql: Sql, owner: string, id: number): Promise<Row> {
  await ensureTables(sql);
  const [row] = (await sql`
    select id::int as id, show, episode, title, (extract(epoch from at) * 1000)::double precision as at, lines, prep, model, known
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
export async function listEpisodes(sql: Sql, owner: string): Promise<EpisodeListed[]> {
  await ensureTables(sql);
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
  const unknown = a.unknown.filter((u) => !names.has(u.word));
  return { a, tokens, where, unknown };
}

const BRIEF = `Prepare the learner to watch this episode of a Chinese drama. You get its subtitle lines (index, time, Chinese) and the words in it they don't know yet, each with how often it is said and in which lines. POST to /api/chongfuxi/agent/episodes/prep:
{ "id": …, "words": [{ "word", "tier": "must" | "nice" | "skip", "note" }], "names": [...], "scenes": [{ "start", "title", "summary", "summaryEn", "notes": [...] }], "questions": [{ "zh", "en" }] }
- words: rank the unknown words. "must": words they need to follow the plot or that recur (said often, or key to a scene); about 15 to 40. "nice": worth knowing but not needed. "skip": one-offs, filler, or too rare to be worth it now. "note": a few words on how it is used here, when it isn't obvious (slang, a meaning other than the dictionary's first).
- names: every person and place name as written in the subtitles (they will stop counting as unknown).
- scenes: cut the episode into 8 to 25 scenes like YouTube chapters, by where the story moves on. "start" is the index of the scene's first line; the first starts at 0. "title" short, in English. "summary" what happens, in 1 to 3 simple Chinese sentences; "summaryEn" the same in English. Spoilers are fine. "notes": slang, dialect, culture or references in the scene a learner would miss.
- questions: 3 to 5 questions in simple Chinese (with English) to answer after watching, about what happened and why, needing the episode's key words.`;

/** What Muse needs to prep an episode, or the list of episodes and whether each is prepped. Readable by the agent. */
export async function episodeMaterial(sql: Sql, owner: string, dict: Dict, id: number) {
  const r = await rowOf(sql, owner, id);
  const { a, where, unknown } = await measure(sql, owner, dict, r);
  return {
    id: r.id,
    show: r.show,
    episode: r.episode,
    brief: BRIEF,
    prepped: r.prep !== null,
    known: a.words.total ? Math.round((a.words.known / a.words.total) * 1000) / 1000 : 0,
    lines: r.lines.map((l, i) => ({ i, at: clock(l.s), zh: l.zh })),
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
  input: { show?: unknown; episode?: unknown; title?: unknown; subtitles?: unknown; source?: unknown },
) {
  await ensureTables(sql);
  const show = str(input.show, 60);
  const episode = str(input.episode, 30);
  if (!show || !episode) throw new AgentError("Give the show and the episode (\"E01\").");
  if (typeof input.subtitles !== "string" || !input.subtitles.trim()) throw new AgentError("Give the subtitles as text (SRT, WebVTT, ASS, or a line each).");
  const lines = parseSubtitles(input.subtitles);
  if (lines.length < 5) throw new AgentError(`Only ${lines.length} lines with Chinese were found: is it the Chinese track?`);
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
  if (!words.length && !scenes.length) throw new AgentError("Give at least the words or the scenes.");
  const prep: Prep = { words, names, scenes, questions };
  await sql`
    update chongfuxi_episode set prep = ${JSON.stringify(prep)}::jsonb, prepped_at = now(), model = ${str(input.model, 60) || "Muse"}
    where owner_email = ${owner} and id = ${id}
  `;
  const must = words.filter((w) => w.tier === "must").map((w) => w.word);
  const list = must.length ? await writeList(sql, owner, dict, { path: [r.show, r.episode], words: must, replace: true }) : null;
  return { id, words: words.length, must: must.length, names: names.length, scenes: scenes.length, questions: questions.length, list };
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
  // Must-know words now in the deck still show, as learnt, so the list says what was done.
  const must = (prep?.words ?? []).filter((w) => w.tier === "must");
  for (const w of must) {
    if (words.some((x) => x.word === w.word)) continue;
    const look = a.looks[w.word];
    words.unshift({ word: w.word, tier: "must", note: w.note, count: 0, pinyin: look?.p ?? null, gloss: look?.gloss ?? null, inDeck: true });
  }
  const mustSet = new Set(must.map((w) => w.word));
  let all = 0;
  let known = 0;
  let readyCount = 0;
  let readable = 0;
  const lineKnown = tokens.map((line) => {
    const ws = line.filter((t) => t.k);
    all += ws.length;
    const k = ws.filter((t) => t.k !== "unknown").length;
    known += k;
    readyCount += k + ws.filter((t) => t.k === "unknown" && mustSet.has(t.t)).length;
    if (ws.length && k === ws.length) readable++;
    return { words: ws.length, known: k };
  });
  const sceneList = prep?.scenes.length ? prep.scenes : autoScenes(r.lines);
  const scenes = sceneList.map((sc, i) => {
    const end = i + 1 < sceneList.length ? sceneList[i + 1].start : r.lines.length;
    const part = lineKnown.slice(sc.start, end);
    const w = part.reduce((n, x) => n + x.words, 0);
    return { ...sc, end, known: w ? part.reduce((n, x) => n + x.known, 0) / w : 1 };
  });
  const knownShare = all ? known / all : 0;
  await sql`update chongfuxi_episode set known = ${Math.round(knownShare * 1000) / 1000} where owner_email = ${owner} and id = ${id}`;
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
    coverage: { known: knownShare, ready: all ? readyCount / all : 0, lines: r.lines.length ? readable / r.lines.length : 0 },
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
