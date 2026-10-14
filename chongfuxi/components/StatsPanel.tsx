"use client";

// How the reviewing is going: what has been done, what is coming, and how well
// it sticks. Everything here is read from the review log and the cards.
//
// The charts are plain elements sized with CSS, so they follow the column on a
// phone. Every mark answers a tap or hover with its exact value, and the
// figures that matter most are also written out as numbers above the charts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Maturity, Stats } from "@chongfuxi/lib/api";
import { get, today } from "@chongfuxi/lib/client";
import { HskLevels } from "./HskLevels";
import { fmt, message, type Shell } from "./shared";

const DAY = 86_400_000;
const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const nice = (day: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(utc(day)).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
const pct = (good: number, total: number) => (total ? `${Math.round((100 * good) / total)}%` : "—");

function duration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return ms ? "< 1 min" : "0 min";
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// ------------------------------------------------------------------ tooltip --

interface Tip {
  x: number;
  y: number;
  value: string;
  label: string;
}

/** One tooltip per chart, placed over whichever mark was last pointed at or tapped. */
function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: React.SyntheticEvent<HTMLElement>, value: string, label: string) => {
    const host = box.current?.getBoundingClientRect();
    const mark = e.currentTarget.getBoundingClientRect();
    if (!host) return;
    setTip({ x: mark.left + mark.width / 2 - host.left, y: mark.top - host.top, value, label });
  };
  const marks = (value: string, label: string) => ({
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => show(e, value, label),
    onClick: (e: React.MouseEvent<HTMLElement>) => show(e, value, label),
    onPointerLeave: () => setTip(null),
  });
  const view = tip && (
    <div className="cf-tip" style={{ left: `clamp(70px, ${tip.x}px, calc(100% - 70px))`, top: tip.y }} role="status">
      <b>{tip.value}</b>
      <span>{tip.label}</span>
    </div>
  );
  return { box, marks, view };
}

// ------------------------------------------------------------------ heatmap --

/**
 * Study days, a column a week: as many weeks as the column has room for, and
 * steps back through earlier ones. A day reviewed here takes the accent; a day
 * known only from Pleco is grey, and counts only the cards first or last
 * reviewed then, since those are the only dates Pleco keeps.
 */
function Heatmap({ stats, todayIs }: { stats: Stats; todayIs: string }) {
  const { box, marks, view } = useTip();
  const [weeks, setWeeks] = useState(26);
  // How many screens back from the present.
  const [back, setBack] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setWeeks(Math.max(12, Math.min(53, Math.floor((el.clientWidth - 18) / 14))));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [box]);

  const byDay = useMemo(() => new Map(stats.days.map((d) => [d.day, d.good + d.forgot])), [stats.days]);
  const inPleco = useMemo(() => new Map(stats.pleco.days.map((d) => [d.day, d.n])), [stats.pleco.days]);
  const max = Math.max(1, ...byDay.values());
  // One day of mass imports shouldn't flatten the rest: scale Pleco's days to a typical busy one.
  const plecoMax = useMemo(() => {
    const counts = [...inPleco.values()].sort((a, b) => a - b);
    return Math.max(1, counts[Math.floor(counts.length * 0.9)] ?? 1);
  }, [inPleco]);
  const earliest = stats.pleco.days[0]?.day ?? stats.days[0]?.day ?? todayIs;

  const now = utc(todayIs);
  // Columns start on Monday; the last one is the week the window ends in.
  const lastMonday = now - ((new Date(now).getUTCDay() + 6) % 7) * DAY - back * weeks * 7 * DAY;
  const first = lastMonday - (weeks - 1) * 7 * DAY;
  const columns = Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const at = first + (w * 7 + d) * DAY;
      return at > now ? null : iso(at);
    }),
  );
  const last = columns[weeks - 1].filter(Boolean).pop() ?? todayIs;

  return (
    <>
      <div className="cf-heat-nav">
        <button className="cf-link" disabled={first <= utc(earliest)} onClick={() => setBack(back + 1)}>
          Earlier
        </button>
        <span>
          {nice(iso(first), { month: "short", year: "numeric" })} to {nice(last, { month: "short", year: "numeric" })}
        </span>
        <button className="cf-link" disabled={back === 0} onClick={() => setBack(back - 1)}>
          Later
        </button>
      </div>
      <div className="cf-heat" ref={box}>
        <div className="cf-heat-days" aria-hidden>
          <span>M</span>
          <span>W</span>
          <span>F</span>
        </div>
        <div className="cf-heat-grid" role="img" aria-label={`Reviews per day over ${weeks} weeks`}>
          {columns.map((col, w) => {
            const starts = col[0] && new Date(utc(col[0])).getUTCDate() <= 7;
            return (
              <div key={w} className="cf-heat-col">
                <span className="cf-heat-month">{starts ? nice(col[0]!, { month: "short" }) : ""}</span>
                {col.map((day, d) => {
                  if (!day) return <i key={d} className="cf-heat-cell is-future" />;
                  const n = byDay.get(day) ?? 0;
                  const p = inPleco.get(day) ?? 0;
                  const level = n ? `is-${Math.max(1, Math.ceil((4 * n) / max))}` : p ? `is-p${Math.min(4, Math.max(1, Math.ceil((4 * p) / plecoMax)))}` : "is-0";
                  const value = n ? `${fmt(n)} review${n === 1 ? "" : "s"}` : p ? `${fmt(p)}+ in Pleco` : "No reviews";
                  const when = nice(day, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
                  return <i key={d} className={`cf-heat-cell ${level}`} {...marks(value, n && p ? `${when}, and ${fmt(p)}+ in Pleco` : when)} />;
                })}
              </div>
            );
          })}
        </div>
        {view}
      </div>
    </>
  );
}

// --------------------------------------------------------------------- bars --

interface Bar {
  /** Under the bar, if it has room. */
  tick?: string;
  /** What the bar is, for its tooltip. */
  label: string;
  /** Its segments, bottom first: one per series. */
  values: number[];
}

/** Columns from a shared baseline, stacked when there is more than one series. */
function Columns({ bars, series, unit }: { bars: Bar[]; series: string[]; unit: string }) {
  const { box, marks, view } = useTip();
  const max = Math.max(1, ...bars.map((b) => b.values.reduce((a, v) => a + v, 0)));
  return (
    <div className="cf-chart" ref={box}>
      <div className="cf-chart-max">{fmt(max)}</div>
      <div className={`cf-cols${series.length === 1 ? " is-single" : ""}`} role="img" aria-label={`${unit}: ${bars.length} columns`}>
        {bars.map((b, i) => {
          const total = b.values.reduce((a, v) => a + v, 0);
          const named = (v: number, s: number) => (v === 1 ? series[s].replace(/s$/, "") : series[s]).toLowerCase();
          const detail = series.length > 1 ? b.values.map((v, s) => `${fmt(v)} ${named(v, s)}`).join(", ") : unit;
          return (
            <div key={i} className="cf-col" {...marks(`${fmt(total)}${series.length > 1 ? "" : ` ${unit}`}`, series.length > 1 ? `${b.label} · ${detail}` : b.label)}>
              <div className="cf-col-stack">
                {b.values.map((v, s) =>
                  v > 0 ? <i key={s} className={`cf-barseg is-s${s + 1}`} style={{ height: `${(100 * v) / max}%` }} /> : null,
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="cf-ticks" aria-hidden>
        {bars.map((b, i) => (
          <span key={i}>{b.tick ?? ""}</span>
        ))}
      </div>
      {series.length > 1 && (
        <div className="cf-legend">
          {series.map((name, s) => (
            <span key={name}>
              <i className={`cf-barseg is-s${s + 1}`} />
              {name}
            </span>
          ))}
        </div>
      )}
      {view}
    </div>
  );
}

// ----------------------------------------------------------------- maturity --

const STAGES: Array<{ key: keyof Maturity; label: string }> = [
  { key: "fresh", label: "New" },
  { key: "young", label: "Young" },
  { key: "mature", label: "Mature" },
  { key: "retired", label: "Retired" },
];

/** Where the cards of one kind stand, as one bar split by stage. */
function Stages({ name, m }: { name: string; m: Maturity }) {
  const { box, marks, view } = useTip();
  const total = STAGES.reduce((n, s) => n + m[s.key], 0);
  return (
    <div className="cf-stages" ref={box}>
      <div className="cf-stages-head">
        <span>{name}</span>
        <b>{fmt(total)}</b>
      </div>
      <div className="cf-stages-bar" role="img" aria-label={`${name}: ${STAGES.map((s) => `${m[s.key]} ${s.label.toLowerCase()}`).join(", ")}`}>
        {total === 0 && <i className="cf-stage is-none" style={{ flexGrow: 1 }} />}
        {STAGES.map((s, i) =>
          m[s.key] > 0 ? (
            <i key={s.key} className={`cf-stage is-${i + 1}`} style={{ flexGrow: m[s.key] }} {...marks(fmt(m[s.key]), `${s.label} · ${pct(m[s.key], total)}`)} />
          ) : null,
        )}
      </div>
      {view}
    </div>
  );
}

// -------------------------------------------------------------------- panel --

function streaks(studied: string[], todayIs: string): { current: number; longest: number } {
  const days = new Set(studied);
  let longest = 0;
  let run = 0;
  let prev = 0;
  for (const d of studied) {
    const at = utc(d);
    run = at - prev === DAY ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = at;
  }
  // Today not studied yet doesn't break a streak; yesterday missed does.
  let at = days.has(todayIs) ? utc(todayIs) : utc(todayIs) - DAY;
  let current = 0;
  while (days.has(iso(at))) {
    current++;
    at -= DAY;
  }
  return { current, longest };
}

export function StatsPanel({ shell }: { shell: Shell }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useMemo(() => today(), []);

  useEffect(() => {
    get<Stats>("stats", { ...now, offset: -new Date().getTimezoneOffset() })
      .then(setStats)
      .catch((e) => setError(message(e)));
  }, [now]);

  if (error) return <p className="cf-error">{error}</p>;
  if (!stats) return <p className="cf-muted cf-pad">Adding it up…</p>;

  const whose = shell.canWrite ? "You" : "Benji";
  const todayStats = stats.days.find((d) => d.day === now.day);
  const done = (todayStats?.good ?? 0) + (todayStats?.forgot ?? 0);
  const { current, longest } = streaks(stats.studied, now.day);
  const recent = stats.days.filter((d) => utc(d.day) > utc(now.day) - 30 * DAY);
  const recentGood = recent.reduce((n, d) => n + d.good, 0);
  const recentAll = recent.reduce((n, d) => n + d.good + d.forgot, 0);
  const recentMs = recent.reduce((n, d) => n + d.ms, 0);

  const last30: Bar[] = Array.from({ length: 30 }, (_, i) => {
    const day = iso(utc(now.day) - (29 - i) * DAY);
    const d = stats.days.find((x) => x.day === day);
    return { label: nice(day), tick: i % 7 === 1 ? nice(day) : undefined, values: [d?.good ?? 0, d?.forgot ?? 0] };
  });
  const ahead: Bar[] = stats.forecast.map((f, i) => {
    const day = iso(utc(now.day) + (i + 1) * DAY);
    return { label: i === 0 ? "Tomorrow" : nice(day), tick: i % 7 === 0 ? nice(day) : undefined, values: [f.words, f.sentences] };
  });
  const comingUp = stats.forecast.reduce((n, f) => n + f.words + f.sentences, 0);
  const hours: Bar[] = Array.from({ length: 24 }, (_, h) => {
    const row = stats.hours.find((x) => x.hour === h);
    return { label: `${String(h).padStart(2, "0")}:00 · ${pct(row?.good ?? 0, row?.total ?? 0)} right`, tick: h % 6 === 0 ? `${h}h` : undefined, values: [row?.total ?? 0] };
  });
  const wordCards = stats.stability.reduce((n, b) => n + b.cards, 0);

  return (
    <div className="cf-panel cf-stats">
      <section className="cf-section">
        <h2 className="cf-h2">Today</h2>
        <div className="cf-tiles">
          <div className="cf-tile">
            <b>{fmt(done)}</b>
            <span>reviewed</span>
          </div>
          <div className="cf-tile">
            <b>{duration(todayStats?.ms ?? 0)}</b>
            <span>spent</span>
          </div>
          <div className="cf-tile">
            <b>{fmt(stats.dueNow.words + stats.dueNow.sentences)}</b>
            <span>still due</span>
          </div>
          <div className="cf-tile">
            <b>{current}</b>
            <span>day streak</span>
          </div>
        </div>
      </section>

      <section className="cf-section">
        <h2 className="cf-h2">Reviews</h2>
        <p className="cf-lede">
          {stats.totalReviews
            ? `${fmt(stats.totalReviews)} answer${stats.totalReviews === 1 ? "" : "s"} over ${fmt(stats.studied.length)} day${stats.studied.length === 1 ? "" : "s"}. Longest streak ${longest} day${longest === 1 ? "" : "s"}.`
            : `No reviews yet. ${whose === "You" ? "Your first session" : "Benji's first session"} starts filling this in.`}
        </p>
        <Heatmap stats={stats} todayIs={now.day} />
        <div className="cf-heat-key" aria-hidden>
          <span>Here</span>
          {[1, 2, 3, 4].map((l) => (
            <i key={l} className={`cf-heat-cell is-${l}`} />
          ))}
          <span className="cf-heat-key-gap">Pleco</span>
          {[1, 2, 3, 4].map((l) => (
            <i key={l} className={`cf-heat-cell is-p${l}`} />
          ))}
        </div>
        {stats.pleco.cards > 0 && (
          <p className="cf-muted cf-heat-note">
            Before this, {fmt(stats.pleco.reviews)} answers in Pleco across {fmt(stats.pleco.cards)} cards. Pleco keeps
            only the date each card was first and last reviewed, so a grey day shows at least that many, not all of them.
          </p>
        )}
      </section>

      <section className="cf-section">
        <h2 className="cf-h2">Last 30 days</h2>
        <div className="cf-tiles">
          <div className="cf-tile">
            <b>{fmt(recentAll)}</b>
            <span>answers</span>
          </div>
          <div className="cf-tile">
            <b>{pct(recentGood, recentAll)}</b>
            <span>got it</span>
          </div>
          <div className="cf-tile">
            <b>{recentAll ? `${(recentMs / recentAll / 1000).toFixed(1)}s` : "—"}</b>
            <span>per card</span>
          </div>
          <div className="cf-tile">
            <b>{duration(recentMs)}</b>
            <span>in all</span>
          </div>
        </div>
        <Columns bars={last30} series={["Got it", "Forgot"]} unit="answers" />
      </section>

      <section className="cf-section">
        <h2 className="cf-h2">Coming up</h2>
        <p className="cf-lede">
          {fmt(stats.dueNow.words)} word cards and {fmt(stats.dueNow.sentences)} sentences are due now, overdue ones
          included. After that, {fmt(comingUp)} more fall due over the next 30 days, if nothing is forgotten.
        </p>
        <Columns bars={ahead} series={["Words", "Sentences"]} unit="cards" />
      </section>

      <section className="cf-section">
        <h2 className="cf-h2">How well it sticks</h2>
        <p className="cf-lede">Share of answers that were Got it, over the last 30 days and over all time.</p>
        <table className="cf-table">
          <thead>
            <tr>
              <th scope="col" />
              <td>30 days</td>
              <td>All time</td>
              <td>Answers</td>
            </tr>
          </thead>
          <tbody>
            {stats.retention.map((r) => (
              <tr key={r.kind}>
                <th scope="row">{r.kind === "read" ? "Read" : r.kind === "produce" ? "Recall" : "Sentences"}</th>
                <td>{pct(r.recent.good, r.recent.total)}</td>
                <td>{pct(r.all.good, r.all.total)}</td>
                <td>{fmt(r.all.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="cf-section">
        <h2 className="cf-h2">Where the cards stand</h2>
        <p className="cf-lede">Young is remembered for under three weeks, mature for longer.</p>
        <Stages name="Read" m={stats.maturity.read} />
        <Stages name="Recall" m={stats.maturity.produce} />
        <Stages name="Sentences" m={stats.maturity.sentence} />
        <div className="cf-legend">
          {STAGES.map((s, i) => (
            <span key={s.key}>
              <i className={`cf-stage is-${i + 1}`} />
              {s.label}
            </span>
          ))}
        </div>
      </section>

      <section className="cf-section">
        <h2 className="cf-h2">How long words last</h2>
        <p className="cf-lede">
          {fmt(wordCards)} word cards by stability: how long until the chance of recalling one drops to 90%.
        </p>
        <Columns bars={stats.stability.map((b) => ({ label: b.label, tick: b.label.replace("< ", "<").replace(" months", "mo").replace(" month", "mo").replace(" week", "w").replace(" day", "d").replace(" year", "y").replace(" +", "+"), values: [b.cards] }))} series={["Cards"]} unit="cards" />
      </section>

      <HskLevels shell={shell} />

      {stats.hours.length > 0 && (
        <section className="cf-section">
          <h2 className="cf-h2">Time of day</h2>
          <p className="cf-lede">Answers by the hour they were given.</p>
          <Columns bars={hours} series={["Answers"]} unit="answers" />
        </section>
      )}

      {stats.hardest.length > 0 && (
        <section className="cf-section">
          <h2 className="cf-h2">Forgotten most</h2>
          <ul className="cf-list">
            {stats.hardest.map((h) => (
              <li key={h.word} className="cf-row">
                <div className="cf-row-head">
                  <span className="cf-word">{h.word}</span>
                  <span className="cf-pinyin" />
                  <span className="cf-count cf-count-plain">
                    {h.forgot} of {h.total}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
