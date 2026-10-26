// Create iFake Pro's tables. Idempotent: run it again after schema changes.
//   IFAKEPRO_DATABASE_URL=postgres://… npx tsx ifakepro/scripts/setup-db.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon, neonConfig } from '@neondatabase/serverless';

const url = process.env.IFAKEPRO_DATABASE_URL;
if (!url) {
  console.error('IFAKEPRO_DATABASE_URL is not set');
  process.exit(1);
}
if (process.env.IFAKEPRO_NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.IFAKEPRO_NEON_FETCH_ENDPOINT;

const sql = neon(url);
const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
// One statement per request: the HTTP driver runs a single statement at a time.
const statements = schema
  .replace(/--.*$/gm, '')
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter(Boolean);

(async () => {
  for (const s of statements) await sql.query(s);
  console.log(`applied ${statements.length} statements`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
