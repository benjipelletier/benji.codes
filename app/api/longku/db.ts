import { neon, NeonQueryFunction } from "@neondatabase/serverless";

/**
 * 龙库's database is 重复习's: its tables (longku_bank, longku_review,
 * longku_sweep, longku_excluded) live beside the deck they are linked to (see
 * app/api/chongfuxi/longku.ts). Its own old store, LONGKU_DATABASE_*, is no
 * longer read; it holds the data as it was before the move.
 */
function connectionString(): string | undefined {
  return process.env.CHONGFUXI_DATABASE_URL || undefined;
}

// Lazy so the env var isn't read at build time.
let _sql: NeonQueryFunction<false, false> | null = null;

export function getDb() {
  if (!_sql) {
    _sql = neon(connectionString()!) as NeonQueryFunction<false, false>;
  }
  return _sql;
}

export function hasDb(): boolean {
  return Boolean(connectionString());
}
