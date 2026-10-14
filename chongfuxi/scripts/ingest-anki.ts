// Add the sentences of an Anki deck to the corpus. Sentences only, never words.
//
//   npx tsx --env-file=.env.local chongfuxi/scripts/ingest-anki.ts <deck.apkg | collection.anki21> [--dry-run]
//
// An .apkg is a zip of the collection (SQLite) and its media. Only the
// collection is read; an .apkg has it pulled out with `unzip` first. Without
// --dry-run the collection is also stored whole, like a Pleco file, as the
// record of where these sentences came from.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import { neon } from "@neondatabase/serverless";
import initSqlJs from "sql.js";
import { ingestSentences } from "../../app/api/chongfuxi/corpus";
import type { Sql } from "../../app/api/chongfuxi/db";
import { loadDict } from "../../app/api/chongfuxi/dictfile";
import { createImport, putChunk } from "../../app/api/chongfuxi/imports";
import { readAnkiSentences } from "../lib/anki";
import { CHUNK_BYTES, newId } from "../lib/upload";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const path = args.find((a) => !a.startsWith("--"));
  if (!path) throw new Error("usage: ingest-anki.ts <deck.apkg | collection.anki21> [--dry-run]");

  const url = process.env.CHONGFUXI_DATABASE_URL || process.env.CHONGFUXI_POSTGRES_URL;
  // The same addresses, in the same order, as chongfuxi/lib/session.ts.
  const owner = process.env.CHONGFUXI_OWNER_EMAIL || process.env.LONGKU_OWNER_EMAIL || process.env.JAZZ_OWNER_EMAIL;
  if (!url) throw new Error("No chongfuxi database URL in the environment.");
  if (!owner) throw new Error("No owner in the environment (CHONGFUXI_OWNER_EMAIL, or the 龙库 or jazz one).");
  const sql = neon(url) as Sql;

  let collection = path;
  let scratch: string | null = null;
  if (/\.apkg$/i.test(path)) {
    // Newer Anki writes collection.anki21; older decks only have collection.anki2.
    scratch = mkdtempSync(join(tmpdir(), "chongfuxi-anki-"));
    const names = execFileSync("unzip", ["-Z1", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n");
    const entry = names.includes("collection.anki21") ? "collection.anki21" : "collection.anki2";
    execFileSync("unzip", ["-o", "-q", path, entry, "-d", scratch]);
    collection = join(scratch, entry);
  }

  try {
    const bytes = readFileSync(collection);
    const SQL = await initSqlJs();
    const db = new SQL.Database(new Uint8Array(bytes));
    const read = readAnkiSentences(db);
    db.close();
    console.log(`${basename(path)}: ${read.notes.toLocaleString("en-US")} notes, ${read.sentences.length.toLocaleString("en-US")} sentences among them`);

    const importId = newId();
    if (!dryRun) {
      const packed = gzipSync(bytes);
      const chunks = Math.ceil(packed.byteLength / CHUNK_BYTES);
      await createImport(sql, owner, {
        id: importId,
        at: Date.now(),
        fileName: basename(path),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        format: "anki",
        encoding: "gzip",
        bytes: bytes.byteLength,
        chunks,
      });
      for (let i = 0; i < chunks; i++) await putChunk(sql, owner, importId, i, new Uint8Array(packed.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)));
      console.log(`collection stored (${(packed.byteLength / 1048576).toFixed(1)} MB gzipped, ${chunks} chunks)`);
    }

    const t = Date.now();
    const out = await ingestSentences(sql, owner, read.sentences, loadDict(), {
      importId,
      dryRun,
      samples: 14,
      log: (line) => console.log(`  ${line}`),
    });
    if (!dryRun) await sql`update chongfuxi_import set ingested = now() where owner_email = ${owner} and id = ${importId}`;

    console.log(`\n${dryRun ? "would add" : "added"} (${((Date.now() - t) / 1000).toFixed(1)}s):`);
    console.table({ ...out.bySource, TOTAL: out.total });
    console.log("a few of the new ones, as they were split:");
    for (const s of out.samples) console.log(`  ${s.zh}\n      ${s.words.join(" ")}  [${s.split}]  ${s.blockers.length ? "blocked by " + s.blockers.join(" ") : "readable"}`);
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
