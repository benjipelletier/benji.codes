// Create iFake Pro's tables. Idempotent. The API also does this by itself the
// first time it meets an empty database, so this is only needed to set up ahead.
//   IFAKEPRO_DATABASE_URL=postgres://… npx tsx ifakepro/scripts/setup-db.ts

import { neon, neonConfig } from '@neondatabase/serverless';
import { schemaStatements } from '../db/schema';

const url = process.env.IFAKEPRO_DATABASE_URL;
if (!url) {
  console.error('IFAKEPRO_DATABASE_URL is not set');
  process.exit(1);
}
if (process.env.IFAKEPRO_NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.IFAKEPRO_NEON_FETCH_ENDPOINT;

const sql = neon(url);
const statements = schemaStatements();

(async () => {
  for (const s of statements) await sql.query(s);
  console.log(`applied ${statements.length} statements`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
