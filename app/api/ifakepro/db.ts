import { neon, neonConfig, type NeonQueryFunction } from '@neondatabase/serverless';

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
