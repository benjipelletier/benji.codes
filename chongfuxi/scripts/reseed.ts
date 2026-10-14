// Start again, under the current seeding rule, every card not yet answered here.
//
//   npx tsx --env-file=.env.local chongfuxi/scripts/reseed.ts [--dry-run]
//
// A card's schedule begins as a seed worked out from what Pleco knew
// (lib/schedule.ts seedSchedule). When that rule changes — a different cap,
// a different idea of when a seeded card is due — this applies the new rule to
// the cards it can still apply to: the ones with no answers. A card that has
// been answered here has a history, and is left exactly as it is.

import { neon } from "@neondatabase/serverless";
import type { Sql } from "../../app/api/chongfuxi/db";
import type { PlecoSeed } from "../lib/pleco";
import { seedSchedule, type CardKind } from "../lib/schedule";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.CHONGFUXI_DATABASE_URL || process.env.CHONGFUXI_POSTGRES_URL;
  // The same addresses, in the same order, as chongfuxi/lib/session.ts.
  const owner = process.env.CHONGFUXI_OWNER_EMAIL || process.env.LONGKU_OWNER_EMAIL || process.env.JAZZ_OWNER_EMAIL;
  if (!url) throw new Error("No chongfuxi database URL in the environment.");
  if (!owner) throw new Error("No owner in the environment (CHONGFUXI_OWNER_EMAIL, or the 龙库 or jazz one).");
  const sql = neon(url) as Sql;

  const cards = (await sql`
    select c.id::int as id, c.kind, coalesce(w.pleco, s.pleco) as pleco,
           c.stability, (extract(epoch from c.due) * 1000)::double precision as due
    from chongfuxi_card c
    left join chongfuxi_word w on w.owner_email = c.owner_email and w.word = c.word and c.meaning_id is null
    left join chongfuxi_sentence s on s.owner_email = c.owner_email and s.id = c.sentence_id
    where c.owner_email = ${owner} and c.answered = 0
  `) as unknown as Array<{ id: number; kind: CardKind; pleco: PlecoSeed | null; stability: number; due: number }>;
  const answered = (await sql`
    select count(*)::int as n from chongfuxi_card where owner_email = ${owner} and answered > 0
  `) as unknown as Array<{ n: number }>;

  const at = Date.now();
  const seeds = cards.filter((c) => c.pleco?.last && c.pleco.score).map((c) => ({ id: c.id, was: c, ...seedSchedule(c.pleco, c.kind, at) }));
  const lowered = seeds.filter((s) => s.stability < s.was.stability - 1e-9).length;
  const notDue = seeds.filter((s) => s.was.due > at).length;
  console.log(`${cards.length.toLocaleString("en-US")} cards not yet answered here, ${seeds.length.toLocaleString("en-US")} of them with a Pleco history; ${answered[0].n} answered and left alone.`);
  console.log(`  ${lowered.toLocaleString("en-US")} start with less stability than before, ${notDue.toLocaleString("en-US")} weren't due yet and now are.`);
  if (dryRun) return console.log("--dry-run: nothing written.");

  for (let i = 0; i < seeds.length; i += 1000) {
    const batch = seeds.slice(i, i + 1000).map(({ was: _was, ...s }) => s);
    await sql`
      update chongfuxi_card c
      set state = (e.value->>'state')::smallint,
          due = to_timestamp((e.value->>'due')::double precision / 1000),
          stability = (e.value->>'stability')::double precision,
          difficulty = (e.value->>'difficulty')::double precision,
          reps = (e.value->>'reps')::int,
          lapses = (e.value->>'lapses')::int,
          scheduled_days = (e.value->>'scheduledDays')::int,
          last_review = to_timestamp((e.value->>'lastReview')::double precision / 1000)
      from jsonb_array_elements(${JSON.stringify(batch)}::jsonb) e
      where c.owner_email = ${owner} and c.id = (e.value->>'id')::bigint and c.answered = 0
    `;
  }
  console.log(`re-seeded ${seeds.length.toLocaleString("en-US")} cards.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
