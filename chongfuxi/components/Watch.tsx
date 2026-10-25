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
  EpisodeView as Episode,
  EpisodeWord,
  LineNoteKind,
  LineWordInfo,
  Retell,
  TextToken,
} from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
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

/** The episodes as rows on the Muse reviews screen. */
export function EpisodeRows({ episodes, onOpen }: { episodes: EpisodeListed[]; onOpen: (id: number) => void }) {
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

/**
 * The chapters as one bar, each scene a segment as long as it runs, like
 * YouTube's. Dragging along it shows the scene under the finger with its
 * start; letting go (or a tap) opens it. Arrow keys step through.
 */
function ChapterBar({ ep, current, onPick, compact = false }: { ep: Episode; current: number; onPick: (i: number) => void; compact?: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const times = spans(ep);
  const total = Math.max(1, times[times.length - 1]?.to ?? ep.duration);

  const sceneAt = (clientX: number) => {
    const box = bar.current!.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - box.left, 0), box.width);
    const t = (x / box.width) * total;
    let i = times.findIndex((s) => t < s.to);
    if (i < 0) i = times.length - 1;
    return { i, x };
  };
  const move = (clientX: number) => {
    const { i, x } = sceneAt(clientX);
    setHover({ i, x });
  };

  const shown = hover?.i ?? current;
  // Over the finger while scrubbing, else over the open chapter's middle; kept clear of the ends.
  const at = hover ? `${hover.x}px` : `${((times[current].from + times[current].to) / 2 / total) * 100}%`;
  const tipLeft = `clamp(${compact ? 120 : 70}px, ${at}, calc(100% - ${compact ? 120 : 70}px))`;
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
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e.clientX);
        }}
        onPointerMove={(e) => hover && move(e.clientX)}
        onPointerUp={(e) => {
          const { i } = sceneAt(e.clientX);
          setHover(null);
          onPick(i);
        }}
        onPointerCancel={() => setHover(null)}
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
        {hover && <span className="cf-ch-head" style={{ left: hover.x }} />}
      </div>
      {/* Compact (over the script), the time and title show only while scrubbing. */}
      {(!compact || hover) && (
        <div className="cf-ch-tipline">
          <span className="cf-ch-tip" style={{ left: tipLeft }}>
            <b>{clock(times[shown].from)}</b> <span className="cf-zh">{ep.scenes[shown].title}</span>
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
  const worth = (w: LineWordInfo) => rank(w) < 4 || w.parts !== null || w.notes.length > 0 || w.hook !== null || w.lookups.length > 0 || w.word === focus;
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
function ChapterStrip({ ep, current, grades, english, onPick }: { ep: Episode; current: number; grades: Grade[]; english: boolean; onPick: (i: number) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  const times = spans(ep);
  useEffect(() => {
    const el = strip.current?.children[current] as HTMLElement | undefined;
    if (!el || !strip.current) return;
    strip.current.scrollTo({ left: el.offsetLeft - (strip.current.clientWidth - el.clientWidth) / 2, behavior: "smooth" });
  }, [current]);
  return (
    <div className="cf-watch-chapters">
      <ChapterBar ep={ep} current={current} onPick={onPick} compact />
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

type Tab = "script" | "words" | "after";

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

  const must = useMemo(() => new Set((ep?.words ?? []).filter((w) => w.tier === "must" && !w.inDeck).map((w) => w.word)), [ep]);
  const grades = useMemo(() => (ep ? ep.lines.map((l) => gradeOf(l.tokens)) : []), [ep]);
  const noteAt = useMemo(() => new Map((ep?.notes ?? []).map((n) => [n.i, n])), [ep]);

  // The chapter in view: the last whose heading is above the top of the script.
  const onScroll = () => {
    const box = script.current;
    if (!box || !ep) return;
    const heads = box.querySelectorAll<HTMLElement>("[data-ch]");
    let now = 0;
    heads.forEach((h, k) => {
      if (h.offsetTop <= box.scrollTop + 12) now = k;
    });
    if (now !== scene) setScene(now);
  };
  const toChapter = (i: number) => {
    setScene(i);
    const head = script.current?.querySelector<HTMLElement>(`[data-ch="${i}"]`);
    if (head) script.current!.scrollTo({ top: head.offsetTop, behavior: "smooth" });
  };
  const toLine = (i: number) => {
    if (!ep || i < 0 || i >= ep.lines.length) return;
    setLine({ i, word: null });
    const row = script.current?.querySelector<HTMLElement>(`[data-line="${i}"]`);
    if (row && script.current) script.current.scrollTo({ top: Math.max(0, row.offsetTop - 80), behavior: "smooth" });
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
              ["words", `Words${mustWords.length ? ` · ${mustWords.filter((w) => !w.inDeck).length}` : ""}`],
              ["after", "After watching"],
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
          <ChapterStrip ep={ep} current={scene} grades={grades} english={english} onPick={toChapter} />
          <div className="cf-watch-script" ref={script} onScroll={onScroll}>
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
                        className={`cf-wl is-${grades[i]}${line?.i === i ? " is-on" : ""}${note ? " has-note" : ""}`}
                        onClick={() => setLine({ i, word: null })}
                      >
                        <span className="cf-wl-at">
                          {clock(l.s)}
                          {note && <b className="cf-gn-key">✦</b>}
                        </span>
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
