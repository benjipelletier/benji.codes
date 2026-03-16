import { NextRequest, NextResponse } from 'next/server';
import { getWordCluster } from '../../../../../lib/db';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ word: string }> }
) {
  const { word } = await params;
  const simplified = decodeURIComponent(word);

  if (!simplified) {
    return NextResponse.json({ error: 'Missing word' }, { status: 400 });
  }

  let cached;
  try {
    cached = await getWordCluster(simplified);
  } catch (err) {
    console.error('DB lookup error:', err);
    const msg = String(err ?? '');
    if (msg.includes('missing_connection_string') || msg.includes('POSTGRES_URL')) {
      return NextResponse.json(
        { error: 'Database not configured (missing POSTGRES_URL).' },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  if (!cached) {
    return NextResponse.json(
      { error: `"${simplified}" not found — run the seed script to populate the database` },
      { status: 404 }
    );
  }

  return NextResponse.json(cached);
}
