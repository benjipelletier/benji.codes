import { neon, NeonQueryFunction } from '@neondatabase/serverless';

let _sql: NeonQueryFunction<false, false> | null = null;

/**
 * Voicebox's own store when VOICEBOX_DATABASE_URL is set; until then it
 * lives in the jazz database, beside the standards it reads tunes from.
 */
export function getDb() {
  if (!_sql) {
    _sql = neon((process.env.VOICEBOX_DATABASE_URL || process.env.JAZZ_DATABASE_URL)!) as NeonQueryFunction<false, false>;
  }
  return _sql;
}
