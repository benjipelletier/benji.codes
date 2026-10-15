#!/usr/bin/env node
// Copy 龙库's data from its old database (LONGKU_DATABASE_*) into 重复习's
// (CHONGFUXI_DATABASE_URL), where 龙库 now lives.
//
//   node --env-file=.env.local longku/scripts/move-to-chongfuxi.mjs [--dry-run]
//
// Safe to run more than once: bank rows are upserted, but a row already in
// 重复习 that was played more recently than the old copy is left alone;
// review rows are added only if the same (word, time, outcome) isn't there;
// the sweep is taken only if newer. The old database is only read.
// Run longku/scripts/migrate.mjs first, then chongfuxi/scripts/link-longku.ts.

import { neon } from "@neondatabase/serverless";

const from =
  process.env.LONGKU_DATABASE_URL || process.env.LONGKU_DATABASE_DATABASE_URL || process.env.LONGKU_DATABASE_POSTGRES_URL;
const to = process.env.CHONGFUXI_DATABASE_URL;
const owner = process.env.LONGKU_OWNER_EMAIL;
const dry = process.argv.includes("--dry-run");
if (!from || !to || !owner) {
  console.error("Needs the old longku database URL, CHONGFUXI_DATABASE_URL and LONGKU_OWNER_EMAIL.");
  process.exit(1);
}
const old = neon(from);
const now = neon(to);

const bank = await old.query(`select * from longku_bank where owner_email = $1`, [owner]);
const reviews = await old.query(`select owner_email, w, at, outcome from longku_review where owner_email = $1`, [owner]);
const sweep = await old.query(`select owner_email, chains, updated from longku_sweep where owner_email = $1`, [owner]);
console.log(`old database: ${bank.length} bank rows, ${reviews.length} reviews, ${sweep.length} sweep`);
if (dry) process.exit(0);

const cols = ["owner_email", "w", "fs", "ls", "f", "recalls", "added", "last_recalled", "in_sweep", "strength", "misses", "last_seen", "due"];
const r1 = await now.query(
  `insert into longku_bank (${cols.join(", ")})
   select ${cols.map((c) => `x.${c}`).join(", ")}
   from jsonb_populate_recordset(null::longku_bank, $1::jsonb) x
   on conflict (owner_email, w) do update set
     ${cols.filter((c) => c !== "owner_email" && c !== "w").map((c) => `${c} = excluded.${c}`).join(", ")}
   where longku_bank.last_seen is null or excluded.last_seen >= longku_bank.last_seen
   returning w`,
  [JSON.stringify(bank)],
);
const r2 = await now.query(
  `insert into longku_review (owner_email, w, at, outcome)
   select x.owner_email, x.w, x.at, x.outcome
   from jsonb_populate_recordset(null::longku_review, $1::jsonb) x
   where not exists (
     select 1 from longku_review r where r.owner_email = x.owner_email and r.w = x.w and r.at = x.at and r.outcome = x.outcome
   )
   returning w`,
  [JSON.stringify(reviews)],
);
let swept = 0;
for (const s of sweep) {
  const r = await now.query(
    `insert into longku_sweep (owner_email, chains, updated) values ($1, $2::jsonb, $3)
     on conflict (owner_email) do update set chains = excluded.chains, updated = excluded.updated
     where longku_sweep.updated <= excluded.updated
     returning owner_email`,
    [s.owner_email, JSON.stringify(s.chains), s.updated],
  );
  swept += r.length;
}
console.log(`copied: ${r1.length} bank rows, ${r2.length} new reviews, ${swept} sweep`);
