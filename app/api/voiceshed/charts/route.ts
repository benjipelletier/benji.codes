import { NextResponse } from 'next/server';
import { getDb } from '../../ifakepro/db';
import { getViewer, ownerEmail } from '@voiceshed/lib/session';
import { loadCharts } from '../charts';

export const dynamic = 'force-dynamic';

// The owner's iFake Pro playlists as tunes for Practice (see ../charts.ts).
export async function GET() {
  const at = new Date().toISOString();
  const owner = ownerEmail();
  if (!owner || !process.env.IFAKEPRO_DATABASE_URL) return NextResponse.json({ at, playlists: [] });
  const viewer = await getViewer();
  try {
    return NextResponse.json({ at, playlists: await loadCharts(getDb(), owner, viewer.isOwner) });
  } catch (err) {
    // No iFake Pro tables in that database yet: nothing to show.
    if (/does not exist/.test(String((err as Error).message))) return NextResponse.json({ at, playlists: [] });
    throw err;
  }
}
