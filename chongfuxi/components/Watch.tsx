"use client";

// Getting ready to watch a drama (app/api/chongfuxi/episodes.ts): an
// episode's subtitles, which Muse finds and preps, measured against the deck,
// as one screen like an app (the owner asked for it to work like Genius's
// lyrics). Script: the chapters fixed across the top (a bar to scrub, like
// YouTube's, and a chip each), the whole script scrolling under them, each
// line graded by its words, Muse's notes on lines marked, the owner's
// trouble words underlined; a tap on a line opens it at the foot with what
// the corpus has on its words. Words: how ready, over time, and the words to
// learn. (After, the whole episode's questions, was taken out at the owner's
// request; a chapter's Check still retells it.)

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EpisodeLineNote,
  EpisodeListed,
  EpisodeProgress,
  EpisodeTrouble,
  EpisodeView as Episode,
  EpisodeWord,
  LineNoteKind,
  TextToken,
} from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { studyDay } from "@chongfuxi/lib/day";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { say } from "./Drill";
import { Loading, Sheet, fmt, message, useBackLayer } from "./shared";

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

/**
 * Muse's study note on a hard line, at the top of its panel (the owner
 * wanted everything to learn the sentence in one place): what it means,
 * how it is built, its parts, one thing to take away.
 */
function BlurbCard({ b }: { b: Episode["blurbs"][number] }) {
  return (
    <section className="cf-lb">
      <p className="cf-lb-head">✦ Muse on this line</p>
      <p className="cf-lb-meaning">{b.meaning}</p>
      {b.literal && (
        <p className="cf-lb-literal">
          <span>Literally</span> {b.literal}
        </p>
      )}
      {b.parts.length > 0 && (
        <ul className="cf-lb-parts">
          {b.parts.map((p, k) => (
            <li key={k}>
              {p.zh && (
                <button className="cf-lb-zh cf-zh" onClick={() => wordpage.openWordPage(p.zh)} title="Word page">
                  {p.zh}
                </button>
              )}
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      )}
      {b.tip && (
        <p className="cf-lb-tip">
          <span>Take away</span> {b.tip}
        </p>
      )}
    </section>
  );
}

/** Who's who at the top of the script: Muse's cast, a tap for who each is (the owner: "a place for all the characters"). */
function CastList({ cast, all = false }: { cast: Episode["cast"]; all?: boolean }) {
  const [open, setOpen] = useState(all);
  if (!cast.length) return null;
  const shown = open ? cast : cast.slice(0, CAST_FOLDED);
  return (
    <section className="cf-cast">
      <p className="cf-cast-h">
        Characters <span>{fmt(cast.length)}</span>
      </p>
      <ul>
        {shown.map((c) => (
          <li key={c.name}>
            <button className="cf-cast-name cf-zh" onClick={() => say(c.name)} aria-label={`Hear ${c.name}`}>
              {c.name}
            </button>
            <span className="cf-cast-body">
              {c.pinyin && <span className="cf-cast-py">{displayPinyin(c.pinyin)}</span>}
              {c.who && <span className="cf-cast-who">{c.who}</span>}
            </span>
          </li>
        ))}
      </ul>
      {!all && cast.length > CAST_FOLDED && (
        <button className="cf-link cf-cast-more" onClick={() => setOpen(!open)}>
          {open ? "Fewer" : `All ${fmt(cast.length)}`}
        </button>
      )}
    </section>
  );
}
const CAST_FOLDED = 4;

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
  const cast = ep.cast ?? [];
  const [castOpen, setCastOpen] = useState(false);
  useEffect(() => {
    // The characters' chip, when there is one, comes before the chapters.
    const el = strip.current?.children[current + (cast.length ? 1 : 0)] as HTMLElement | undefined;
    if (!el || !strip.current) return;
    // At the first chapter the strip starts at its left, the characters in view.
    const left = current === 0 ? 0 : el.offsetLeft - (strip.current.clientWidth - el.clientWidth) / 2;
    strip.current.scrollTo({ left, behavior: "smooth" });
  }, [current]);
  return (
    <div className="cf-watch-chapters">
      <ChapterBar ep={ep} current={current} at={at} onScrub={onScrub} onScrubEnd={onScrubEnd} onPick={onPick} compact />
      <div className="cf-wchips" ref={strip}>
        {/* Who's who, before the chapters (the owner asked for it there): the full cast in a sheet. */}
        {cast.length > 0 && (
          <button className="cf-wchip cf-wchip-cast" onClick={() => setCastOpen(true)}>
            <span className="cf-wchip-at">Characters · {fmt(cast.length)}</span>
            <span className="cf-wchip-title cf-zh">{cast.slice(0, 3).map((c) => c.name).join("、")}</span>
            {cast.length > 3 && <span className="cf-wchip-en">and {fmt(cast.length - 3)} more</span>}
          </button>
        )}
        {ep.scenes.map((sc, i) => {
          const part = grades.slice(sc.start, sc.end);
          return (
            <button key={i} className={`cf-wchip${i === current ? " is-on" : ""}`} onClick={() => onPick(i)}>
              <span className="cf-wchip-at">
                {clock(times[i].from)}
                {ep.plan.chapters[i]?.done && <b className="cf-wchip-done"> ✓</b>}
              </span>
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
      {castOpen && (
        <Sheet label="Characters" onClose={() => setCastOpen(false)}>
          <CastList cast={cast} all />
        </Sheet>
      )}
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

type YTPlayer = {
  getCurrentTime(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  setPlaybackRate(rate: number): void;
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

/** Video speeds, in the order a tap steps through them: slower first, for listening. */
const SPEEDS = [1, 0.75, 0.5, 1.25];
const SPEED_KEY = "cfx-video-speed";

/** The video speed, remembered on the device, applied to the player when it is ready and whenever it changes. */
function useSpeed(player: React.MutableRefObject<YTPlayer | null>) {
  const [speed, setSpeed] = useState(1);
  const ref = useRef(1);
  ref.current = speed;
  useEffect(() => {
    try {
      const kept = Number(localStorage.getItem(SPEED_KEY));
      if (SPEEDS.includes(kept)) setSpeed(kept);
    } catch {
      // No storage: normal speed.
    }
  }, []);
  useEffect(() => {
    player.current?.setPlaybackRate?.(speed);
  }, [speed, player]);
  const next = () => {
    const to = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(to);
    try {
      localStorage.setItem(SPEED_KEY, String(to));
    } catch {
      // Not remembered.
    }
  };
  /** For the player's onReady: the speed chosen before it was made. */
  const apply = () => player.current?.setPlaybackRate?.(ref.current);
  return { speed, next, apply };
}

function SpeedButton({ speed, onNext }: { speed: number; onNext: () => void }) {
  return (
    <button className={`cf-link cf-wv-speed${speed !== 1 ? " is-on" : ""}`} onClick={onNext} aria-label={`Speed ${speed}×, tap to change`}>
      {speed}×
    </button>
  );
}

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
  const rate = useSpeed(player);
  const ready = useRef(rate.apply);
  ready.current = rate.apply;
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
            onReady: () => ready.current(),
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
        <SpeedButton speed={rate.speed} onNext={rate.next} />
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

type PlanWord = Episode["plan"]["keep"][number];
/** The owner's choice per word, into the deck or for the show only; unset follows the plan. */
type Keeps = { of: (w: PlanWord) => boolean; set: (word: string, keep: boolean) => void };

/**
 * Which words go into the deck once learnt: the plan's suggestion (worth
 * keeping) unless the owner ticked otherwise (their ask: "let me choose which
 * word I wanna keep in my deck"), remembered on the device per episode.
 */
function useKeeps(id: number): Keeps {
  const key = `cfx-ep-keep:${id}`;
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  return {
    of: (w) => chosen[w.word] ?? !!w.keepWhy,
    set: (word, keep) =>
      setChosen((c) => {
        const next = { ...c, [word]: keep };
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Without storage the choice holds until the episode is closed.
        }
        return next;
      }),
  };
}

/** A breath either side of a line's clip (ms), so its first word isn't cut and it doesn't stop mid-syllable. */
const CLIP_BEFORE = 400;
const CLIP_AFTER = 300;

/**
 * One line, heard from the episode's own video (the owner: "we don't need
 * audio there, we have the YouTube video"): the clip plays from just before
 * the line to just after it and stops, again whenever the line changes.
 * Again plays it again; "From the line before" gives it its lead-in; the
 * speed is the episode's. With no video, the phone's voice says it.
 */
function LineClip({ ep, i }: { ep: Episode; i: number }) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const rate = useSpeed(player);
  const applyRate = useRef(rate.apply);
  applyRate.current = rate.apply;
  const ready = useRef(false);
  // The span to play once the player is ready, and where to stop (video seconds).
  const pending = useRef<[number, number] | null>(null);
  const stopAt = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offset = ep.offset;
  const secs = (ms: number) => Math.max(0, (ms + offset) / 1000);
  const play = (fromMs: number, toMs: number) => {
    const p = player.current;
    if (!p || !ready.current) {
      pending.current = [fromMs, toMs];
      return;
    }
    stopAt.current = secs(toMs);
    p.seekTo(secs(fromMs), true);
    p.playVideo();
  };
  const playRef = useRef(play);
  playRef.current = play;
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
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0, controls: 0, disablekb: 1 },
          events: {
            onReady: () => {
              ready.current = true;
              applyRate.current();
              const p = pending.current;
              pending.current = null;
              if (p) playRef.current(p[0], p[1]);
            },
            onError: () => setError("YouTube won't play this video here."),
          },
        });
        // Stop at the end of the span, however it was started (the player's own play button too).
        tick = setInterval(() => {
          const p = player.current;
          if (stopAt.current === null || !p?.getCurrentTime || p.getPlayerState?.() !== 1) return;
          if (p.getCurrentTime() >= stopAt.current) {
            p.pauseVideo();
            stopAt.current = null;
          }
        }, VIDEO_TICK / 2);
      })
      .catch((e) => setError(message(e)));
    return () => {
      gone = true;
      ready.current = false;
      if (tick) clearInterval(tick);
      player.current?.destroy?.();
      player.current = null;
      el.remove();
    };
  }, [ep.video]);
  const line = ep.lines[i];
  const before = ep.lines[i - 1];
  const again = () => (ep.video ? playRef.current(line.s - CLIP_BEFORE, line.e + CLIP_AFTER) : say(line.zh));
  // Each new line plays as it comes up.
  useEffect(() => {
    const l = ep.lines[i];
    if (!l) return;
    if (ep.video) playRef.current(l.s - CLIP_BEFORE, l.e + CLIP_AFTER);
    else say(l.zh);
    // Only on a new line: an episode reloading underneath plays nothing.
  }, [i]);
  return (
    <div className="cf-clip">
      {ep.video && <div className="cf-wv-frame cf-clip-frame" ref={host} />}
      {error && <p className="cf-error">{error}</p>}
      <div className="cf-clip-bar">
        <button className="cf-link" onClick={again}>
          {ep.video ? "↺ Again" : "🔊 Hear it"}
        </button>
        {ep.video && before && (
          <button className="cf-link" onClick={() => playRef.current(before.s - CLIP_BEFORE, line.e + CLIP_AFTER)}>
            From the line before
          </button>
        )}
        <span className="cf-wv-gap" />
        {ep.video && <SpeedButton speed={rate.speed} onNext={rate.next} />}
      </div>
    </div>
  );
}

/** Muse's note on a line: its kind, the run it quotes, what to know. */
function NoteCard({ note }: { note: EpisodeLineNote }) {
  return (
    <div className={`cf-lp-note is-${note.kind}`}>
      <p className="cf-lp-note-head">
        <span>✦ {KIND_LABEL[note.kind]}</span>
        {note.quote && <span className="cf-zh">「{note.quote}」</span>}
      </p>
      <p className="cf-lp-note-text">{note.text}</p>
    </div>
  );
}

/** A line of a chapter's walk: the line, and the key words learnt at it. */
type Stop = { i: number; words: PlanWord[] };

/**
 * Where a chapter's walk stops, in story order: every line of it with
 * something to learn (the owner: "go through the chapter and all the
 * difficulties and Muse's thoughts"): Muse's study note or line note, a
 * key word (at its first line in the chapter), a word the owner has had
 * trouble with, or two or more new words.
 */
function walkStops(ep: Episode, c: number): Stop[] {
  const sc = ep.scenes[c];
  const plan = ep.plan.chapters[c];
  const inChapter = (i: number) => i >= sc.start && i < sc.end;
  const at = new Map<number, Stop>();
  const stop = (i: number) => {
    let s = at.get(i);
    if (!s) at.set(i, (s = { i, words: [] }));
    return s;
  };
  for (const w of plan?.words ?? []) {
    let i = w.lines.find(inChapter);
    if (i === undefined) for (let k = sc.start; k < sc.end && i === undefined; k++) if (ep.lines[k].zh.includes(w.word)) i = k;
    i ??= w.lines[0];
    if (i !== undefined && ep.lines[i]) stop(i).words.push(w);
  }
  for (const b of ep.blurbs ?? []) if (inChapter(b.i)) stop(b.i);
  for (const n of ep.notes) if (inChapter(n.i)) stop(n.i);
  for (let i = sc.start; i < sc.end; i++) {
    const tokens = ep.lines[i].tokens;
    if (tokens.some((t) => t.k && ep.trouble[t.t]) || gradeOf(tokens) === "hard") stop(i);
  }
  return [...at.values()].sort((a, b) => a.i - b.i);
}

/** A line with its key words blanked, to listen for. */
function BlankedLine({ zh, words }: { zh: string; words: string[] }) {
  const longest = [...words].sort((a, b) => b.length - a.length);
  const parts: Array<{ t: string; blank: boolean }> = [];
  let rest = zh;
  while (rest) {
    let hit = -1;
    let word = "";
    for (const w of longest) {
      const k = rest.indexOf(w);
      if (k >= 0 && (hit < 0 || k < hit)) [hit, word] = [k, w];
    }
    if (hit < 0) {
      parts.push({ t: rest, blank: false });
      break;
    }
    if (hit) parts.push({ t: rest.slice(0, hit), blank: false });
    parts.push({ t: word, blank: true });
    rest = rest.slice(hit + word.length);
  }
  return (
    <span className="cf-zh">
      {parts.map((p, k) => (p.blank ? <span key={k} className="cf-walk-blank">{"＿".repeat(p.t.length)}</span> : <span key={k}>{p.t}</span>))}
    </span>
  );
}

/** The plan's words (worth keeping, for the show, each chapter's key words), by word. */
function planWords(ep: Episode): Map<string, PlanWord> {
  const all = new Map<string, PlanWord>();
  for (const w of [...ep.plan.keep, ...ep.plan.show, ...ep.plan.chapters.flatMap((c) => c.words)]) if (!all.has(w.word)) all.set(w.word, w);
  return all;
}

/**
 * Every new word in a line, its key words first (the owner wanted the choice
 * to add any of them): the others have no plan behind them, so they start
 * unticked for the deck, their reading and meaning from the episode's looks.
 */
function lineWords(ep: Episode, i: number, keys: PlanWord[]): PlanWord[] {
  const extra: PlanWord[] = [];
  for (const tk of ep.lines[i].tokens) {
    const w = tk.t;
    if (tk.k !== "unknown" || ep.names.includes(w) || keys.some((k) => k.word === w) || extra.some((k) => k.word === w)) continue;
    const look = ep.looks[w];
    extra.push({ word: w, pinyin: look?.p ?? null, gloss: look?.gloss ?? null, note: null, must: false, count: 0, unlocks: 0, keepWhy: null, lines: [i] });
  }
  return [...keys, ...extra];
}

/**
 * A line laid open, like a Genius page for it: the line with its words marked
 * (a tap opens a word's page), the English blurred until tapped, its new words
 * with the Deck choice ("Add all to deck" ticks the lot), Muse's study note
 * and line note. The walk shows it at each stop, and the Script for any line.
 */
function StopCard({ ep, i, words, keeps, canWrite }: { ep: Episode; i: number; words: PlanWord[]; keeps: Keeps; canWrite: boolean }) {
  const line = ep.lines[i];
  const note = ep.notes.find((n) => n.i === i);
  const blurb = (ep.blurbs ?? []).find((b) => b.i === i);
  const must = useMemo(() => new Set(ep.words.filter((w) => w.tier === "must").map((w) => w.word)), [ep.words]);
  const untick = words.filter((w) => !keeps.of(w));
  return (
    <>
      <p className="cf-walk-line">
        <LineText line={line} note={note} trouble={ep.trouble} must={must} onWord={(w) => wordpage.openWordPage(w)} />
      </p>
      {line.en && <EnglishLine key={i} en={line.en} english={false} />}
      {words.length > 0 && (
        <div className="cf-walk-words-head">
          <span>{words.length === 1 ? "New word" : `${fmt(words.length)} new words`}</span>
          {canWrite && words.length > 1 && untick.length > 0 && (
            <button className="cf-link" onClick={() => untick.forEach((w) => keeps.set(w.word, true))}>
              Add all to deck
            </button>
          )}
        </div>
      )}
      {words.length > 0 && (
        <ul className="cf-stuck-list cf-walk-words">
          {words.map((w) => (
            <li key={w.word} className="cf-pp-row">
              <button onClick={() => wordpage.openWordPage(w.word)}>
                <span className="cf-stuck-zh cf-zh">{w.word}</span>
                <span className="cf-stuck-body">
                  {w.pinyin && <span className="cf-stuck-py">{displayPinyin(w.pinyin)}</span>}
                  {w.gloss && <span className="cf-stuck-gloss">{w.gloss}</span>}
                  {w.note && <span className="cf-stuck-why cf-pp-why">✦ {w.note}</span>}
                </span>
              </button>
              {canWrite && (
                <label className={`cf-pp-keep${keeps.of(w) ? " is-on" : ""}`}>
                  <input type="checkbox" checked={keeps.of(w)} onChange={(e) => keeps.set(w.word, e.target.checked)} aria-label={`Keep ${w.word} in your deck`} />
                  <i className="cf-tick" />
                  <small>Deck</small>
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
      {blurb && <BlurbCard b={blurb} />}
      {note && <NoteCard note={note} />}
    </>
  );
}

/** Learn words met in an episode: into the deck when ticked, else (key words only) for the show. */
function learnWords(ep: Episode, words: PlanWord[], keys: PlanWord[], keeps: Keeps, done: Set<string>): Array<Promise<{ word: string; keep: boolean }>> {
  const sent: Array<Promise<{ word: string; keep: boolean }>> = [];
  for (const w of words) {
    if (done.has(w.word)) continue;
    const keep = keeps.of(w);
    // A word that isn't a key word goes nowhere unless ticked for the deck.
    if (!keep && !keys.includes(w)) continue;
    done.add(w.word);
    sent.push(send("episodes", { id: ep.id, learnt: w.word, keep, day: studyDay() }).then(() => ({ word: w.word, keep })));
  }
  return sent;
}

/** How many stops on a missed one comes back. */
const WALK_BACK = 3;

/**
 * Walking through a chapter's hard lines one at a time, each heard from the
 * video (the owner wanted it "more immersive and conducive for learning the
 * specific items in context", and to go through every difficulty with
 * Muse's thoughts on it), started from the walk icon on the chapter's
 * heading in the Script. A stop with key words first plays with them
 * blanked, to listen for; Show lays the line open (`StopCard`). Got it
 * learns its key words (into the deck or for the show, as chosen) and the
 * others ticked for the deck; Again later brings the stop back WALK_BACK
 * stops on.
 */
function ChapterWalk({ ep, c, keeps, canWrite, onEnd }: { ep: Episode; c: number; keeps: Keeps; canWrite: boolean; onEnd: (learnt: number) => void }) {
  const [stops] = useState(() => walkStops(ep, c));
  const [queue, setQueue] = useState<number[]>(() => stops.map((_, k) => k));
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState({ kept: 0, show: 0, lines: 0 });
  const [error, setError] = useState<string | null>(null);
  const learnt = useRef(new Set<string>());
  const sc = ep.scenes[c];
  const k = queue[0];
  const top = (
    <div className="cf-over-top">
      <button className="cf-close" onClick={() => onEnd(done.kept + done.show)} aria-label="Back to the script">
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <p className="cf-over-title">
        <small>Walk · chapter {c + 1}</small>
        <b className="cf-zh">{sc.title}</b>
      </p>
    </div>
  );
  if (k === undefined)
    return (
      <div className="cf-over">
        {top}
        <div className="cf-walk cf-cr-done">
          <p className="cf-ep-big">
            ✓ <small>Walked through {fmt(done.lines)} lines</small>
          </p>
          {done.kept + done.show > 0 && (
            <p className="cf-muted">
              {done.kept ? `${fmt(done.kept)} into your deck, their first review tomorrow. ` : ""}
              {done.show ? `${fmt(done.show)} learnt for this show.` : ""}
            </p>
          )}
          {error && <p className="cf-error">{error}</p>}
          <div className="cf-pr-starts">
            <button className="cf-btn" onClick={() => onEnd(done.kept + done.show)}>
              Back to the script
            </button>
          </div>
        </div>
      </div>
    );
  const s = stops[k];
  const line = ep.lines[s.i];
  const listening = s.words.length > 0 && !shown;
  const words = lineWords(ep, s.i, s.words);
  const next = (got: boolean) => {
    const rest = queue.slice(1);
    if (got) {
      setDone((d) => ({ ...d, lines: d.lines + 1 }));
      if (canWrite)
        for (const p of learnWords(ep, words, s.words, keeps, learnt.current))
          p.then((r) => setDone((d) => (r.keep ? { ...d, kept: d.kept + 1 } : { ...d, show: d.show + 1 }))).catch((e) => setError(message(e)));
      setQueue(rest);
    } else {
      const at = Math.min(WALK_BACK, rest.length);
      setQueue([...rest.slice(0, at), k, ...rest.slice(at)]);
    }
    setShown(false);
  };
  const passed = stops.length - new Set(queue).size;
  return (
    <div className="cf-over">
      {top}
      <div className="cf-walk">
        <div className="cf-pp-progress cf-walk-progress" aria-hidden="true">
          <span style={{ width: pct(passed / Math.max(1, stops.length)) }} />
        </div>
        <p className="cf-pr-top">
          <span className="cf-walk-at">
            {fmt(Math.min(passed + 1, stops.length))} of {fmt(stops.length)} · {clock(line.s)}
          </span>
        </p>
        <LineClip ep={ep} i={s.i} />
        <div className="cf-walk-card">
          {listening ? (
            <>
              <p className="cf-muted cf-walk-ask">Listen for the missing {s.words.length === 1 ? "word" : "words"}</p>
              <p className="cf-walk-line">
                <BlankedLine zh={line.zh} words={s.words.map((w) => w.word)} />
              </p>
              {line.en && <EnglishLine key={s.i} en={line.en} english={false} />}
            </>
          ) : (
            <StopCard ep={ep} i={s.i} words={words} keeps={keeps} canWrite={canWrite} />
          )}
        </div>
        {error && <p className="cf-error">{error}</p>}
        <div className="cf-pr-buttons">
          {listening ? (
            <button className="cf-btn" onClick={() => setShown(true)}>
              Show
            </button>
          ) : (
            <>
              <button className="cf-btn cf-btn-ghost" onClick={() => next(false)}>
                Again later
              </button>
              <button className="cf-btn" onClick={() => next(true)}>
                {words.length ? "Got it" : "Next"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Any line of the script, laid open the same way as a walk's stop (the
 * owner: tapping a sentence should open "the same genius window"): its clip,
 * the line, its new words with the Deck choice and Muse's notes; ‹ › to the
 * line before or after, and the ticked words added to the deck.
 */
function LineView({ ep, i, keeps, canWrite, onMove, onAdded, onClose }: {
  ep: Episode;
  i: number;
  keeps: Keeps;
  canWrite: boolean;
  onMove: (i: number) => void;
  onAdded: () => void;
  onClose: () => void;
}) {
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = useMemo(() => planWords(ep), [ep]);
  const line = ep.lines[i];
  const keys = [...new Set(line.tokens.map((t) => t.t))].flatMap((w) => plan.get(w) ?? []);
  const words = lineWords(ep, i, keys).filter((w) => !added.has(w.word));
  const toAdd = canWrite ? words.filter((w) => keeps.of(w)) : [];
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await Promise.all(learnWords(ep, toAdd, [], keeps, new Set()));
      setAdded((a) => new Set([...a, ...done.map((d) => d.word)]));
      onAdded();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cf-over" role="dialog" aria-label={`Line ${i + 1}`}>
      <div className="cf-over-top">
        <button className="cf-close" onClick={onClose} aria-label="Back to the script">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-over-title">
          <small>
            {clock(line.s)} · line {fmt(i + 1)}
          </small>
        </p>
        <button className="cf-lp-step" onClick={() => onMove(i - 1)} disabled={i === 0} aria-label="Line before">
          ‹
        </button>
        <button className="cf-lp-step" onClick={() => onMove(i + 1)} disabled={i >= ep.lines.length - 1} aria-label="Line after">
          ›
        </button>
      </div>
      <div className="cf-walk">
        <LineClip ep={ep} i={i} />
        <div className="cf-walk-card">
          <StopCard ep={ep} i={i} words={words} keeps={keeps} canWrite={canWrite} />
          {added.size > 0 && <p className="cf-muted cf-walk-added">✓ Added {[...added].join("、")}: first review tomorrow.</p>}
        </div>
        {error && <p className="cf-error">{error}</p>}
        <div className="cf-pr-buttons">
          {toAdd.length > 0 && (
            <button className="cf-btn cf-btn-ghost" disabled={busy} onClick={() => void add()}>
              {busy ? "Adding…" : `Add ${fmt(toAdd.length)} to deck`}
            </button>
          )}
          <button className="cf-btn" onClick={() => (i < ep.lines.length - 1 ? onMove(i + 1) : onClose())}>
            {i < ep.lines.length - 1 ? "Next line ›" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}

type Tab = "script" | "words";

/**
 * An episode as one screen, like an app: a bar on top (close, the episode,
 * how ready), tabs (Script, Practice, Words; After, the whole episode's
 * questions, was taken out at the owner's request), and in Script the chapters fixed
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
  // A line laid open (LineView), or a chapter being walked (ChapterWalk), over the script.
  const [line, setLine] = useState<number | null>(null);
  const [walk, setWalk] = useState<number | null>(null);
  const [nice, setNice] = useState(false);
  const script = useRef<HTMLDivElement>(null);
  const keeps = useKeeps(id);
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
  const reload = () =>
    get<{ episode: Episode }>("episodes", { id })
      .then((r) => setEp(r.episode))
      .catch((e) => setError(message(e)));
  // Back from Words comes to the Script; from an open line or a walk, closes it.
  useBackLayer(tab !== "script", () => setTab("script"));
  useBackLayer(line !== null, () => setLine(null));
  useBackLayer(walk !== null, () => setWalk(null));
  // Opening a line or a walk pauses the video.
  useEffect(() => {
    if (line !== null || walk !== null) video.current?.pause();
  }, [line, walk]);

  const must = useMemo(() => new Set((ep?.words ?? []).filter((w) => w.tier === "must" && !w.inDeck).map((w) => w.word)), [ep]);
  const grades = useMemo(() => (ep ? ep.lines.map((l) => gradeOf(l.tokens)) : []), [ep]);
  const noteAt = useMemo(() => new Map((ep?.notes ?? []).map((n) => [n.i, n])), [ep]);
  const blurbAt = useMemo(() => new Set((ep?.blurbs ?? []).map((b) => b.i)), [ep]);

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
    setLine(i);
    const row = script.current?.querySelector<HTMLElement>(`[data-line="${i}"]`);
    if (row && script.current) script.current.scrollTo({ top: Math.max(0, topIn(script.current, row) - 80), behavior: "smooth" });
  };

  const mustWords = ep?.words.filter((w) => w.tier === "must") ?? [];
  const niceWords = ep?.words.filter((w) => w.tier === "nice") ?? [];
  const times = ep ? spans(ep) : [];
  // How many lines each chapter's walk stops at.
  const stopCounts = useMemo(() => (ep ? ep.scenes.map((_, c) => walkStops(ep, c).length) : []), [ep]);
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
              ["words", "Words"],
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
                <SceneHead sc={sc} n={c} from={times[c].from} english={english} stops={stopCounts[c] ?? 0} onWalk={() => setWalk(c)} />
                <ol className="cf-watch-lines">
                  {ep.lines.slice(sc.start, sc.end).map((l, k) => {
                    const i = sc.start + k;
                    const note = noteAt.get(i);
                    const marked = !!note || blurbAt.has(i);
                    return (
                      <li
                        key={i}
                        data-line={i}
                        className={`cf-wl is-${grades[i]}${line === i ? " is-on" : ""}${marked ? " has-note" : ""}${saying === i ? " is-saying" : ""}`}
                        onClick={() => setLine(i)}
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
                            {marked && <b className="cf-gn-key">✦</b>}
                          </button>
                        ) : (
                          <span className="cf-wl-at">
                            {clock(l.s)}
                            {marked && <b className="cf-gn-key">✦</b>}
                          </span>
                        )}
                        <span className="cf-wl-text">
                          <LineText line={l} note={note} trouble={ep.trouble} must={must} onWord={() => setLine(i)} />
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
      {ep && line !== null && (
        <LineView ep={ep} i={line} keeps={keeps} canWrite={canWrite} onMove={toLine} onAdded={reload} onClose={() => setLine(null)} />
      )}
      {ep && walk !== null && (
        <ChapterWalk
          ep={ep}
          c={walk}
          keeps={keeps}
          canWrite={canWrite}
          onEnd={(learnt) => {
            setWalk(null);
            if (learnt) void reload();
          }}
        />
      )}
    </div>
  );
}

/** A chapter's heading in the script: when, what, and what happens (folded to two lines until tapped). */
function SceneHead({
  sc,
  n,
  from,
  english,
  stops,
  onWalk,
}: {
  sc: Episode["scenes"][number];
  n: number;
  from: number;
  english: boolean;
  stops: number;
  onWalk: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="cf-watch-head">
      <p className="cf-watch-head-at">
        Chapter {n + 1} · {clock(from)} · {pct(sc.known)} known
      </p>
      {/* Walk this chapter: its hard lines one at a time, heard from the video (the owner wanted it an icon). */}
      {stops > 0 && (
        <button className="cf-walk-icon" onClick={onWalk} aria-label={`Walk this chapter: ${stops} lines`} title={`Walk this chapter · ${stops} lines`}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            {/* Two footprints, a step apart. */}
            <ellipse cx="8.5" cy="15" rx="2.4" ry="3.4" fill="currentColor" />
            <circle cx="8.5" cy="9.6" r="1.2" fill="currentColor" />
            <ellipse cx="15.5" cy="10.5" rx="2.4" ry="3.4" fill="currentColor" opacity="0.55" />
            <circle cx="15.5" cy="5.1" r="1.2" fill="currentColor" opacity="0.55" />
          </svg>
          <small>{fmt(stops)}</small>
        </button>
      )}
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
