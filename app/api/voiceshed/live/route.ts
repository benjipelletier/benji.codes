import { NextResponse } from 'next/server';
import { getDb } from '../db';
import { BUILD, ensureTrainer } from '../schema';

export const dynamic = 'force-dynamic';

/**
 * The newest push the database has seen (written by each production build's first run), and
 * this server's own build. The app compares them with the build it's running: live, or a
 * newer push to reload into.
 */
export async function GET() {
  let latest: { build: string; built_at: string; at: string } | null = null;
  try {
    const sql = getDb();
    await ensureTrainer(sql);
    const rows = (await sql`SELECT value FROM voiceshed_meta WHERE key = 'live_build'`) as { value: string }[];
    if (rows[0]) latest = JSON.parse(rows[0].value);
  } catch {
    // No database (or it's down): the server's own build still says what's deployed.
  }
  return NextResponse.json({ latest, server: BUILD }, { headers: { 'Cache-Control': 'no-store' } });
}
