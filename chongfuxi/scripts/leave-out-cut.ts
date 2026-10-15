// Take out of the corpus the sentences whose Pleco card is cut short (its
// pinyin runs on past its characters: lib/corpus.ts, cutShort). Imports leave
// those out now; this takes out the ones an earlier import brought in. A
// sentence that another deck also has, as the same characters, stays.
//
//   npx tsx --env-file=.env.local chongfuxi/scripts/leave-out-cut.ts [--dry-run]

import { getDb } from "../../app/api/chongfuxi/db";
import { leaveOutSentences } from "../../app/api/chongfuxi/corpus";
import { readPlecoBytes } from "../../app/api/chongfuxi/dictfile";
import { listImports, readImport } from "../../app/api/chongfuxi/imports";
import { cutShort, topLevelMap } from "../lib/corpus";
import { cleanHeadword, isHan } from "../lib/hanzi";

const owner = process.env.CHONGFUXI_OWNER_EMAIL || process.env.LONGKU_OWNER_EMAIL || process.env.JAZZ_OWNER_EMAIL;
if (!owner) throw new Error("No owner in the environment (CHONGFUXI_OWNER_EMAIL).");
const dry = process.argv.includes("--dry-run");
const sql = getDb();

async function main() {
  const imp = (await listImports(sql, owner!)).filter((i) => i.complete && i.format === "pqb").pop();
  if (!imp) throw new Error("No Pleco backup stored.");
  const { snapshot } = await readPlecoBytes(await readImport(sql, owner!, imp));
  const top = topLevelMap(snapshot.categories);
  const nameOf = new Map(snapshot.categories.map((c) => [c.id, c.name]));
  const cut = snapshot.cards.filter((c) => cutShort(c.hw, c.pron));
  // Each cut card's characters, and the decks it is filed in (a sentence's sources are deck names).
  const decks = new Map<string, Set<string>>();
  for (const c of cut) {
    const key = [...cleanHeadword(c.hw)].filter(isHan).join("");
    const set = decks.get(key) ?? new Set<string>();
    for (const cat of c.cats) set.add(nameOf.get(top.get(cat) ?? cat) ?? "");
    decks.set(key, set);
  }
  const rows = (await sql`
    select id::int as id, key, zh, sources from chongfuxi_sentence
    where owner_email = ${owner!} and key = any(${[...decks.keys()]}::text[])
  `) as unknown as Array<{ id: number; key: string; zh: string; sources: string[] }>;
  // Only where every deck it came from is one of the cut card's: another deck's copy is whole.
  const out = rows.filter((r) => r.sources.every((s) => decks.get(r.key)!.has(s)));
  const kept = rows.filter((r) => !out.includes(r));
  console.log(`${cut.length} cut-short cards in ${imp.fileName}; ${rows.length} stored sentences have their characters`);
  if (kept.length) console.log(`kept, also from another deck: ${kept.map((r) => `${r.zh} (${r.sources.join(", ")})`).join(" | ")}`);
  console.log(`${dry ? "would take out" : "taking out"} ${out.length}: ${out.map((r) => r.zh).join(" | ")}`);
  if (!dry) console.log(`taken out: ${await leaveOutSentences(sql, owner!, out.map((r) => r.id), "cut short")}`);
}

main().then(() => process.exit(0));
