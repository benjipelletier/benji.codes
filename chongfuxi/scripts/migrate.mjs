#!/usr/bin/env node
// Apply chongfuxi/sql/*.sql to CHONGFUXI_DATABASE_URL, in filename order.
//
//   node --env-file=.env.local chongfuxi/scripts/migrate.mjs
//
// Statements are idempotent (create … if not exists, create or replace view),
// so re-running is safe and there is no migrations table to keep.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

// Same aliases the app accepts — see app/api/chongfuxi/db.ts.
const url = process.env.CHONGFUXI_DATABASE_URL || process.env.CHONGFUXI_POSTGRES_URL;
if (!url) {
  console.error("No chongfuxi database URL in the environment.");
  console.error("Looked for CHONGFUXI_DATABASE_URL and CHONGFUXI_POSTGRES_URL.");
  process.exit(1);
}

const sqlDir = join(dirname(fileURLToPath(import.meta.url)), "..", "sql");
const files = readdirSync(sqlDir).filter((f) => f.endsWith(".sql")).sort();
if (files.length === 0) {
  console.error(`No .sql files found in ${sqlDir}`);
  process.exit(1);
}

const sql = neon(url);

for (const file of files) {
  const body = readFileSync(join(sqlDir, file), "utf8");
  // Split on semicolons at end of line; the schema has no function bodies or
  // dollar-quoted strings, so this is sufficient and keeps the script trivial.
  const statements = body
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s && !s.split("\n").every((l) => l.trim().startsWith("--")));

  for (const stmt of statements) {
    try {
      await sql.query(stmt);
    } catch (e) {
      const first = stmt.split("\n").find((l) => !l.trim().startsWith("--")) ?? stmt;
      console.error(`\n✗ ${file}\n  ${first}…\n  ${e.message}`);
      process.exit(1);
    }
  }
  console.log(`✓ ${file}  (${statements.length} statement${statements.length === 1 ? "" : "s"})`);
}

const count = async (table) => (await sql.query(`select count(*)::int as n from ${table}`))[0].n;
const tables = ["chongfuxi_import", "chongfuxi_word", "chongfuxi_sentence", "chongfuxi_token", "chongfuxi_card", "chongfuxi_review"];
console.log("\nchongfuxi is ready:");
for (const t of tables) console.log(`  ${t.padEnd(20)} ${(await count(t)).toLocaleString("en-US")}`);
