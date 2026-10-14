// Turn a stored Pleco file into rows, without a browser.
//
//   npx tsx --env-file=.env.local chongfuxi/scripts/ingest.ts [--import <id>] \
//       [--role "hsk1-4 sentences=ignore"]... [--dry-run]
//
// Does what the Import screen does once a file has been uploaded: reads the
// file back out of chongfuxi_import, sorts its categories into roles (the
// defaults, then whatever the last import used, then any --role given by
// top-level category name) and writes the words, sentences, tokens and cards.
// Without --import it takes the newest stored file.

import { neon } from "@neondatabase/serverless";
import { ingest } from "../../app/api/chongfuxi/corpus";
import type { Sql } from "../../app/api/chongfuxi/db";
import { loadDict, readPlecoBytes } from "../../app/api/chongfuxi/dictfile";
import { listImports, readImport } from "../../app/api/chongfuxi/imports";
import type { CategoryRole } from "../lib/corpus";

const ROLES: CategoryRole[] = ["words", "list", "sentences", "ignore"];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const roles: Record<string, CategoryRole> = {};
  let importId: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--role") {
      const [name, role] = (args[++i] ?? "").split("=");
      if (!name || !ROLES.includes(role as CategoryRole)) throw new Error(`--role wants "category name=${ROLES.join("|")}"`);
      roles[name] = role as CategoryRole;
    } else if (args[i] === "--import") importId = args[++i] ?? null;
  }

  const url = process.env.CHONGFUXI_DATABASE_URL || process.env.CHONGFUXI_POSTGRES_URL;
  // The same addresses, in the same order, as chongfuxi/lib/session.ts.
  const owner = process.env.CHONGFUXI_OWNER_EMAIL || process.env.LONGKU_OWNER_EMAIL || process.env.JAZZ_OWNER_EMAIL;
  if (!url) throw new Error("No chongfuxi database URL in the environment.");
  if (!owner) throw new Error("No owner in the environment (CHONGFUXI_OWNER_EMAIL, or the 龙库 or jazz one).");
  const sql = neon(url) as Sql;

  // Pleco files only: sentences from other decks have their own script.
  const stored = (await listImports(sql, owner)).filter((i) => i.complete && i.format !== "anki");
  const imp = importId ? stored.find((i) => i.id === importId) : stored[stored.length - 1];
  if (!imp) throw new Error(importId ? `No stored file with id ${importId}.` : "No file has been stored yet.");

  let t = Date.now();
  const bytes = await readImport(sql, owner, imp);
  const { format, snapshot } = await readPlecoBytes(bytes);
  console.log(`${imp.fileName} (.${format}, ${(bytes.byteLength / 1048576).toFixed(1)} MB) read back in ${Date.now() - t}ms`);
  const dict = loadDict();
  console.log(`dictionary: ${dict.size.toLocaleString("en-US")} entries`);

  t = Date.now();
  const summary = await ingest(sql, owner, snapshot, { importId: imp.id, fileName: imp.fileName }, dict, {
    roles,
    dryRun,
    log: (line) => console.log(`  ${line}`),
  });
  console.log(`\n${dryRun ? "would give" : "done"} in ${((Date.now() - t) / 1000).toFixed(1)}s:`);
  console.log("  roles:", Object.entries(summary.roles).map(([n, r]) => `${n}=${r}`).join(", "));
  console.log("  words:", { ...summary.words, sample: summary.words.sample.slice(0, 8).join(" ") });
  console.log("  sentences:", summary.sentences);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
