// The numbers behind the Stats screen: what has been reviewed, what is coming,
// and how well it is sticking. All of it read straight from the review log and
// the cards; nothing is kept on the side.

import type { Sql } from "./db";
import type { DayStats, Maturity, Stats } from "@chongfuxi/lib/api";
import type { StudyDay } from "@chongfuxi/lib/day";
import type { CardKind } from "@chongfuxi/lib/schedule";

/** How far ahead the forecast looks, in days. */
const FORECAST_DAYS = 30;
/** "Recently", for retention. */
const RECENT_DAYS = 30;
/** A card remembered for three weeks or more is mature, as Anki has it. */
const MATURE_DAYS = 21;

const STABILITY: Array<{ upTo: number | null; label: string }> = [
  { upTo: 1, label: "< 1 day" },
  { upTo: 7, label: "< 1 week" },
  { upTo: 30, label: "< 1 month" },
  { upTo: 90, label: "< 3 months" },
  { upTo: 365, label: "< 1 year" },
  { upTo: null, label: "1 year +" },
];

/** Days turn over at 04:00, as in chongfuxi/lib/day.ts. */
const ROLLOVER_HOURS = 4;

/**
 * @param utcOffset  the owner's offset from UTC in minutes, to put Pleco's
 *                   review times (which carry no timezone) on the right day
 */
export async function getStats(sql: Sql, owner: string, day: StudyDay, utcOffset = 0): Promise<Stats> {
  const cutoff = day.cutoff;
  const active = `c.retired is null and c.flagged is null and not c.suspended`;

  const [days, studied, forecast, retention, maturity, stability, hours, hardest, plecoRows] = await Promise.all([
    sql.query(
      `select to_char(day, 'YYYY-MM-DD') as day,
              count(*) filter (where grade = 'good')::int as good,
              count(*) filter (where grade = 'forgot')::int as forgot,
              coalesce(sum(ms), 0)::double precision as ms,
              count(*) filter (where kind <> 'sentence')::int as words,
              count(*) filter (where kind = 'sentence')::int as sentences
       from chongfuxi_review
       where owner_email = $1 and cause = 'answer' and day > $2::date - 371
       group by day order by day`,
      [owner, day.day],
    ) as unknown as Promise<DayStats[]>,
    sql.query(
      `select to_char(day, 'YYYY-MM-DD') as day, count(*)::int as n
       from chongfuxi_review where owner_email = $1 and cause = 'answer'
       group by day order by day`,
      [owner],
    ) as unknown as Promise<Array<{ day: string; n: number }>>,
    // Day 0 is everything due before today ends, overdue included. A sentence
    // not yet introduced isn't due: the daily limit decides when it comes.
    sql.query(
      `select greatest(0, ceil(extract(epoch from (c.due - to_timestamp($2::double precision / 1000))) / 86400))::int as d,
              (c.kind = 'sentence') as sentence, count(*)::int as n
       from chongfuxi_card c
       where c.owner_email = $1 and ${active} and not (c.kind = 'sentence' and c.state = 0)
         and c.due <= to_timestamp($2::double precision / 1000) + make_interval(days => $3::int)
       group by 1, 2`,
      [owner, cutoff, FORECAST_DAYS],
    ) as unknown as Promise<Array<{ d: number; sentence: boolean; n: number }>>,
    sql.query(
      `select kind, (day > $2::date - $3::int) as recent,
              count(*) filter (where grade = 'good')::int as good, count(*)::int as total
       from chongfuxi_review where owner_email = $1 and cause = 'answer'
       group by 1, 2`,
      [owner, day.day, RECENT_DAYS],
    ) as unknown as Promise<Array<{ kind: CardKind; recent: boolean; good: number; total: number }>>,
    sql.query(
      `select kind,
              count(*) filter (where retired is null and state = 0)::int as fresh,
              count(*) filter (where retired is null and state <> 0 and stability < $2)::int as young,
              count(*) filter (where retired is null and state <> 0 and stability >= $2)::int as mature,
              count(*) filter (where retired is not null)::int as retired
       from chongfuxi_card where owner_email = $1 and not suspended
       group by kind`,
      [owner, MATURE_DAYS],
    ) as unknown as Promise<Array<{ kind: CardKind } & Maturity>>,
    sql.query(
      `select width_bucket(stability, array[1, 7, 30, 90, 365]::double precision[]) as b, count(*)::int as n
       from chongfuxi_card
       where owner_email = $1 and kind <> 'sentence' and state <> 0 and not suspended
       group by 1`,
      [owner],
    ) as unknown as Promise<Array<{ b: number; n: number }>>,
    // The hour where the owner was, from the offset the device reported.
    sql.query(
      `select (floor(mod((extract(epoch from at) / 60 + utc_offset)::numeric, 1440) / 60))::int as hour,
              count(*) filter (where grade = 'good')::int as good, count(*)::int as total
       from chongfuxi_review
       where owner_email = $1 and cause = 'answer' and utc_offset is not null
       group by 1 order by 1`,
      [owner],
    ) as unknown as Promise<Array<{ hour: number; good: number; total: number }>>,
    sql.query(
      `select word, count(*) filter (where grade = 'forgot')::int as forgot, count(*)::int as total
       from chongfuxi_review
       where owner_email = $1 and word is not null
       group by word having count(*) filter (where grade = 'forgot') > 0
       order by 2 desc, 3 desc, 1 limit 12`,
      [owner],
    ) as unknown as Promise<Array<{ word: string; forgot: number; total: number }>>,
    sql.query(
      `select (pleco->>'first')::bigint as first, (pleco->>'last')::bigint as last, (pleco->>'reviewed')::int as reviewed
       from chongfuxi_word where owner_email = $1 and pleco is not null
       union all
       select (pleco->>'first')::bigint, (pleco->>'last')::bigint, (pleco->>'reviewed')::int
       from chongfuxi_sentence where owner_email = $1 and pleco is not null`,
      [owner],
    ) as unknown as Promise<Array<{ first: string | null; last: string | null; reviewed: number | null }>>,
  ]);

  // Pleco dates only each card's first and last review. Those are what can be
  // put on a calendar; the reviews in between are counted but not placed.
  const plecoDays = new Map<string, number>();
  const dayOf = (seconds: number) => new Date((seconds + utcOffset * 60 - ROLLOVER_HOURS * 3600) * 1000).toISOString().slice(0, 10);
  for (const r of plecoRows) {
    const marks = new Set<string>();
    if (r.first) marks.add(dayOf(Number(r.first)));
    if (r.last) marks.add(dayOf(Number(r.last)));
    for (const d of marks) plecoDays.set(d, (plecoDays.get(d) ?? 0) + 1);
  }

  const ahead = Array.from({ length: FORECAST_DAYS }, () => ({ words: 0, sentences: 0 }));
  const dueNow = { words: 0, sentences: 0 };
  for (const f of forecast) {
    const slot = f.d === 0 ? dueNow : ahead[f.d - 1];
    if (slot) slot[f.sentence ? "sentences" : "words"] += f.n;
  }

  const none = { good: 0, total: 0 };
  const empty: Maturity = { fresh: 0, young: 0, mature: 0, retired: 0 };
  const kinds: CardKind[] = ["read", "produce", "sentence"];
  const all = (kind: CardKind) => {
    const rows = retention.filter((r) => r.kind === kind);
    return { good: rows.reduce((n, r) => n + r.good, 0), total: rows.reduce((n, r) => n + r.total, 0) };
  };

  return {
    days,
    studied: studied.map((s) => s.day),
    totalReviews: studied.reduce((n, s) => n + s.n, 0),
    forecast: ahead,
    dueNow,
    retention: kinds.map((kind) => {
      const recent = retention.find((r) => r.kind === kind && r.recent);
      return { kind, recent: recent ? { good: recent.good, total: recent.total } : none, all: all(kind) };
    }),
    maturity: Object.fromEntries(
      kinds.map((kind) => {
        const m = maturity.find((r) => r.kind === kind);
        return [kind, m ? { fresh: m.fresh, young: m.young, mature: m.mature, retired: m.retired } : empty];
      }),
    ) as Record<CardKind, Maturity>,
    stability: STABILITY.map((s, i) => ({ ...s, cards: stability.find((r) => r.b === i)?.n ?? 0 })),
    hours,
    hardest,
    pleco: {
      days: [...plecoDays].map(([d, n]) => ({ day: d, n })).sort((a, b) => a.day.localeCompare(b.day)),
      reviews: plecoRows.reduce((n, r) => n + (r.reviewed ?? 0), 0),
      cards: plecoRows.length,
    },
  };
}
