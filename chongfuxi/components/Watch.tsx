"use client";

// Getting ready to watch a drama (app/api/chongfuxi/episodes.ts): an
// episode's subtitles, which Muse finds and preps, measured against the deck.
// The screen says how ready the owner is (words known now, once the
// must-knows are learnt, lines readable), lists the must-know words with a
// way into their Muse list, and cuts the episode into chapters to scrub
// through like YouTube's: a bar of scenes sized by their length, dragged or
// tapped, each scene with what happens (spoilers are fine), its notes and its
// lines, every word marked and tappable. Questions to answer after watching
// are graded like a reading's retelling.

import { useEffect, useRef, useState } from "react";
import type { EpisodeListed, EpisodeProgress, EpisodeView as Episode, EpisodeWord, Retell, TextToken } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { say } from "./Drill";
import { Question } from "./Reading";
import { Loading, fmt, message } from "./shared";

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
      <p className="cf-muted cf-stuck-about">Episodes Muse found the subtitles for, to get ready for before watching.</p>
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

type Scene = Episode["scenes"][number];

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
function ChapterBar({ ep, current, onPick }: { ep: Episode; current: number; onPick: (i: number) => void }) {
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
  const tipLeft = `clamp(70px, ${at}, calc(100% - 70px))`;
  return (
    <div className="cf-ch">
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
      <div className="cf-ch-tipline">
        <span className="cf-ch-tip" style={{ left: tipLeft }}>
          <b>{clock(times[shown].from)}</b> <span className="cf-zh">{ep.scenes[shown].title}</span>
        </span>
      </div>
      <div className="cf-ch-ends">
        <span>0:00</span>
        <span>
          {ep.scenes.length} chapters{ep.autoScenes && " · cut at the pauses"}
        </span>
        <span>{clock(total)}</span>
      </div>
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

function Line({
  line,
  must,
  picked,
  english,
  onPick,
}: {
  line: Episode["lines"][number];
  must: Set<string>;
  picked: string | null;
  english: boolean;
  onPick: (w: string) => void;
}) {
  // With English hidden, a line's translation is blurred until tapped, to check yourself against.
  const [shown, setShown] = useState(false);
  return (
    <li className="cf-ep-line">
      <button className="cf-ep-at" onClick={() => say(line.zh)} aria-label={`Hear the line at ${clock(line.s)}`}>
        {clock(line.s)}
      </button>
      <span className="cf-ep-text">
        <span className="cf-zh">
          {glued(line.tokens).map((run, j) => (
            <span key={j} className="cf-ep-run">
              {run.map((t, k) =>
                t.k ? (
                  <button
                    key={k}
                    className={`cf-an-w is-${t.k}${must.has(t.t) ? " is-must" : ""}${picked === t.t ? " is-picked" : ""}`}
                    onClick={() => onPick(t.t)}
                  >
                    {t.t}
                  </button>
                ) : (
                  <span key={k}>{t.t}</span>
                ),
              )}
            </span>
          ))}
        </span>
        {line.en &&
          (english || shown ? (
            <span className="cf-ep-en">{line.en}</span>
          ) : (
            <button className="cf-ep-en is-hidden" onClick={() => setShown(true)} aria-label="Show the English">
              {line.en}
            </button>
          ))}
      </span>
    </li>
  );
}

function ScenePanel({
  ep,
  i,
  must,
  picked,
  english,
  onEnglish,
  onPick,
}: {
  ep: Episode;
  i: number;
  must: Set<string>;
  picked: string | null;
  english: boolean;
  onEnglish: (on: boolean) => void;
  onPick: (w: string) => void;
}) {
  const sc: Scene = ep.scenes[i];
  const [summaryShown, setSummaryShown] = useState(false);
  const [lines, setLines] = useState(true);
  const times = spans(ep)[i];
  const shown = ep.lines.slice(sc.start, sc.end);
  return (
    <section className="cf-ep-scene">
      <p className="cf-ep-scene-at">
        Chapter {i + 1} · {clock(times.from)}–{clock(times.to)} · {pct(sc.known)} known
      </p>
      <h2 className="cf-ep-scene-h cf-zh">{sc.title}</h2>
      {sc.summary && <p className="cf-zh cf-ep-summary">{sc.summary}</p>}
      {sc.summaryEn &&
        (english || summaryShown ? (
          <p className="cf-muted cf-ep-summary-en">{sc.summaryEn}</p>
        ) : (
          <button className="cf-ep-en is-hidden cf-ep-summary-en" onClick={() => setSummaryShown(true)} aria-label="Show the English">
            {sc.summaryEn}
          </button>
        ))}
      {sc.notes.length > 0 && (
        <ul className="cf-ep-notes">
          {sc.notes.map((n, j) => (
            <li key={j}>{n}</li>
          ))}
        </ul>
      )}
      <div className="cf-ep-lines-bar">
        <button className="cf-link" onClick={() => setLines(!lines)}>
          {lines ? "Hide the lines" : `Show the ${fmt(shown.length)} lines`}
        </button>
        {lines && ep.lines.some((l) => l.en) && (
          <button className={`cf-ep-entoggle${english ? " is-on" : ""}`} onClick={() => onEnglish(!english)} aria-pressed={english}>
            English
          </button>
        )}
      </div>
      {lines && (
        <ol className="cf-ep-lines">
          {shown.map((l, j) => (
            <Line key={sc.start + j} line={l} must={must} picked={picked} english={english} onPick={onPick} />
          ))}
        </ol>
      )}
    </section>
  );
}

export function EpisodeView({ id, canWrite, onEnd }: { id: number; canWrite: boolean; onEnd: () => void }) {
  const [ep, setEp] = useState<Episode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [nice, setNice] = useState(false);
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
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    get<{ episode: Episode }>("episodes", { id })
      .then((r) => setEp(r.episode))
      .catch((e) => setError(message(e)));
  }, [id]);

  const pickScene = (i: number) => {
    setScene(i);
    setPicked(null);
  };
  const jump = (i: number) => {
    pickScene(i);
    sceneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const must = new Set((ep?.words ?? []).filter((w) => w.tier === "must").map((w) => w.word));
  const mustWords = ep?.words.filter((w) => w.tier === "must") ?? [];
  const niceWords = ep?.words.filter((w) => w.tier === "nice") ?? [];
  const look = picked && ep ? ep.looks[picked] : null;
  const times = ep ? spans(ep) : [];
  return (
    <div className="cf-rescue cf-reading cf-episode">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the list">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">Watch</p>
      </div>
      <div className="cf-rescue-in">
        {error && (
          <>
            <p className="cf-error">{error}</p>
            <p className="cf-muted">Only Benji can open these: the subtitles aren&apos;t ours to show.</p>
          </>
        )}
        {!ep && !error && <Loading label="Reading the subtitles…" />}
        {ep && (
          <>
            <h1 className="cf-read-h cf-zh">
              {ep.show} <span className="cf-ep-num">{ep.episode}</span>
            </h1>
            <p className="cf-muted cf-read-meta">
              {ep.title && <span className="cf-zh">{ep.title} · </span>}
              {clock(ep.duration)} · {fmt(ep.lineCount)} lines{ep.model && <> · prepped by {ep.model}</>}
            </p>
            {!ep.model && <p className="cf-read-note">Muse hasn&apos;t prepped this one yet: the words are by how often they&apos;re said, and the chapters are cut at the pauses.</p>}
            <Readiness ep={ep} />

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

            <h2 className="cf-kits-h">Chapters</h2>
            <ChapterBar ep={ep} current={scene} onPick={pickScene} />
            <div ref={sceneRef}>
              <ScenePanel key={scene} ep={ep} i={scene} must={must} picked={picked} english={english} onEnglish={setEnglish} onPick={(w) => setPicked(picked === w ? null : w)} />
            </div>
            <div className="cf-ep-step">
              <button className="cf-btn cf-btn-ghost" disabled={scene === 0} onClick={() => jump(scene - 1)}>
                ‹ Chapter {scene}
              </button>
              <button className="cf-btn cf-btn-ghost" disabled={scene >= ep.scenes.length - 1} onClick={() => jump(scene + 1)}>
                Chapter {scene + 2} ›
              </button>
            </div>
            <ol className="cf-ep-chapters">
              {ep.scenes.map((sc, i) => (
                <li key={i}>
                  <button className={i === scene ? "is-on" : ""} onClick={() => jump(i)}>
                    <span className="cf-ep-ch-at">{clock(times[i].from)}</span>
                    <span className="cf-ep-ch-body">
                      <span className="cf-zh">{sc.title}</span>
                      <small>
                        {fmt(sc.end - sc.start)} lines · {pct(sc.known)} known
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>

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

            {ep.questions.length > 0 && (
              <section className="cf-read-retell">
                <h2 className="cf-kits-h">After watching</h2>
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
              </section>
            )}
          </>
        )}
      </div>
      {picked && (
        <div className="cf-an-picked cf-read-picked">
          <p>
            <span className="cf-zh">{picked}</span> {look?.p && <b>{displayPinyin(look.p)}</b>}
          </p>
          {look?.gloss && <p className="cf-muted">{look.gloss}</p>}
          <div className="cf-an-picked-foot">
            <button className="cf-link" onClick={() => wordpage.openWordPage(picked)}>
              Word page ›
            </button>
            <button className="cf-link" onClick={() => setPicked(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
