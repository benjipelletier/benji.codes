import { NextResponse } from 'next/server';
import { getDb } from '../db';
import { APP_VERSION, ensureTrainer } from '../schema';

export const dynamic = 'force-dynamic';

/**
 * The latest Voiceshed deployed, as the database has it (written by the first production run
 * of each version), and this server's own build. The app compares them with the build it's
 * running to say whether it's up to date.
 */
export async function GET() {
  let latest: { version: string; commit: string; at: string } | null = null;
  try {
    const sql = getDb();
    await ensureTrainer(sql);
    const rows = (await sql`SELECT value FROM voiceshed_meta WHERE key = 'app_version'`) as { value: string }[];
    if (rows[0]) latest = JSON.parse(rows[0].value);
  } catch {
    // No database (or it's down): the server's own build still says what's deployed.
  }
  return NextResponse.json({ latest, server: APP_VERSION }, { headers: { 'Cache-Control': 'no-store' } });
}
