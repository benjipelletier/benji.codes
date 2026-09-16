import { neon, NeonQueryFunction } from "@neondatabase/serverless";

// Lazy so the env var isn't read at build time.
let _sql: NeonQueryFunction<false, false> | null = null;

export function getDb() {
  if (!_sql) {
    _sql = neon(process.env.LONGKU_DATABASE_URL!) as NeonQueryFunction<false, false>;
  }
  return _sql;
}

export function hasDb(): boolean {
  return Boolean(process.env.LONGKU_DATABASE_URL);
}
