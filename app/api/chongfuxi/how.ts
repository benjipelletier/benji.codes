// Settings › How cards are chosen, live: the cards a session would deal now
// and why, what waits, and what Learn takes next. Read-only; the same queue
// code a session uses (nextCards), so what it shows is what a session gets.

import type { Sql } from "./db";
import type { HowItWorksLive } from "@chongfuxi/lib/api";
import type { StudyDay } from "@chongfuxi/lib/day";
import { recallOdds } from "@chongfuxi/lib/schedule";
import { LEARN_ORDER } from "./learn";
import { ACTIVE, CARD_COLUMNS, WAITING_TO_LEARN, nextCards, scheduleOf, type CardRow } from "./review";

/** Cards shown as the start of a session. */
const NEXT = 12;
/** The odds bands due word cards are counted in, lowest first. */
const BANDS: Array<{ label: string; below: number }> = [
  { label: "Under 50%", below: 0.5 },
  { label: "50–70%", below: 0.7 },
  { label: "70–85%", below: 0.85 },
  { label: "85–90%", below: 0.9 },
  { label: "90% or more", below: Infinity },
];

export async function howItWorks(sql: Sql, owner: string, day: StudyDay, at = Date.now()): Promise<HowItWorksLive> {
  const next = await nextCards(sql, owner, day, { limit: NEXT, position: 0, exclude: [], skipWords: [] });

  const due = (await sql.query(
    `select ${CARD_COLUMNS},
            exists (select 1 from chongfuxi_review r where r.owner_email = c.owner_email and r.day = $3::date and r.word = c.word) as seen_today
     from chongfuxi_card c
     where c.owner_email = $1 and c.kind in ('read', 'produce') and ${ACTIVE} and not ${WAITING_TO_LEARN}
       and c.due <= to_timestamp($2::double precision / 1000)`,
    [owner, day.cutoff, day.day],
  )) as unknown as Array<CardRow & { seen_today: boolean }>;
  const waiting = due.filter((c) => !c.seen_today);
  const odds = [{ label: "Never answered", count: 0 }, ...BANDS.map((b) => ({ label: b.label, count: 0 }))];
  for (const c of waiting) {
    const p = recallOdds(scheduleOf(c), at);
    if (p === null) odds[0].count++;
    else odds[1 + BANDS.findIndex((b) => p < b.below)].count++;
  }

  const learn = (await sql.query(
    `select c.word from chongfuxi_card c
     join chongfuxi_word w on w.owner_email = c.owner_email and w.word = c.word and w.status = 'deck'
     where c.owner_email = $1 and ${ACTIVE} and ${WAITING_TO_LEARN}
     order by ${LEARN_ORDER} limit 8`,
    [owner],
  )) as unknown as Array<{ word: string }>;

  return { next, heldBack: due.length - waiting.length, odds, learnNext: learn.map((l) => l.word) };
}
