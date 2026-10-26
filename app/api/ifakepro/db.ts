import { neon, neonConfig, type NeonQueryFunction } from '@neondatabase/serverless';
import { MIGRATIONS, schemaStatements } from '@ifakepro/db/schema';

let _sql: NeonQueryFunction<false, false> | null = null;

export function getDb() {
  if (!_sql) {
    // Local development against a plain Postgres, through a Neon HTTP proxy
    // (e.g. local-neon-http-proxy): point the driver at it.
    if (process.env.IFAKEPRO_NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.IFAKEPRO_NEON_FETCH_ENDPOINT;
    _sql = neon(process.env.IFAKEPRO_DATABASE_URL!) as NeonQueryFunction<false, false>;
  }
  return _sql;
}

export type Sql = ReturnType<typeof getDb>;

let ready: Promise<void> | null = null;

/**
 * Create the tables if this database has none yet, and add columns newer
 * than it, once per server instance: a new database works without running
 * setup-db.ts first. The check is one cheap query; the statements are all
 * IF NOT EXISTS.
 */
export function ensureSchema(): Promise<void> {
  ready ??= (async () => {
    const sql = getDb();
    const rows = await sql`
      SELECT to_regclass('public.ifp_presence') IS NOT NULL AS ok,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ifp_versions' AND column_name = 'note') AS current`;
    if (rows[0]?.ok && rows[0]?.current) return;
    if (rows[0]?.ok) {
      await sql.transaction(MIGRATIONS.map((s) => sql.query(s)));
      console.log('[ifakepro] added the new columns');
      return;
    }
    await sql.transaction(schemaStatements().map((s) => sql.query(s)));
    console.log('[ifakepro] created the tables');
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
