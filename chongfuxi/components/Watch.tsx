"use client";

// Getting ready to watch a drama (app/api/chongfuxi/episodes.ts): an
// episode's subtitles, which Muse finds and preps, measured against the deck,
// as one screen like an app (the owner asked for it to work like Genius's
// lyrics). Script: the chapters fixed across the top (a bar to scrub, like
// YouTube's, and a chip each), the whole script scrolling under them, each
// line graded by its words, Muse's notes on lines marked, the owner's
// trouble words underlined; a tap on a line opens it at the foot with what
// the corpus has on its words. Words: how ready, over time, and the words to
// learn. After watching: questions graded like a reading's retelling.

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EpisodeLineNote,
  EpisodeListed,
  EpisodeProgress,
  EpisodeTrouble,
  EpisodeCard,
  EpisodeView as Episode,
  EpisodeWord,
  LineNoteKind,
  LineWordInfo,
  Retell,
  TextToken,
} from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { studyDay } from "@chongfuxi/lib/day";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { say } from "./Drill";
import { Question } from "./Reading";
import { Highlighted, Loading, fmt, message, useBackLayer } from "./shared";

/** The episodes Muse has handed in. */
export function useEpisodes(): EpisodeListed[] | null {
  const [episodes, setEpisodes] = useState<EpisodeListed[] | null>(null);
  useEffect(() => {
    get<{ episodes: EpisodeListed[] }>("episodes")
      .then((r) => setEpisodes(r.episodes))
      .catch(() => setEpisodes([]));
  }, []);
  return episodes;
}

/** 3:07, or 1:02:07. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const ENGLISH_KEY = "cfx-episode-english";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Something Muse added or changed since it was last opened here. */
export function NewBadge() {
  return <span className="cf-new-badge">New</span>;
}

/** The episodes as rows on the Muse reviews screen. */
export function EpisodeRows({ episodes, isNew, onOpen }: { episodes: EpisodeListed[]; isNew: (e: EpisodeListed) => boolean; onOpen: (id: number) => void }) {
  if (!episodes.length) return null;
  return (
    <section className="cf-revive-group cf-read-group">
      <h3 className="cf-revive-h">
        Watch <span>{fmt(episodes.length)}</span>
      </h3>
      <ul className="cf-stuck-list cf-read-list">
        {episodes.map((e) => (
          <li key={e.id}>
            <button onClick={() => onOpen(e.id)}>
              <span className="cf-stuck-body">
                <span className="cf-read-title cf-zh">
                  {e.show} · {e.episode}
                  {isNew(e) && <NewBadge />}
                </span>
                <span className="cf-stuck-gloss">
                  {clock(e.duration)} · {fmt(e.lineCount)} lines{e.known !== null && <> · {pct(e.known)} known</>}
                </span>
                {e.title && <span className="cf-stuck-why cf-read-why cf-zh">{e.title}</span>}
              </span>
              <span className={`cf-stuck-state is-${e.prepped ? "ready" : "none"}`}>{e.prepped ? "Prepped" : "Waiting for Muse"}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where each scene starts and ends on the clock: from its first line to the next scene's. */
function spans(ep: Episode): Array<{ from: number; to: number }> {
  const at = (i: number) => ep.lines[i]?.s ?? ep.duration;
  return ep.scenes.map((sc, i) => ({
    from: i === 0 ? 0 : at(sc.start),
    to: i + 1 < ep.scenes.length ? at(ep.scenes[i + 1].start) : Math.max(ep.duration, at(sc.start)),
  }));
}

/** Where an element sits in a scrolling box, from the box's top: offsetTop is measured from its chapter, not the box. */
const topIn = (box: HTMLElement, el: HTMLElement) => el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;

/** The line said at a time: the last that starts at or before it. */
function lineAt(ep: Episode, t: number): number {
  let lo = 0;
  let hi = ep.lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ep.lines[mid].s <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The episode as one bar, each scene a segment as long as it runs, like
 * YouTube's, with a playhead where the script is. Dragging along it scrubs
 * the script line by line as the finger moves (`onScrub`, the time under the
 * finger), with the time, the chapter and the line in a tip; a tap jumps
 * there. Arrow keys step a chapter (`onPick`).
 */
function ChapterBar({
  ep,
  current,
  at,
  onScrub,
  onScrubEnd,
  onPick,
  compact = false,
}: {
  ep: Episode;
  current: number;
  /** Where the script is, on the clock. */
  at: number;
  onScrub: (t: number) => void;
  /** Letting go, at the time last scrubbed to. */
  onScrubEnd?: (t: number) => void;
  onPick: (i: number) => void;
  compact?: boolean;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; t: number } | null>(null);
  const times = spans(ep);
  const total = Math.max(1, times[times.length - 1]?.to ?? ep.duration);

  const pointAt = (clientX: number) => {
    const box = bar.current!.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - box.left, 0), box.width);
    const t = (x / box.width) * total;
    let i = times.findIndex((s) => t < s.to);
    if (i < 0) i = times.length - 1;
    return { i, x, t };
  };
  const scrub = (clientX: number) => {
    const p = pointAt(clientX);
    setHover(p);
    onScrub(p.t);
  };

  const shown = hover?.i ?? current;
  const headAt = hover ? hover.t : Math.min(Math.max(at, 0), total);
  // Over the finger while scrubbing; kept clear of the ends.
  const tipAt = hover ? `${hover.x}px` : `${(headAt / total) * 100}%`;
  const tipLeft = `clamp(${compact ? 120 : 70}px, ${tipAt}, calc(100% - ${compact ? 120 : 70}px))`;
  const said = hover ? ep.lines[lineAt(ep, hover.t)]?.zh : null;
  return (
    <div className={`cf-ch${compact ? " is-compact" : ""}`}>
      <div
        ref={bar}
        className={`cf-ch-bar${hover ? " is-scrubbing" : ""}`}
        role="slider"
        tabIndex={0}
        aria-label="Chapters"
        aria-valuemin={1}
        aria-valuemax={ep.scenes.length}
        aria-valuenow={current + 1}
        aria-valuetext={`${current + 1}. ${ep.scenes[current].title}, ${clock(times[current].from)}`}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub(e.clientX);
        }}
        onPointerMove={(e) => hover && scrub(e.clientX)}
        onPointerUp={() => {
          if (hover) onScrubEnd?.(hover.t);
          setHover(null);
        }}
        onPointerCancel={() => setHover(null)}
        onLostPointerCapture={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") onPick(Math.min(current + 1, ep.scenes.length - 1));
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") onPick(Math.max(current - 1, 0));
          else return;
          e.preventDefault();
        }}
      >
        {times.map((s, i) => (
          <span
            key={i}
            className={`cf-ch-seg${i < shown ? " is-past" : ""}${i === shown ? " is-on" : ""}`}
            style={{ flexGrow: Math.max(s.to - s.from, total / 400) }}
          >
            {/* How much of the scene's words are known, as a fill along its foot. */}
            <i style={{ width: pct(ep.scenes[i].known) }} />
          </span>
        ))}
        <span className={`cf-ch-head${hover ? " is-held" : ""}`} style={{ left: `${(headAt / total) * 100}%` }} />
      </div>
      {/* Compact (over the script), the time, chapter and line show only while scrubbing. */}
      {(!compact || hover) && (
        <div className="cf-ch-tipline">
          <span className="cf-ch-tip" style={{ left: tipLeft }}>
            <span className="cf-ch-tip-top">
              <b>{clock(hover ? hover.t : times[shown].from)}</b> <span className="cf-zh">{ep.scenes[shown].title}</span>
            </span>
            {said && <span className="cf-ch-tip-line cf-zh">{said}</span>}
          </span>
        </div>
      )}
      {!compact && (
        <div className="cf-ch-ends">
          <span>0:00</span>
          <span>
            {ep.scenes.length} chapters{ep.autoScenes && " · cut at the pauses"}
          </span>
          <span>{clock(total)}</span>
        </div>
      )}
    </div>
  );
}

const SERIES = [
  { key: "known", label: "Words known", cls: "is-known" },
  { key: "ready", label: "With must-knows", cls: "is-ready" },
  { key: "lines", label: "Lines readable", cls: "is-lines" },
] as const;

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const shortDay = (d: string) => new Date(dayMs(d)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Readiness over time: words known, known with the must-knows, and lines
 * readable, a point per study day it was measured, spaced by date. A tap or
 * drag picks the nearest day and reads it out under the chart.
 */
function ProgressChart({ points }: { points: EpisodeProgress[] }) {
  const [at, setAt] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  if (!points.length) return null;
  const W = 320;
  const H = 120;
  const pad = { l: 30, r: 8, t: 8, b: 18 };
  const t0 = dayMs(points[0].day);
  const span = Math.max(dayMs(points[points.length - 1].day) - t0, 1);
  const x = (p: EpisodeProgress) => (points.length === 1 ? (pad.l + W - pad.r) / 2 : pad.l + ((dayMs(p.day) - t0) / span) * (W - pad.l - pad.r));
  // From a round step below the lowest value to 100%, so small gains show.
  const low = Math.min(...points.map((p) => Math.min(p.known, p.lines)));
  const floor = Math.max(0, Math.floor((low - 0.05) * 10) / 10);
  const y = (v: number) => pad.t + (1 - (v - floor) / (1 - floor)) * (H - pad.t - pad.b);
  const ticks = [floor, (floor + 1) / 2, 1];
  const shown = points[at ?? points.length - 1];
  const pick = (clientX: number) => {
    const box = svg.current!.getBoundingClientRect();
    const vx = ((clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((p, i) => Math.abs(x(p) - vx) < Math.abs(x(points[best]) - vx) && (best = i));
    setAt(best);
  };
  return (
    <figure className="cf-ep-chart">
      <figcaption className="cf-ep-legend">
        {SERIES.map((s) => (
          <span key={s.key} className={s.cls}>
            <i aria-hidden="true" />
            {s.label} <b>{pct(shown[s.key])}</b>
          </span>
        ))}
        {(shown.prepped ?? 0) > 0 && (
          <span className="is-prepped">
            of which prepped for the show <b>{pct(shown.prepped ?? 0)}</b>
          </span>
        )}
      </figcaption>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Readiness over ${points.length} ${points.length === 1 ? "day" : "days"}: words known from ${pct(points[0].known)} to ${pct(points[points.length - 1].known)}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e.clientX);
        }}
        onPointerMove={(e) => e.buttons && pick(e.clientX)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line className="cf-ep-grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
            <text className="cf-ep-tick" x={pad.l - 4} y={y(v) + 3} textAnchor="end">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}
        <text className="cf-ep-tick" x={pad.l} y={H - 4}>
          {shortDay(points[0].day)}
        </text>
        {points.length > 1 && (
          <text className="cf-ep-tick" x={W - pad.r} y={H - 4} textAnchor="end">
            {shortDay(points[points.length - 1].day)}
          </text>
        )}
        <line className="cf-ep-cross" x1={x(shown)} x2={x(shown)} y1={pad.t} y2={H - pad.b} />
        {SERIES.map((s) => (
          <g key={s.key} className={`cf-ep-series ${s.cls}`}>
            {points.length > 1 && <polyline points={points.map((p) => `${x(p)},${y(p[s.key])}`).join(" ")} />}
            {points.map((p, i) => (
              <circle key={i} cx={x(p)} cy={y(p[s.key])} r={p === shown ? 4.5 : points.length > 12 ? 0 : 3} />
            ))}
          </g>
        ))}
      </svg>
      <p className="cf-muted cf-ep-chart-day">
        {shortDay(shown.day)}
        {shown.mustLeft > 0 && (
          <>
            {" "}
            · {fmt(shown.mustLeft)} must-know {shown.mustLeft === 1 ? "word" : "words"} left
          </>
        )}
        {points.length === 1 && " · a point is added each day you open this or Muse reviews"}
      </p>
    </figure>
  );
}

function Readiness({ ep }: { ep: Episode }) {
  const must = ep.words.filter((w) => w.tier === "must" && !w.inDeck).length;
  return (
    <div className="cf-ep-ready">
      <p className="cf-ep-big">
        {pct(ep.coverage.known)}
        <small> of the words you&apos;ll hear are known</small>
      </p>
      <div className="cf-ep-meter" aria-hidden="true">
        <span className="is-known" style={{ width: pct(ep.coverage.known) }} />
        <span className="is-ready" style={{ width: pct(Math.max(0, ep.coverage.ready - ep.coverage.known)) }} />
      </div>
      <p className="cf-muted cf-ep-figs">
        {must > 0 && (
          <>
            <b className="cf-ep-ready-key">{pct(ep.coverage.ready)}</b> once you learn the {fmt(must)} must-know {must === 1 ? "word" : "words"} ·{" "}
          </>
        )}
        {pct(ep.coverage.lines)} of lines readable now
      </p>
      <ProgressChart points={ep.progress} />
    </div>
  );
}

function WordRow({ w }: { w: EpisodeWord }) {
  return (
    <li>
      <button className="cf-ep-word" onClick={() => wordpage.openWordPage(w.word)}>
        <span className="cf-ep-word-head">
          <span className="cf-zh">{w.word}</span>
          {w.pinyin && <span className="cf-ep-py">{displayPinyin(w.pinyin)}</span>}
          {w.inDeck ? <span className="cf-ep-in">✓ learnt</span> : w.count > 0 && <span className="cf-ep-count">×{w.count}</span>}
        </span>
        {w.gloss && <span className="cf-ep-gloss">{w.gloss}</span>}
        {w.note && <span className="cf-ep-note">{w.note}</span>}
      </button>
    </li>
  );
}

/** Each word with the punctuation after it, so a line never starts on a stray 。 (a button breaks like a picture, not like text). */
function glued(tokens: TextToken[]): TextToken[][] {
  const runs: TextToken[][] = [];
  for (const t of tokens) {
    if (!t.k && runs.length && !/[\p{Script=Han}A-Za-z0-9]/u.test(t.t)) runs[runs.length - 1].push(t);
    else runs.push([t]);
  }
  return runs;
}

/**
 * How hard a line is to read, from its words: clear (every word known),
 * learning (known, some still being learnt), one new word, or two and more.
 */
type Grade = "clear" | "learning" | "one" | "hard";
const GRADES: Array<{ key: Grade; label: string }> = [
  { key: "clear", label: "Clear" },
  { key: "learning", label: "Learning" },
  { key: "one", label: "1 new" },
  { key: "hard", label: "2+ new" },
];

function gradeOf(tokens: TextToken[]): Grade {
  const unknown = tokens.filter((t) => t.k === "unknown").length;
  if (unknown >= 2) return "hard";
  if (unknown === 1) return "one";
  return tokens.some((t) => t.k === "learning") ? "learning" : "clear";
}

const KIND_LABEL: Record<LineNoteKind, string> = {
  trouble: "Your trouble",
  slang: "Slang",
  grammar: "Grammar",
  culture: "Culture",
  meaning: "Meaning",
  listening: "Listening",
};

const TROUBLE_LABEL: Record<EpisodeTrouble["kind"], string> = {
  mixed: "Mixed up",
  produce: "Can't produce",
  context: "Breaks in context",
  slipping: "Slipping",
  stuck: "Won't stick",
  leech: "Leech",
  forgot: "Forgot lately",
  note: "You wrote about it",
};

/** A line's words with the quoted run of Muse's note marked, trouble words underlined; a tap on a word picks it. */
function LineText({
  line,
  note,
  trouble,
  must,
  focus,
  onWord,
}: {
  line: Episode["lines"][number];
  note: EpisodeLineNote | undefined;
  trouble: Record<string, EpisodeTrouble>;
  must: Set<string>;
  focus?: string | null;
  onWord: (w: string) => void;
}) {
  // Where the note's quote sits in the line, by characters; a token overlapping it is marked.
  const qFrom = note ? (note.quote ? line.zh.indexOf(note.quote) : 0) : -1;
  const qTo = note ? (note.quote ? qFrom + note.quote.length : line.zh.length) : -1;
  let at = 0;
  return (
    <span className="cf-zh">
      {glued(line.tokens).map((run, j) => (
        <span key={j} className="cf-ep-run">
          {run.map((t, k) => {
            const from = line.zh.indexOf(t.t, at);
            if (from >= 0) at = from + t.t.length;
            const quoted = qFrom >= 0 && from >= 0 && from < qTo && from + t.t.length > qFrom ? " is-quoted" : "";
            if (!t.k) return <span key={k} className={quoted.trim()}>{t.t}</span>;
            const cls = `cf-an-w is-${t.k}${must.has(t.t) ? " is-must" : ""}${trouble[t.t] ? " is-trouble" : ""}${focus === t.t ? " is-picked" : ""}${quoted}`;
            return (
              <button
                key={k}
                className={cls}
                onClick={(e) => {
                  e.stopPropagation();
                  onWord(t.t);
                }}
              >
                {t.t}
              </button>
            );
          })}
        </span>
      ))}
    </span>
  );
}

const strength = (days: number) => (days < 1 ? "under a day" : days < 60 ? `${Math.round(days)} days` : `${Math.round(days / 30)} months`);
const dueIn = (at: number) => {
  const d = Math.round((at - Date.now()) / 86_400_000);
  return d <= 0 ? "due now" : d === 1 ? "due tomorrow" : `due in ${d} days`;
};

/** One word of the selected line, as it lives in the corpus; opened, everything the corpus has on it. */
function CorpusWord({ w, trouble, open, onToggle }: { w: LineWordInfo; trouble: EpisodeTrouble | undefined; open: boolean; onToggle: () => void }) {
  const state =
    w.standing === "unknown"
      ? { cls: "new", label: w.status === "listed" ? "On a list" : "New" }
      : w.parts
        ? { cls: "parts", label: "From its parts" }
        : w.standing === "learning"
          ? { cls: "learning", label: "Learning" }
          : { cls: "known", label: "Known" };
  return (
    <li className={`cf-lw${open ? " is-open" : ""}`}>
      <button className="cf-lw-head" onClick={onToggle} aria-expanded={open}>
        <span className="cf-zh">{w.word}</span>
        {w.pinyin && <span className="cf-lw-py">{displayPinyin(w.pinyin)}</span>}
        <span className={`cf-lw-state is-${trouble ? "trouble" : state.cls}`}>{trouble ? TROUBLE_LABEL[trouble.kind] : state.label}</span>
      </button>
      {w.gloss && <p className="cf-lw-gloss">{w.gloss}</p>}
      {open && (
        <div className="cf-lw-more">
          {trouble && (
            <p className="cf-lw-trouble">
              {trouble.why}
              {trouble.partner && (
                <>
                  {" "}
                  · with{" "}
                  <button className="cf-word-link cf-zh" onClick={() => wordpage.openWordPage(trouble.partner!)}>
                    {trouble.partner}
                  </button>
                </>
              )}
            </p>
          )}
          {w.parts && (
            <p className="cf-lw-line">
              Not in your deck: read as <span className="cf-zh">{w.parts.join(" + ")}</span>, which you know. It may mean more than its parts.
            </p>
          )}
          {w.cards.length > 0 && (
            <p className="cf-lw-line">
              {w.cards.map((c, i) => (
                <span key={c.kind}>
                  {i > 0 && " · "}
                  <b className={`cf-lw-kind is-${c.kind}`}>{c.kind === "read" ? "Read" : "Recall"}</b>{" "}
                  {c.suspended ? "suspended" : c.answered ? `${strength(c.stability)} strong, ${dueIn(c.due)}` : "not answered yet"}
                  {c.lapses > 0 && `, ${c.lapses} ${c.lapses === 1 ? "lapse" : "lapses"}`}
                </span>
              ))}
            </p>
          )}
          {w.hook && <p className="cf-lw-hook">{w.hook}</p>}
          {w.notes.map((n) => (
            <div key={n.id} className="cf-lw-note">
              <p>“{n.note}”</p>
              {n.answers[0] && <p className="cf-muted">{n.answers[0].partner ? <span className="cf-zh">{n.answers[0].partner}: </span> : null}{n.answers[0].difference}</p>}
            </div>
          ))}
          {w.lookups.length > 0 && (
            <p className="cf-lw-line">
              Looked up: {w.lookups.map((l) => l.query).join(" · ")}
            </p>
          )}
          <p className="cf-lw-line">
            In {fmt(w.sentences.all)} of your sentences ({fmt(w.sentences.readable)} readable) · said {fmt(w.inEpisode)}× here
          </p>
          {w.sentences.example && (
            <p className="cf-lw-example">
              <span className="cf-zh">
                <Highlighted text={w.sentences.example.zh} word={w.word} />
              </span>
              {w.sentences.example.en && <span className="cf-muted"> {w.sentences.example.en}</span>}
            </p>
          )}
          <button className="cf-link" onClick={() => wordpage.openWordPage(w.word)}>
            Word page ›
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The line picked, over the foot of the screen like a Genius annotation:
 * the line, its English, Muse's note, and every word as it lives in the
 * corpus (cards, notes, lookups, sentences), the trouble and new ones first,
 * the known ones folded into a line. ‹ › step a line, ✦ to the next note.
 */
function LinePanel({
  ep,
  i,
  focus,
  must,
  cache,
  onMove,
  onFocus,
  onClose,
}: {
  ep: Episode;
  i: number;
  focus: string | null;
  must: Set<string>;
  cache: Map<number, LineWordInfo[]>;
  onMove: (i: number) => void;
  onFocus: (w: string | null) => void;
  onClose: () => void;
}) {
  const line = ep.lines[i];
  const note = ep.notes.find((n) => n.i === i);
  const [words, setWords] = useState<LineWordInfo[] | null>(cache.get(i) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(focus);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(focus), [focus]);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
    const kept = cache.get(i);
    setError(null);
    if (kept) {
      setWords(kept);
      return;
    }
    setWords(null);
    let live = true;
    get<{ words: LineWordInfo[] }>("episodes", { id: ep.id, line: i })
      .then((r) => {
        cache.set(i, r.words);
        if (live) setWords(r.words);
      })
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [cache, ep.id, i]);
  const nextNote = ep.notes.find((n) => n.i > i) ?? ep.notes[0];
  const rank = (w: LineWordInfo) => (ep.trouble[w.word] ? 0 : must.has(w.word) ? 1 : w.standing === "unknown" ? 2 : w.standing === "learning" ? 3 : 4);
  const worth = (w: LineWordInfo) => rank(w) < 4 || !!w.parts?.length || w.notes.length > 0 || w.hook !== null || w.lookups.length > 0 || w.word === focus;
  const shown = (words ?? []).filter(worth).sort((a, b) => rank(a) - rank(b));
  const rest = (words ?? []).filter((w) => !worth(w));
  return (
    <div className="cf-lp" role="dialog" aria-label={`Line ${i + 1}`}>
      <div className="cf-lp-top">
        <button className="cf-lp-step" onClick={() => onMove(i - 1)} disabled={i === 0} aria-label="Line before">
          ‹
        </button>
        <span className="cf-lp-at">
          {clock(line.s)} · line {fmt(i + 1)}
        </span>
        <button className="cf-lp-step" onClick={() => onMove(i + 1)} disabled={i >= ep.lines.length - 1} aria-label="Line after">
          ›
        </button>
        {nextNote && nextNote.i !== i && (
          <button className="cf-lp-next" onClick={() => onMove(nextNote.i)}>
            ✦ Next note
          </button>
        )}
        <button className="cf-close cf-lp-close" onClick={onClose} aria-label="Close the line">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="cf-lp-body" ref={body}>
        <p className="cf-lp-line">
          <LineText line={line} note={note} trouble={ep.trouble} must={must} focus={focus} onWord={(w) => onFocus(w)} />
          <button className="cf-lp-say" onClick={() => say(line.zh)} aria-label="Hear the line">
            🔊
          </button>
        </p>
        {line.en && <p className="cf-lp-en">{line.en}</p>}
        {note && (
          <div className={`cf-lp-note is-${note.kind}`}>
            <p className="cf-lp-note-head">
              <span>✦ {KIND_LABEL[note.kind]}</span>
              {note.quote && <span className="cf-zh">「{note.quote}」</span>}
            </p>
            <p className="cf-lp-note-text">{note.text}</p>
          </div>
        )}
        {error && <p className="cf-error">{error}</p>}
        {!words && !error && <Loading small label="Looking in your corpus…" />}
        {words && (
          <>
            <ul className="cf-lw-list">
              {shown.map((w) => (
                <CorpusWord key={w.word} w={w} trouble={ep.trouble[w.word]} open={open === w.word} onToggle={() => setOpen(open === w.word ? null : w.word)} />
              ))}
            </ul>
            {rest.length > 0 && (
              <p className="cf-lw-rest">
                Known:{" "}
                {rest.map((w, k) => (
                  <span key={w.word}>
                    {k > 0 && " · "}
                    <button className="cf-word-link cf-zh" onClick={() => wordpage.openWordPage(w.word)}>
                      {w.word}
                    </button>
                  </span>
                ))}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The chapters across the top: the bar to scrub, and a chip each (start, title, how its lines grade), the one in view lit. */
function ChapterStrip({
  ep,
  current,
  at,
  grades,
  english,
  onPick,
  onScrub,
  onScrubEnd,
}: {
  ep: Episode;
  current: number;
  at: number;
  grades: Grade[];
  english: boolean;
  onPick: (i: number) => void;
  onScrub: (t: number) => void;
  onScrubEnd?: (t: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const times = spans(ep);
  useEffect(() => {
    const el = strip.current?.children[current] as HTMLElement | undefined;
    if (!el || !strip.current) return;
    strip.current.scrollTo({ left: el.offsetLeft - (strip.current.clientWidth - el.clientWidth) / 2, behavior: "smooth" });
  }, [current]);
  return (
    <div className="cf-watch-chapters">
      <ChapterBar ep={ep} current={current} at={at} onScrub={onScrub} onScrubEnd={onScrubEnd} onPick={onPick} compact />
      <div className="cf-wchips" ref={strip}>
        {ep.scenes.map((sc, i) => {
          const part = grades.slice(sc.start, sc.end);
          return (
            <button key={i} className={`cf-wchip${i === current ? " is-on" : ""}`} onClick={() => onPick(i)}>
              <span className="cf-wchip-at">{clock(times[i].from)}</span>
              <span className="cf-wchip-title cf-zh">{sc.title}</span>
              {english && sc.titleEn && sc.titleEn !== sc.title && <span className="cf-wchip-en">{sc.titleEn}</span>}
              <span className="cf-wchip-grades" aria-label={`${pct(sc.known)} known`}>
                {GRADES.map((g) => {
                  const n = part.filter((x) => x === g.key).length;
                  return n ? <i key={g.key} className={`is-${g.key}`} style={{ flexGrow: n }} /> : null;
                })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** How the episode's lines grade, as one bar with the share of each. */
function GradeBar({ grades }: { grades: Grade[] }) {
  return (
    <div className="cf-ep-grades">
      <div className="cf-ep-grades-bar" aria-hidden="true">
        {GRADES.map((g) => {
          const n = grades.filter((x) => x === g.key).length;
          return n ? <i key={g.key} className={`is-${g.key}`} style={{ flexGrow: n }} /> : null;
        })}
      </div>
      <p className="cf-ep-grades-key">
        {GRADES.map((g) => (
          <span key={g.key}>
            <i className={`is-${g.key}`} aria-hidden="true" />
            {g.label} <b>{pct(grades.filter((x) => x === g.key).length / Math.max(1, grades.length))}</b>
          </span>
        ))}
      </p>
    </div>
  );
}

/** A practice line Again comes back this many cards later in the round. */
const AGAIN_AFTER = 3;

const WHY_LABEL: Record<EpisodeCard["why"][number], string> = { must: "Must-know", trouble: "Your trouble", note: "Muse's note" };

/**
 * Practice (the owner: "a lot of sentences to get through… only do the
 * tough ones"): the lines the server picked, one card each. The line is
 * heard first (the phone's voice), as it will be when watching; Show gives
 * the Chinese with its words marked, the English, the words it was picked
 * for and Muse's note. Again brings it back a few cards later; Got it is
 * kept. Nothing touches a schedule.
 */
function Listening({ ep, onAnswered, onBack }: { ep: Episode; onAnswered: (i: number, result: "got" | "again") => void; onBack: () => void }) {
  const left = ep.deck.filter((c) => c.result !== "got");
  const [round, setRound] = useState<number[] | null>(null);
  const [shown, setShown] = useState(false);
  const [missed, setMissed] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const must = useMemo(() => new Set(ep.deck.flatMap((c) => c.words)), [ep]);
  const noteAt = useMemo(() => new Map(ep.notes.map((n) => [n.i, n])), [ep]);

  const start = (lines: number[]) => {
    setRound(lines);
    setShown(false);
    setMissed(new Set());
    if (lines.length) say(ep.lines[lines[0]].zh);
  };
  const answer = (result: "got" | "again") => {
    if (!round) return;
    const [i, ...rest] = round;
    send("episodes", { id: ep.id, card: i, result }).catch((e) => setError(message(e)));
    onAnswered(i, result);
    const next = result === "again" ? [...rest.slice(0, AGAIN_AFTER), i, ...rest.slice(AGAIN_AFTER)] : rest;
    if (result === "again") setMissed((m) => new Set(m).add(i));
    setRound(next);
    setShown(false);
    if (next.length) say(ep.lines[next[0]].zh);
  };

  if (!ep.deck.length)
    return (
      <div className="cf-watch-pane">
        <button className="cf-link cf-pr-back-link" onClick={onBack}>
          ‹ Practice
        </button>
        <p className="cf-muted">No lines to listen through yet: once Muse marks the must-knows, or you have trouble words in it, their lines show up here.</p>
      </div>
    );

  if (!round || !round.length) {
    const got = ep.deck.length - left.length;
    return (
      <div className="cf-watch-pane cf-pr-home">
        <button className="cf-link cf-pr-back-link" onClick={onBack}>
          ‹ Practice
        </button>
        <p className="cf-ep-big">
          {fmt(ep.deck.length)}
          <small> lines of {fmt(ep.lines.length)} to practise</small>
        </p>
        <p className="cf-muted">One or two of the easiest lines for each must-know and trouble word, and the lines Muse wrote a note on. Hear each, then read it.</p>
        <div className="cf-ep-meter" aria-hidden="true">
          <span className="is-known" style={{ width: pct(got / ep.deck.length) }} />
        </div>
        <p className="cf-muted cf-ep-figs">
          {fmt(got)} got · {fmt(ep.deck.filter((c) => c.result === "again").length)} to go over again · {fmt(ep.deck.filter((c) => !c.result).length)} not tried
        </p>
        {round && <p className="cf-pr-done">Round done{missed.size ? `: ${fmt(missed.size)} needed again` : ", every line got"}.</p>}
        {error && <p className="cf-error">{error}</p>}
        <div className="cf-pr-starts">
          {left.length > 0 && (
            <button className="cf-btn" onClick={() => start(left.map((c) => c.i))}>
              {got ? `Carry on · ${fmt(left.length)} left` : `Start · ${fmt(left.length)} lines`}
            </button>
          )}
          {missed.size > 0 && (
            <button className="cf-btn cf-btn-ghost" onClick={() => start([...missed])}>
              Go over the {fmt(missed.size)} again
            </button>
          )}
          {!left.length && (
            <button className="cf-btn cf-btn-ghost" onClick={() => start(ep.deck.map((c) => c.i))}>
              Go through all {fmt(ep.deck.length)} again
            </button>
          )}
        </div>
      </div>
    );
  }

  const i = round[0];
  const line = ep.lines[i];
  const card = ep.deck.find((c) => c.i === i)!;
  const note = noteAt.get(i);
  const scene = ep.scenes.find((sc) => i >= sc.start && i < sc.end);
  return (
    <div className="cf-pr">
      <p className="cf-pr-top">
        <span>{fmt(round.length)} left</span>
        <span className="cf-zh">{scene?.title}</span>
        <span>{clock(line.s)}</span>
      </p>
      <div className="cf-pr-card">
        {!shown ? (
          <div className="cf-pr-front">
            <button className="cf-pr-play" onClick={() => say(line.zh)} aria-label="Hear the line again">
              🔊
            </button>
            <p className="cf-muted">Listen. What did they say?</p>
            {card.words.length > 0 && <p className="cf-pr-for">For {card.words.length === 1 ? "a word" : `${card.words.length} words`} you&apos;re learning</p>}
          </div>
        ) : (
          <div className="cf-pr-back">
            <p className="cf-pr-line">
              <LineText line={line} note={note} trouble={ep.trouble} must={must} onWord={(w) => wordpage.openWordPage(w)} />
              <button className="cf-lp-say" onClick={() => say(line.zh)} aria-label="Hear the line">
                🔊
              </button>
            </p>
            {line.en && <p className="cf-lp-en">{line.en}</p>}
            {card.words.map((w) => {
              const look = ep.looks[w];
              const t = ep.trouble[w];
              return (
                <p key={w} className="cf-pr-word">
                  <span className="cf-zh">{w}</span> {look?.p && <b>{displayPinyin(look.p)}</b>} <span className="cf-muted">{look?.gloss}</span>
                  {t && <span className="cf-pr-trouble"> · {TROUBLE_LABEL[t.kind]}</span>}
                </p>
              );
            })}
            {note && (
              <div className={`cf-lp-note is-${note.kind}`}>
                <p className="cf-lp-note-head">
                  <span>✦ {KIND_LABEL[note.kind]}</span>
                  {note.quote && <span className="cf-zh">「{note.quote}」</span>}
                </p>
                <p className="cf-lp-note-text">{note.text}</p>
              </div>
            )}
            <p className="cf-pr-why">{card.why.map((w) => WHY_LABEL[w]).join(" · ")}</p>
          </div>
        )}
      </div>
      {error && <p className="cf-error">{error}</p>}
      <div className="cf-pr-buttons">
        {!shown ? (
          <button className="cf-btn" onClick={() => setShown(true)}>
            Show
          </button>
        ) : (
          <>
            <button className="cf-btn cf-btn-ghost" onClick={() => answer("again")}>
              Again
            </button>
            <button className="cf-btn" onClick={() => answer("got")}>
              Got it
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type YTPlayer = {
  getCurrentTime(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
};
type YTApi = { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer };

/** YouTube's IFrame player API, loaded once. */
let ytLoading: Promise<YTApi> | null = null;
function loadYouTube(): Promise<YTApi> {
  const w = window as unknown as { YT?: YTApi; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  ytLoading ??= new Promise<YTApi>((resolve, reject) => {
    const before = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      before?.();
      resolve(w.YT!);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => {
      ytLoading = null;
      reject(new Error("YouTube's player couldn't load."));
    };
    document.head.appendChild(tag);
  });
  return ytLoading;
}

/** How often the player's time is read (ms). */
const VIDEO_TICK = 250;
/** One tap of the sync buttons (ms). */
const NUDGE = 500;

/** What the script asks of the player. */
type VideoControl = { seek: (subtitleMs: number) => void; pause: () => void };

/**
 * The episode's YouTube video over the chapters (the owner: "line up the
 * subtitles with the YouTube video embedded in our app"): its time, less the
 * episode's offset, goes to the script as the subtitle clock. Play or pause,
 * the clock, Follow (the script keeps the line being said in view), Sync
 * (nudge the offset when the subtitles run early or late, kept for the
 * episode) and hide or show the picture, which keeps playing.
 */
function VideoBar({
  ep,
  canWrite,
  control,
  follow,
  onFollow,
  onTime,
}: {
  ep: Episode;
  canWrite: boolean;
  control: React.MutableRefObject<VideoControl | null>;
  follow: boolean;
  onFollow: () => void;
  onTime: (subtitleMs: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [offset, setOffset] = useState(ep.offset);
  const offsetRef = useRef(ep.offset);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [sync, setSync] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tell = useRef(onTime);
  tell.current = onTime;

  useEffect(() => {
    if (!ep.video || !host.current) return;
    let gone = false;
    let tick: ReturnType<typeof setInterval> | undefined;
    const el = document.createElement("div");
    host.current.appendChild(el);
    loadYouTube()
      .then((YT) => {
        if (gone) return;
        player.current = new YT.Player(el, {
          videoId: ep.video,
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0 },
          events: {
            // 1 playing, 2 paused, 0 ended.
            onStateChange: (e: { data: number }) => setPlaying(e.data === 1),
            onError: () => setError("YouTube won't play this video here."),
          },
        });
        control.current = {
          seek: (ms) => player.current?.seekTo(Math.max(0, (ms + offsetRef.current) / 1000), true),
          pause: () => player.current?.pauseVideo?.(),
        };
        tick = setInterval(() => {
          const p = player.current;
          if (!p?.getCurrentTime || p.getPlayerState?.() !== 1) return;
          const t = p.getCurrentTime() * 1000 - offsetRef.current;
          setNow(t);
          tell.current(t);
        }, VIDEO_TICK);
      })
      .catch((e) => setError(message(e)));
    return () => {
      gone = true;
      if (tick) clearInterval(tick);
      control.current = null;
      player.current?.destroy?.();
      player.current = null;
      el.remove();
    };
  }, [ep.video, control]);

  const nudge = (ms: number) => {
    const next = offsetRef.current + ms;
    offsetRef.current = next;
    setOffset(next);
    if (canWrite) send("episodes", { id: ep.id, offset: next }).catch((e) => setError(message(e)));
  };

  return (
    <div className={`cf-wv${hidden ? " is-hidden" : ""}`}>
      <div className="cf-wv-frame" ref={host} />
      <div className="cf-wv-bar">
        <button
          className="cf-wv-play"
          onClick={() => (playing ? player.current?.pauseVideo() : player.current?.playVideo())}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="cf-wv-clock">{clock(Math.max(0, now))}</span>
        {!follow && (
          <button className="cf-link cf-wv-follow" onClick={onFollow}>
            ↓ Follow
          </button>
        )}
        <span className="cf-wv-gap" />
        <button className={`cf-link${sync ? " is-on" : ""}`} onClick={() => setSync(!sync)} aria-expanded={sync}>
          Sync
        </button>
        <button className="cf-link" onClick={() => setHidden(!hidden)}>
          {hidden ? "Show video" : "Hide"}
        </button>
      </div>
      {sync && (
        <div className="cf-wv-sync">
          <span>Subtitles {offset === 0 ? "on time" : `${Math.abs(offset / 1000).toFixed(1)} s ${offset > 0 ? "later" : "earlier"}`}</span>
          <button className="cf-link" onClick={() => nudge(-NUDGE)} aria-label="Subtitles half a second earlier">
            − 0.5 s
          </button>
          <button className="cf-link" onClick={() => nudge(NUDGE)} aria-label="Subtitles half a second later">
            + 0.5 s
          </button>
        </div>
      )}
      {error && <p className="cf-error cf-wv-error">{error}</p>}
    </div>
  );
}

/** For the owner, on an episode with no video yet: its YouTube link, to watch with the script following. */
function AddVideo({ ep, onAdded }: { ep: Episode; onAdded: (video: string) => void }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <button className="cf-link cf-wv-add" onClick={() => setOpen(true)}>
        ▶ Add the YouTube video
      </button>
    );
  return (
    <form
      className="cf-wv-addform"
      onSubmit={(e) => {
        e.preventDefault();
        send<{ video: string | null }>("episodes", { id: ep.id, video: link })
          .then((r) => r.video && onAdded(r.video))
          .catch((x) => setError(message(x)));
      }}
    >
      <input type="url" inputMode="url" placeholder="youtube.com/watch?v=…" value={link} onChange={(e) => setLink(e.target.value)} aria-label="YouTube link" />
      <button className="cf-btn" type="submit" disabled={!link.trim()}>
        Add
      </button>
      {error && <p className="cf-error">{error}</p>}
    </form>
  );
}

/** A line with one word marked, or blanked. */
function MarkedLine({ zh, word, blank = false }: { zh: string; word: string; blank?: boolean }) {
  const parts = zh.split(word);
  return (
    <span className="cf-zh">
      {parts.map((p, k) => (
        <span key={k}>
          {p}
          {k < parts.length - 1 && (blank ? <span className="cf-pp-blank">＿＿</span> : <mark className="cf-pp-mark">{word}</mark>)}
        </span>
      ))}
    </span>
  );
}

/**
 * Practice (the owner: practice has to move readiness, but "I don't need to
 * be 100%… I'm worried about having words in my deck that I'll never see
 * again after the show"): the server's plan for the next round, at most
 * PREP_MAX words ranked by what each does for the episode, split into worth
 * keeping (into the deck once learnt) and for the show only (learnt here,
 * never in the deck), with readiness now and after; then a short drill; and
 * listening through the trouble lines as before.
 */
function Practice({ ep, onAnswered, onLearnt }: { ep: Episode; onAnswered: (i: number, result: "got" | "again") => void; onLearnt: () => void }) {
  const [mode, setMode] = useState<"home" | "drill" | "listen">("home");
  const [last, setLast] = useState<{ kept: number; show: number; before: Episode["plan"]["now"] } | null>(null);
  if (mode === "listen") return <Listening ep={ep} onAnswered={onAnswered} onBack={() => setMode("home")} />;
  const plan = ep.plan;
  const words = [...plan.keep, ...plan.show];
  if (mode === "drill")
    return (
      <PrepDrill
        ep={ep}
        words={words}
        onEnd={(kept, show) => {
          setLast(kept + show ? { kept, show, before: plan.now } : null);
          setMode("home");
          if (kept + show) onLearnt();
        }}
      />
    );
  const listenLeft = ep.deck.filter((c) => c.result !== "got").length;
  return (
    <div className="cf-watch-pane cf-pp">
      {last && (
        <p className="cf-pp-done">
          Learnt {fmt(last.kept + last.show)}
          {last.kept ? ` · ${fmt(last.kept)} into your deck` : ""}
          {last.show ? ` · ${fmt(last.show)} for the show` : ""}. Readiness {pct(last.before.known)} → <b>{pct(plan.now.known)}</b>
        </p>
      )}
      {words.length ? (
        <>
          <p className="cf-pp-forecast">
            <span className="cf-ep-big">
              {pct(plan.now.known)} <small>→</small> {pct(plan.after.known)}
            </span>
            <small className="cf-muted">
              words known with these {fmt(words.length)} · lines readable {pct(plan.now.lines)} → {pct(plan.after.lines)}
            </small>
          </p>
          <button className="cf-btn cf-pp-start" onClick={() => setMode("drill")}>
            Learn these {fmt(words.length)}
          </button>
          {plan.keep.length > 0 && (
            <PlanList title="Worth keeping" sub="They join your deck and come back in reviews." words={plan.keep} />
          )}
          {plan.show.length > 0 && <PlanList title="Just for this show" sub="Learnt here, never in your deck." words={plan.show} />}
        </>
      ) : (
        <p className="cf-muted">Nothing left worth learning for this one: you&apos;re ready to watch.</p>
      )}
      {plan.skip.length > 0 && (
        <details className="cf-pp-skip">
          <summary>
            Skip these <span>{fmt(plan.skip.length)}</span>
          </summary>
          <p className="cf-muted">Said too rarely, or Muse marked them skip: not worth it to follow the show.</p>
          <p className="cf-pp-chips">
            {plan.skip.map((w) => (
              <button key={w.word} className="cf-pp-chip cf-zh" onClick={() => wordpage.openWordPage(w.word)}>
                {w.word} <small>×{w.count}</small>
              </button>
            ))}
          </p>
        </details>
      )}
      {plan.prepped.length > 0 && (
        <section className="cf-pp-prepped">
          <h3>
            Prepped for this show <span>{fmt(plan.prepped.length)}</span>
          </h3>
          <p className="cf-pp-chips">
            {plan.prepped.map((w) => (
              <span key={w} className="cf-pp-chip is-prepped cf-zh">
                {w}
              </span>
            ))}
          </p>
        </section>
      )}
      {ep.deck.length > 0 && (
        <button className="cf-stuck cf-pp-listen" onClick={() => setMode("listen")}>
          <span className="cf-stuck-text">
            <b>Listen through the trouble lines</b>
            <small>
              {fmt(ep.deck.length)} lines · hear each, then read it{listenLeft < ep.deck.length ? ` · ${fmt(listenLeft)} left` : ""}
            </small>
          </span>
          <i aria-hidden="true">›</i>
        </button>
      )}
    </div>
  );
}

function PlanList({ title, sub, words }: { title: string; sub: string; words: Episode["plan"]["keep"] }) {
  return (
    <section className="cf-pp-list">
      <h3>
        {title} <span>{fmt(words.length)}</span>
      </h3>
      <p className="cf-muted">{sub}</p>
      <ul className="cf-stuck-list">
        {words.map((w) => (
          <li key={w.word}>
            <button onClick={() => wordpage.openWordPage(w.word)}>
              <span className="cf-stuck-zh cf-zh">{w.word}</span>
              <span className="cf-stuck-body">
                {w.pinyin && <span className="cf-stuck-py">{displayPinyin(w.pinyin)}</span>}
                {w.gloss && <span className="cf-stuck-gloss">{w.gloss}</span>}
                <span className="cf-stuck-why cf-pp-why">
                  said {fmt(w.count)}×{w.unlocks ? ` · opens ${fmt(w.unlocks)} ${w.unlocks === 1 ? "line" : "lines"}` : ""}
                  {w.keepWhy ? ` · ${w.keepWhy}` : ""}
                  {w.must ? " · Muse: must-know" : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A word's three steps in the drill: meet it, read it in a line, recall it from the line's sense. */
type PrepStep = { w: Episode["plan"]["keep"][number]; step: 0 | 1 | 2 };
const PREP_BACK = 3;

/**
 * The round's words, three steps each, from the episode's own lines: meet
 * it (reading, meaning, Muse's note, a line with it and the English), what
 * it means in another line, then the line with it blanked and its English,
 * to recall it. A miss comes back PREP_BACK cards later at the same step.
 * Each word done is sent at once: into the deck when worth keeping, else
 * prepped for the show.
 */
function PrepDrill({ ep, words, onEnd }: { ep: Episode; words: Episode["plan"]["keep"]; onEnd: (kept: number, show: number) => void }) {
  const [queue, setQueue] = useState<PrepStep[]>(() => words.map((w) => ({ w, step: 0 as const })));
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState({ kept: 0, show: 0 });
  const [error, setError] = useState<string | null>(null);
  const card = queue[0];
  const lineOf = (w: PrepStep["w"], k: number) => ep.lines[w.lines[Math.min(k, w.lines.length - 1)] ?? -1] ?? null;
  const finish = (w: PrepStep["w"]) => {
    const keep = !!w.keepWhy;
    setDone((d) => (keep ? { ...d, kept: d.kept + 1 } : { ...d, show: d.show + 1 }));
    send("episodes", { id: ep.id, learnt: w.word, keep, day: studyDay() }).catch((e) => setError(message(e)));
  };
  const next = (passed: boolean) => {
    const [c, ...rest] = queue;
    let q = rest;
    if (passed && c.step === 2) finish(c.w);
    else {
      const again: PrepStep = passed ? { w: c.w, step: (c.step + 1) as 1 | 2 } : c;
      const at = Math.min(PREP_BACK, q.length);
      q = [...q.slice(0, at), again, ...q.slice(at)];
    }
    setQueue(q);
    setShown(false);
  };
  if (!card)
    return (
      <div className="cf-watch-pane cf-pr-home">
        <p className="cf-ep-big">
          {fmt(done.kept + done.show)} <small>learnt</small>
        </p>
        <p className="cf-muted">
          {done.kept ? `${fmt(done.kept)} went into your deck: their first review is tomorrow. ` : ""}
          {done.show ? `${fmt(done.show)} are prepped for this show only.` : ""}
        </p>
        {error && <p className="cf-error">{error}</p>}
        <div className="cf-pr-starts">
          <button className="cf-btn" onClick={() => onEnd(done.kept, done.show)}>
            See how ready you are
          </button>
        </div>
      </div>
    );
  const w = card.w;
  const line = lineOf(w, card.step === 0 ? 0 : card.step === 1 ? 1 : 2);
  const total = words.length * 3;
  const left = queue.reduce((n, c) => n + (3 - c.step), 0);
  return (
    <div className="cf-pr cf-pp-drill">
      <div className="cf-pp-progress" aria-hidden="true">
        <span style={{ width: pct(1 - left / Math.max(1, total)) }} />
      </div>
      <p className="cf-pr-top">
        <button className="cf-link" onClick={() => onEnd(done.kept, done.show)}>
          Stop
        </button>
        <span>{["New word", "In a line", "Recall it"][card.step]}</span>
        <span className={`cf-pp-kind${w.keepWhy ? " is-keep" : ""}`}>{w.keepWhy ? "Worth keeping" : "Just for this show"}</span>
      </p>
      <div className="cf-pr-card">
        {card.step === 0 && (
          <div className="cf-pp-meet">
            <p className="cf-pp-word cf-zh">{w.word}</p>
            {w.pinyin && <p className="cf-pp-py">{displayPinyin(w.pinyin)}</p>}
            {w.gloss && <p className="cf-pp-gloss">{w.gloss}</p>}
            {w.note && <p className="cf-pp-note">✦ {w.note}</p>}
            {line && (
              <div className="cf-pp-line">
                <p>
                  <MarkedLine zh={line.zh} word={w.word} />
                  <button className="cf-lp-say" onClick={() => say(line.zh)} aria-label="Hear the line">
                    🔊
                  </button>
                </p>
                {line.en && <p className="cf-lp-en">{line.en}</p>}
              </div>
            )}
          </div>
        )}
        {card.step === 1 && line && (
          <div className="cf-pp-meet">
            <p className="cf-muted">What does it mean here?</p>
            <p className="cf-pp-big-line">
              <MarkedLine zh={line.zh} word={w.word} />
              <button className="cf-lp-say" onClick={() => say(line.zh)} aria-label="Hear the line">
                🔊
              </button>
            </p>
            {shown && (
              <>
                <p className="cf-pp-py">
                  <span className="cf-zh">{w.word}</span> {w.pinyin && displayPinyin(w.pinyin)}
                </p>
                {w.gloss && <p className="cf-pp-gloss">{w.gloss}</p>}
                {line.en && <p className="cf-lp-en">{line.en}</p>}
              </>
            )}
          </div>
        )}
        {card.step === 2 && line && (
          <div className="cf-pp-meet">
            <p className="cf-muted">Which word goes in the gap?</p>
            <p className="cf-pp-big-line">
              <MarkedLine zh={line.zh} word={w.word} blank={!shown} />
            </p>
            {line.en ? <p className="cf-lp-en">{line.en}</p> : w.gloss && <p className="cf-pp-gloss">{w.gloss}</p>}
            {shown && (
              <p className="cf-pp-py">
                <span className="cf-zh">{w.word}</span> {w.pinyin && displayPinyin(w.pinyin)}
              </p>
            )}
          </div>
        )}
      </div>
      {error && <p className="cf-error">{error}</p>}
      <div className="cf-pr-buttons">
        {card.step === 0 ? (
          <button className="cf-btn" onClick={() => next(true)}>
            Next
          </button>
        ) : !shown ? (
          <button
            className="cf-btn"
            onClick={() => {
              setShown(true);
              if (line && card.step === 2) say(line.zh);
            }}
          >
            Show
          </button>
        ) : (
          <>
            <button className="cf-btn cf-btn-ghost" onClick={() => next(false)}>
              Not yet
            </button>
            <button className="cf-btn" onClick={() => next(true)}>
              Got it
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type Tab = "script" | "practice" | "words" | "after";

/**
 * An episode as one screen, like an app: a bar on top (close, the episode,
 * how ready), tabs (Script, Words, After), and in Script the chapters fixed
 * across the top over the whole script, which scrolls under them, the
 * chapter in view lit. Each line is graded by its words (a bar down its
 * left), Muse's notes marked like Genius annotations, trouble words
 * underlined; a tap opens the line at the foot of the screen with all the
 * corpus has on its words.
 */
export function EpisodeView({ id, canWrite, onEnd }: { id: number; canWrite: boolean; onEnd: () => void }) {
  const [ep, setEp] = useState<Episode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("script");
  const [scene, setScene] = useState(0);
  const [line, setLine] = useState<{ i: number; word: string | null } | null>(null);
  const [nice, setNice] = useState(false);
  const script = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<number, LineWordInfo[]>());
  // The video, when the episode has one: the line being said, and whether the script follows it.
  const video = useRef<VideoControl | null>(null);
  const [saying, setSaying] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  followRef.current = follow;
  // English under each line, or blurred until tapped; remembered on the device.
  const [english, setEnglishState] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(ENGLISH_KEY) === "off") setEnglishState(false);
    } catch {
      // No storage: English stays on.
    }
  }, []);
  const setEnglish = (on: boolean) => {
    setEnglishState(on);
    try {
      localStorage.setItem(ENGLISH_KEY, on ? "on" : "off");
    } catch {
      // Not remembered.
    }
  };

  useEffect(() => {
    get<{ episode: Episode }>("episodes", { id })
      .then((r) => setEp(r.episode))
      .catch((e) => setError(message(e)));
  }, [id]);
  useBackLayer(line !== null, () => setLine(null));
  // Opening a line to study it pauses the video.
  useEffect(() => {
    if (line) video.current?.pause();
  }, [line]);

  const must = useMemo(() => new Set((ep?.words ?? []).filter((w) => w.tier === "must" && !w.inDeck).map((w) => w.word)), [ep]);
  const grades = useMemo(() => (ep ? ep.lines.map((l) => gradeOf(l.tokens)) : []), [ep]);
  const noteAt = useMemo(() => new Map((ep?.notes ?? []).map((n) => [n.i, n])), [ep]);

  // Where the script is on the clock: the first line at the top of it, for the bar's playhead.
  const [topAt, setTopAt] = useState(0);
  // While a chip's smooth scroll runs, the chapters it passes aren't lit one by one.
  const gliding = useRef(0);
  // The chapter in view: the last whose heading is above the top of the script.
  const onScroll = () => {
    const box = script.current;
    if (!box || !ep) return;
    const rows = box.querySelectorAll<HTMLElement>("[data-line]");
    const edge = box.getBoundingClientRect().top + 12;
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].getBoundingClientRect().bottom <= edge) lo = mid + 1;
      else hi = mid;
    }
    const top = Number(rows[lo]?.dataset.line ?? 0);
    setTopAt(ep.lines[top]?.s ?? 0);
    if (Date.now() < gliding.current) return;
    const heads = box.querySelectorAll<HTMLElement>("[data-ch]");
    let now = 0;
    heads.forEach((h, k) => {
      if (h.getBoundingClientRect().top <= edge) now = k;
    });
    if (now !== scene) setScene(now);
  };
  const toChapter = (i: number) => {
    setScene(i);
    if (ep && video.current) seek(spans(ep)[i].from);
    const head = script.current?.querySelector<HTMLElement>(`[data-ch="${i}"]`);
    if (!head) return;
    gliding.current = Date.now() + 900;
    script.current!.scrollTo({ top: topIn(script.current!, head), behavior: "smooth" });
  };
  // Scrubbing: straight to the line said at that time, no animation to fight the finger.
  const scrubTo = (t: number) => {
    if (!ep || !ep.lines.length) return;
    scrubbing.current = Date.now() + 600;
    const i = lineAt(ep, t);
    const box = script.current;
    const row = box?.querySelector<HTMLElement>(`[data-line="${i}"]`);
    if (!box || !row) return;
    gliding.current = 0;
    // The chapter's heading stays in view when the line is its first.
    const head = ep.scenes.findIndex((sc) => sc.start === i);
    const target = head >= 0 ? box.querySelector<HTMLElement>(`[data-ch="${head}"]`) : null;
    box.scrollTop = Math.max(0, topIn(box, target ?? row) - (target ? 0 : 8));
  };
  // The video's clock, as subtitle time: light the line being said and, while following, keep it in view.
  const sayingRef = useRef<number | null>(null);
  // While the bar is being scrubbed, the video's clock doesn't move the script.
  const scrubbing = useRef(0);
  const onVideoTime = (t: number) => {
    if (!ep?.lines.length || Date.now() < scrubbing.current) return;
    const i = lineAt(ep, t);
    if (t < ep.lines[i].s - 300 || i === sayingRef.current) return;
    sayingRef.current = i;
    setSaying(i);
    if (!followRef.current) return;
    const box = script.current;
    const row = box?.querySelector<HTMLElement>(`[data-line="${i}"]`);
    if (!box || !row) return;
    gliding.current = 0;
    box.scrollTo({ top: Math.max(0, topIn(box, row) - box.clientHeight / 3), behavior: "smooth" });
  };
  const followAgain = () => {
    followRef.current = true;
    setFollow(true);
    const i = sayingRef.current;
    sayingRef.current = null;
    if (i !== null && ep) onVideoTime(ep.lines[i].s);
  };
  // Scrolling by hand stops following, until Follow is tapped.
  const handScroll = () => {
    if (ep?.video && followRef.current) setFollow(false);
  };
  const seek = (ms: number) => {
    if (!video.current) return;
    video.current.seek(ms);
    followRef.current = true;
    setFollow(true);
    scrubbing.current = 0;
    sayingRef.current = null;
    onVideoTime(ms);
  };
  const toLine = (i: number) => {
    if (!ep || i < 0 || i >= ep.lines.length) return;
    setLine({ i, word: null });
    const row = script.current?.querySelector<HTMLElement>(`[data-line="${i}"]`);
    if (row && script.current) script.current.scrollTo({ top: Math.max(0, topIn(script.current, row) - 80), behavior: "smooth" });
  };

  const mustWords = ep?.words.filter((w) => w.tier === "must") ?? [];
  const niceWords = ep?.words.filter((w) => w.tier === "nice") ?? [];
  const times = ep ? spans(ep) : [];
  return (
    <div className="cf-watch">
      <div className="cf-watch-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the list">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-watch-title">
          {ep ? (
            <>
              <b className="cf-zh">{ep.show}</b> {ep.episode}
            </>
          ) : (
            "Watch"
          )}
        </p>
        {ep && (
          <button className="cf-watch-ready" onClick={() => setTab("words")}>
            {pct(ep.coverage.known)} <small>known</small>
          </button>
        )}
      </div>
      {ep && (
        <div className="cf-watch-tabs" role="tablist">
          {(
            [
              ["script", "Script"],
              ["practice", `Practice${ep.plan.keep.length + ep.plan.show.length ? ` · ${ep.plan.keep.length + ep.plan.show.length}` : ""}`],
              ["words", "Words"],
              ["after", "After"],
            ] as Array<[Tab, string]>
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "is-on" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="cf-watch-pane">
          <p className="cf-error">{error}</p>
          <p className="cf-muted">Only Benji can open these: the subtitles aren&apos;t ours to show.</p>
        </div>
      )}
      {!ep && !error && <Loading label="Reading the subtitles…" />}
      {ep && tab === "script" && (
        <>
          {ep.video ? (
            <VideoBar ep={ep} canWrite={canWrite} control={video} follow={follow} onFollow={followAgain} onTime={onVideoTime} />
          ) : (
            canWrite && <AddVideo ep={ep} onAdded={(v) => setEp((e) => (e ? { ...e, video: v } : e))} />
          )}
          <ChapterStrip
            ep={ep}
            current={scene}
            at={topAt}
            grades={grades}
            english={english}
            onPick={toChapter}
            onScrub={scrubTo}
            onScrubEnd={(t) => seek(t)}
          />
          <div className="cf-watch-script" ref={script} onScroll={onScroll} onTouchMove={handScroll} onWheel={handScroll}>
            <div className="cf-watch-key">
              {GRADES.map((g) => (
                <span key={g.key}>
                  <i className={`is-${g.key}`} aria-hidden="true" />
                  {g.label}
                </span>
              ))}
              <span>
                <b className="cf-gn-key">✦</b> Muse
              </span>
              {ep.lines.some((l) => l.en) && (
                <button className={`cf-ep-entoggle${english ? " is-on" : ""}`} onClick={() => setEnglish(!english)} aria-pressed={english}>
                  English
                </button>
              )}
            </div>
            {ep.scenes.map((sc, c) => (
              <section key={c} className="cf-watch-ch" data-ch={c}>
                <SceneHead sc={sc} n={c} from={times[c].from} english={english} />
                <ol className="cf-watch-lines">
                  {ep.lines.slice(sc.start, sc.end).map((l, k) => {
                    const i = sc.start + k;
                    const note = noteAt.get(i);
                    return (
                      <li
                        key={i}
                        data-line={i}
                        className={`cf-wl is-${grades[i]}${line?.i === i ? " is-on" : ""}${note ? " has-note" : ""}${saying === i ? " is-saying" : ""}`}
                        onClick={() => setLine({ i, word: null })}
                      >
                        {ep.video ? (
                          <button
                            className="cf-wl-at cf-wl-seek"
                            onClick={(e) => {
                              e.stopPropagation();
                              seek(l.s);
                            }}
                            aria-label={`Play from ${clock(l.s)}`}
                          >
                            {clock(l.s)}
                            {note && <b className="cf-gn-key">✦</b>}
                          </button>
                        ) : (
                          <span className="cf-wl-at">
                            {clock(l.s)}
                            {note && <b className="cf-gn-key">✦</b>}
                          </span>
                        )}
                        <span className="cf-wl-text">
                          <LineText line={l} note={note} trouble={ep.trouble} must={must} onWord={(w) => setLine({ i, word: w })} />
                          {l.en && <EnglishLine en={l.en} english={english} />}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        </>
      )}
      {ep && tab === "practice" && (
        <Practice
          ep={ep}
          onAnswered={(i, result) =>
            setEp((e) => (e ? { ...e, deck: e.deck.map((c) => (c.i === i ? { ...c, result, tries: c.tries + 1 } : c)) } : e))
          }
          onLearnt={() =>
            get<{ episode: Episode }>("episodes", { id })
              .then((r) => setEp(r.episode))
              .catch((e) => setError(message(e)))
          }
        />
      )}
      {ep && tab === "words" && (
        <div className="cf-watch-pane">
          {!ep.model && <p className="cf-read-note">Muse hasn&apos;t prepped this one yet: the words are by how often they&apos;re said, and the chapters are cut at the pauses.</p>}
          <Readiness ep={ep} />
          <h2 className="cf-kits-h">How the lines read</h2>
          <GradeBar grades={grades} />
          {mustWords.length > 0 && (
            <section className="cf-ep-words">
              <h2 className="cf-kits-h">
                Learn before watching <span>{fmt(mustWords.length)}</span>
              </h2>
              <ul>
                {mustWords.map((w) => (
                  <WordRow key={w.word} w={w} />
                ))}
              </ul>
              {ep.list && (
                <a className="cf-btn cf-ep-list" href={`/chongfuxi?tab=cards&cards=lists&list=${encodeURIComponent(ep.list)}`}>
                  Learn and review them as a list
                </a>
              )}
            </section>
          )}
          {ep.names.length > 0 && (
            <p className="cf-muted cf-ep-names">
              Names: <span className="cf-zh">{ep.names.join("、")}</span>
            </p>
          )}
          {niceWords.length > 0 && (
            <section className="cf-ep-words">
              <button className="cf-link" onClick={() => setNice(!nice)}>
                {nice ? "Hide" : "Show"} {fmt(niceWords.length)} more words not known
              </button>
              {nice && (
                <ul>
                  {niceWords.map((w) => (
                    <WordRow key={w.word} w={w} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
      {ep && tab === "after" && (
        <div className="cf-watch-pane">
          {ep.questions.length ? (
            <>
              <p className="cf-muted">Answer in Chinese, out loud or typed. Each answer is checked for the Chinese and against what happens.</p>
              {ep.questions.map((q, i) => (
                <Question
                  key={i}
                  question={q}
                  q={i}
                  initial={ep.retells.filter((t) => t.q === i)}
                  canWrite={canWrite}
                  check={(answer) => send<{ retell: Retell }>("episodes", { id: ep.id, q: i, answer }).then((x) => x.retell)}
                />
              ))}
            </>
          ) : (
            <p className="cf-muted">Muse hasn&apos;t written questions for this episode yet.</p>
          )}
        </div>
      )}
      {ep && tab === "script" && line && (
        <LinePanel
          ep={ep}
          i={line.i}
          focus={line.word}
          must={must}
          cache={cache.current}
          onMove={toLine}
          onFocus={(w) => setLine({ i: line.i, word: w })}
          onClose={() => setLine(null)}
        />
      )}
    </div>
  );
}

/** A chapter's heading in the script: when, what, and what happens (folded to two lines until tapped). */
function SceneHead({ sc, n, from, english }: { sc: Episode["scenes"][number]; n: number; from: number; english: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="cf-watch-head">
      <p className="cf-watch-head-at">
        Chapter {n + 1} · {clock(from)} · {pct(sc.known)} known
      </p>
      <h3 className="cf-zh">{sc.title}</h3>
      {english && sc.titleEn && sc.titleEn !== sc.title && <p className="cf-watch-head-en">{sc.titleEn}</p>}
      {(sc.summary || sc.notes.length > 0) && (
        <button className={`cf-watch-sum${open ? " is-open" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          {sc.summary && <span className="cf-zh">{sc.summary}</span>}
          {open && sc.summaryEn && english && <span className="cf-watch-sum-en">{sc.summaryEn}</span>}
          {open &&
            sc.notes.map((x, k) => (
              <span key={k} className="cf-watch-sum-note">
                {x}
              </span>
            ))}
        </button>
      )}
    </header>
  );
}

/** A line's English: shown, or blurred until tapped when English is off. */
function EnglishLine({ en, english }: { en: string; english: boolean }) {
  const [shown, setShown] = useState(false);
  if (english || shown) return <span className="cf-ep-en">{en}</span>;
  return (
    <button
      className="cf-ep-en is-hidden"
      onClick={(e) => {
        e.stopPropagation();
        setShown(true);
      }}
      aria-label="Show the English"
    >
      {en}
    </button>
  );
}
