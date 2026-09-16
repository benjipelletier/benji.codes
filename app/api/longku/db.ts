import { neon, NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Connection string, however it got here.
 *
 * The Neon ↔ Vercel integration prefixes every variable it injects with the
 * store name, so a store called LONGKU_DATABASE yields LONGKU_DATABASE_DATABASE_URL
 * rather than the LONGKU_DATABASE_URL the repo convention would suggest.
 * Accept both, plus the POSTGRES_URL alias, so wiring this up doesn't depend on
 * having renamed anything by hand.
 */
function connectionString(): string | undefined {
  return (
    process.env.LONGKU_DATABASE_URL ||
    process.env.LONGKU_DATABASE_DATABASE_URL ||
    process.env.LONGKU_DATABASE_POSTGRES_URL ||
    undefined
  );
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
