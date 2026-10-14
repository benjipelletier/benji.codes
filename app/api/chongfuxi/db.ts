import { neon, NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

/**
 * Connection string. The Neon ↔ Vercel integration prefixes what it injects
 * with the store name, and this store is named CHONGFUXI, so the variable is
 * the one the repo convention expects; the POSTGRES_URL alias is the same
 * database under the integration's other name.
 */
function connectionString(): string | undefined {
  return process.env.CHONGFUXI_DATABASE_URL || process.env.CHONGFUXI_POSTGRES_URL || undefined;
}

// Lazy so the env var isn't read at build time.
let _sql: Sql | null = null;

export function getDb(): Sql {
  if (!_sql) {
    _sql = neon(connectionString()!) as Sql;
  }
  return _sql;
}

export function hasDb(): boolean {
  return Boolean(connectionString());
}
