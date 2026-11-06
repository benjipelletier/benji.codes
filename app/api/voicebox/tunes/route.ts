import { NextResponse } from 'next/server';
import { getDb } from '../../jazz/db';

export const dynamic = 'force-dynamic';

// Every jazz standard's changes (read from the jazz app's database), compact, for practising a tune's voicings
// offline: chart symbols in order, a chord held into the next bar written
// once.
export async function GET() {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, title, composer, home_key, is_minor, chart_data
    FROM standards ORDER BY title
  `) as { id: string; title: string; composer: string | null; home_key: number; is_minor: boolean; chart_data: (string | null)[][] }[];
  const tunes = rows.map(r => {
    const chords: string[] = [];
    for (const bar of r.chart_data ?? []) {
      for (const c of bar ?? []) {
        if (!c || c === 'N.C.' || c === 'NC') continue;
        if (chords[chords.length - 1] !== c) chords.push(c);
      }
    }
    return { id: r.id, title: r.title, composer: r.composer, home_key: r.home_key, is_minor: r.is_minor, chords };
  });
  return NextResponse.json({ at: new Date().toISOString(), tunes });
}
