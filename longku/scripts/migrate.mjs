#!/usr/bin/env node
// Apply longku/sql/*.sql to 龙库's database, in filename order.
//
// 龙库 is backed by 重复习: its tables live in CHONGFUXI_DATABASE_URL (see
// app/api/longku/db.ts). Statements are idempotent (create table if not
// exists / create index if not exists), so re-running is safe and there is
// no migrations table to keep.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const url = process.env.CHONGFUXI_DATABASE_URL;
if (!url) {
  console.error("No CHONGFUXI_DATABASE_URL in the environment: 龙库's tables live in 重复习's database.");
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
      console.error(`\n✗ ${file}\n  ${stmt.split("\n")[0]}…\n  ${e.message}`);
      process.exit(1);
    }
  }
  console.log(`✓ ${file}  (${statements.length} statement${statements.length === 1 ? "" : "s"})`);
}

const [{ count }] = await sql`select count(*)::int as count from longku_bank`;
console.log(`\nlongku_bank is ready — ${count} row${count === 1 ? "" : "s"}.`);
