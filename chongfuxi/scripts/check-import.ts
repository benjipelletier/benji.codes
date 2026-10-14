// Run the reading and sorting of a Pleco file outside the browser and the database.
//
//   npx tsx chongfuxi/scripts/check-import.ts path/to/backup.pqb
//   npx tsx chongfuxi/scripts/check-import.ts path/to/export.xml
//
// Prints what the file turns into: how its categories were taken, how the
// cards were sorted, how many sentences are readable, and what blocks the
// rest. Writes nothing. Useful for checking a change to the corpus or the
// unlock rules against real data before an import.

import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { readBackup } from "../lib/backup";
import { buildCorpus, defaultSettings } from "../lib/corpus";
import { makeUnlock } from "../lib/unlock";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: check-import.ts <backup.pqb | export.xml>");
  let t = Date.now();
  const { format, snapshot } = await readBackup(new Uint8Array(readFileSync(path)), () => initSqlJs());
  console.log(`read ${snapshot.cards.length} cards, ${snapshot.categories.length} categories from a .${format} in ${Date.now() - t}ms`);

  const settings = defaultSettings(snapshot);
  const names = new Map(snapshot.categories.map((c) => [c.id, c.name]));
  console.log("\nroles:");
  for (const [id, role] of Object.entries(settings.roles)) console.log(`  ${role.padEnd(9)} ${names.get(Number(id))}`);

  t = Date.now();
  const corpus = buildCorpus(snapshot, settings);
  console.log(`\ncorpus built in ${Date.now() - t}ms:`, corpus.stats);

  const deck = [...corpus.words.values()].filter((w) => w.known);
  const unlock = makeUnlock(new Set(deck.map((w) => w.w)), new Set(corpus.words.keys()));
  const sole = new Map<string, number>();
  let readable = 0;
  let oneAway = 0;
  for (const text of corpus.texts) {
    const blockers = unlock.blockersOf(text.words);
    if (blockers.length === 0) readable++;
    else if (blockers.length === 1) {
      oneAway++;
      sole.set(blockers[0], (sole.get(blockers[0]) ?? 0) + 1);
    }
  }
  console.log(`\ndeck: ${deck.length} words (${deck.filter((w) => w.pleco).length} with a Pleco score)`);
  console.log(`sentences: ${corpus.texts.length} — ${readable} readable, ${oneAway} one word away`);
  const top = [...sole].sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log("blocking the most on their own:", top.map(([w, n]) => `${w} ${n}`).join(" · "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
