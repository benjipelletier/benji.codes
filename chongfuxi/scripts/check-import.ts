// Run the import and unlock pipeline on a Pleco backup outside the browser.
//
//   npx tsx chongfuxi/scripts/check-import.ts path/to/backup.pqb
//
// Prints what the app would show after importing it: how the cards were
// sorted, how many texts are readable, and what to learn next. Useful for
// checking a change to the corpus or the unlock rules against real data.

import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { readPleco } from "../lib/pleco";
import { buildCorpus, defaultSettings, type Corpus, type Settings } from "../lib/corpus";
import { apply, preview, replay, suggestions, type ChongEvent, type Env } from "../lib/machine";
import { displayPinyin } from "../lib/hanzi";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("usage: check-import.ts <backup.pqb>");
  const SQL = await initSqlJs();
  const db = new SQL.Database(readFileSync(path));
  let t = Date.now();
  const snapshot = readPleco(db);
  console.log(`read ${snapshot.cards.length} cards, ${snapshot.categories.length} categories in ${Date.now() - t}ms`);

  const settings = defaultSettings(snapshot);
  const names = new Map(snapshot.categories.map((c) => [c.id, c.name]));
  console.log("\nroles:");
  for (const [id, role] of Object.entries(settings.roles)) console.log(`  ${role.padEnd(9)} ${names.get(Number(id))}`);

  const cache = new Map<string, Corpus>();
  const env: Env = {
    corpus(importId: string, s: Settings) {
      const key = `${importId}:${JSON.stringify(s)}`;
      if (!cache.has(key)) {
        const t0 = Date.now();
        cache.set(key, buildCorpus(snapshot, s));
        console.log(`  (corpus built in ${Date.now() - t0}ms)`);
      }
      return cache.get(key)!;
    },
  };

  const events: ChongEvent[] = [{ kind: "import", at: Date.now(), importId: "check", fileName: path, settings }];
  t = Date.now();
  const state = replay(events, env);
  console.log(`replayed in ${Date.now() - t}ms`);
  const { corpus, derived } = state;
  if (!corpus || !derived) throw new Error("nothing derived");

  console.log("\ncorpus:", corpus.stats);
  console.log("counts:", derived.counts);
  const byPool = new Map<number | null, { total: number; open: number }>();
  corpus.texts.forEach((text) => {
    for (const pool of text.pools.length ? text.pools : [null]) {
      const p = byPool.get(pool) ?? { total: 0, open: 0 };
      p.total++;
      if (derived.unlocked.has(text.id)) p.open++;
      byPool.set(pool, p);
    }
  });
  console.log("traditional chars mapped:", corpus.simplified.size, [...corpus.simplified].slice(0, 12).map((p) => p.join("→")).join(" "));
  console.log("\nreadable by pool:");
  for (const [pool, p] of byPool) console.log(`  ${String(names.get(pool as number) ?? pool).padEnd(20)} ${p.open} / ${p.total}`);

  const { learnNext, blockers } = suggestions(state);
  const fmt = (s: { word: string; unlocks: number; pron: string | null }) =>
    `${s.word}${s.pron ? ` ${displayPinyin(s.pron)}` : ""} ${s.unlocks}`;
  console.log("\nlearn next:", learnNext.slice(0, 15).map(fmt).join(" · "));
  console.log("other blockers:", blockers.slice(0, 15).map(fmt).join(" · "));

  // Exact effect of the top suggestion and of marking the top blocker a name.
  for (const [word, as] of [
    [learnNext[0]?.word, "known"],
    [blockers[0]?.word, "name"],
  ] as const) {
    if (!word) continue;
    t = Date.now();
    const fx = preview(state, { kind: "mark", at: Date.now(), word, as }, env);
    console.log(`\npreview: mark ${word} as ${as} → +${fx.unlocked.length} readable (${Date.now() - t}ms)`);
    for (const id of fx.unlocked.slice(0, 3)) {
      const text = corpus.texts.find((x) => x.id === id);
      console.log(`   ${text?.zh}  — ${text?.en?.slice(0, 60)}`);
    }
  }

  // Undo is just another event; marking then unmarking must land where it began.
  const marked = apply(state, { kind: "mark", at: 0, word: learnNext[0].word, as: "known" }, env);
  const back = apply(marked, { kind: "unmark", at: 0, word: learnNext[0].word }, env);
  console.log("\nmark+unmark round trip identical:", back.derived!.counts.unlocked === derived.counts.unlocked);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
