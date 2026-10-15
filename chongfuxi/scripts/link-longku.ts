// After 龙库's data is in this database (longku/scripts/move-to-chongfuxi.mjs):
// put 龙库's words that aren't deck words yet into the deck, as one addition
// (source "longku") whose Read cards start from 龙库's record of each, then
// link every deck chengyu 龙库 lacks.
//
//   npx tsx --env-file=.env.local chongfuxi/scripts/link-longku.ts [--dry-run]
//
// Safe to run again: words already in the deck are passed over, and linking
// only adds what is missing.

import { getDb } from "../../app/api/chongfuxi/db";
import { addWords } from "../../app/api/chongfuxi/additions";
import { loadDict } from "../../app/api/chongfuxi/dictfile";
import { reconcileLongku, seedFromLongku } from "../../app/api/chongfuxi/longku";
import { lookupWord } from "@longku/lib/data";

async function main() {
  const sql = getDb();
  // As the app decides it (chongfuxi/lib/session.ts, which scripts can't import).
  const owner = process.env.CHONGFUXI_OWNER_EMAIL || process.env.LONGKU_OWNER_EMAIL || process.env.JAZZ_OWNER_EMAIL;
  if (!owner) throw new Error("no owner configured");
  const dry = process.argv.includes("--dry-run");
  const at = Date.now();

  const rows = (await sql`
    select b.w, b.strength, b.recalls, b.misses,
           (extract(epoch from b.added) * 1000)::double precision as added,
           (extract(epoch from b.last_recalled) * 1000)::double precision as last_recalled,
           (extract(epoch from b.last_seen) * 1000)::double precision as last_seen,
           w.status
    from longku_bank b
    left join chongfuxi_word w on w.owner_email = b.owner_email and w.word = b.w
    where b.owner_email = ${owner}
  `) as unknown as Array<{
    w: string;
    strength: number;
    recalls: number;
    misses: number;
    added: number;
    last_recalled: number | null;
    last_seen: number | null;
    status: string | null;
  }>;
  const toAdd = rows.filter((r) => r.status !== "deck");
  const seeds = new Map(
    toAdd.map((r) => [
      r.w,
      seedFromLongku(
        { strength: r.strength, recalls: r.recalls, misses: r.misses, added: r.added, lastRecalled: r.last_recalled, lastSeen: r.last_seen },
        at,
      ),
    ]),
  );
  const deck = (await sql`select word from chongfuxi_word where owner_email = ${owner} and status = 'deck'`) as unknown as Array<{ word: string }>;
  const linked = new Set(rows.map((r) => r.w));
  const deckChengyu = deck.filter((d) => !linked.has(d.word) && lookupWord(d.word));

  const seeded = [...seeds.values()].filter((s) => s.state !== 0);
  console.log(`龙库 bank: ${rows.length} words, ${rows.length - toAdd.length} already in the deck`);
  console.log(`to add to the deck: ${toAdd.length} (${toAdd.filter((r) => r.status === "listed").length} from a list, ${toAdd.filter((r) => !r.status).length} new to the corpus)`);
  console.log(`  cards seeded from 龙库: ${seeded.length}, new: ${toAdd.length - seeded.length}; stability ${[...new Set(seeded.map((s) => s.stability))].sort((a, b) => a - b).join("/")} days`);
  console.log(`deck chengyu to link into 龙库: ${deckChengyu.length}: ${deckChengyu.map((d) => d.word).join(" ")}`);
  if (dry) return;

  const addition = await addWords(sql, owner, "longku", toAdd.map((r) => r.w), loadDict(), at, seeds);
  const after = await reconcileLongku(sql, owner);
  console.log(`added to the deck: ${addition?.added.length ?? 0} (addition ${addition?.id ?? "none"}, ${addition?.unlocked ?? 0} sentences unlocked)`);
  console.log(`linked into 龙库 since: ${after.linked.length}, unlinked: ${after.unlinked.length}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
