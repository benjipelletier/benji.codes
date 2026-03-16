import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

export async function GET() {
  try {
    // 1. Top words by synonym edge degree
    const degreeRows = await sql`
      SELECT word_id, SUM(cnt)::int AS degree FROM (
        SELECT word1_id AS word_id, COUNT(*)::int AS cnt FROM synonym_edges GROUP BY word1_id
        UNION ALL
        SELECT word2_id AS word_id, COUNT(*)::int AS cnt FROM synonym_edges GROUP BY word2_id
      ) t GROUP BY word_id ORDER BY degree DESC LIMIT 200
    `;

    if (degreeRows.rows.length === 0) {
      // DB is reachable, just not seeded yet (or empty dataset)
      return NextResponse.json({ nodes: [], links: [] });
    }

    const ids = degreeRows.rows.map((r) => r.word_id);
    const degreeMap: Record<number, number> = {};
    for (const r of degreeRows.rows) degreeMap[r.word_id] = r.degree;

    // 2. Word details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wordRows = await sql`
      SELECT id, simplified, pinyin
      FROM words
      WHERE id = ANY(${ids as any}::int[])
    `;

    // 3. Edges between those words
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgeRows = await sql`
      SELECT word1_id, word2_id, COUNT(*)::int AS weight
      FROM synonym_edges
      WHERE word1_id = ANY(${ids as any}::int[]) AND word2_id = ANY(${ids as any}::int[])
      GROUP BY word1_id, word2_id
    `;

    // 4. Primary cluster label per word
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clusterRows = await sql`
      SELECT DISTINCT ON (cm.word_id) cm.word_id, sc.label
      FROM cluster_members cm
      JOIN synonym_clusters sc ON sc.id = cm.cluster_id
      WHERE cm.word_id = ANY(${ids as any}::int[])
      ORDER BY cm.word_id, sc.word_count DESC
    `;

    const clusterMap: Record<number, string> = {};
    for (const r of clusterRows.rows) clusterMap[r.word_id] = r.label;

    const nodes = wordRows.rows.map((w) => ({
      id: w.simplified,
      pinyin: w.pinyin ?? '',
      degree: degreeMap[w.id] ?? 1,
      cluster: clusterMap[w.id] ?? '',
    }));

    const simplifiedById: Record<number, string> = {};
    for (const w of wordRows.rows) simplifiedById[w.id] = w.simplified;

    const links = edgeRows.rows
      .filter((e) => simplifiedById[e.word1_id] && simplifiedById[e.word2_id])
      .map((e) => ({
        source: simplifiedById[e.word1_id],
        target: simplifiedById[e.word2_id],
        weight: e.weight,
      }));

    return NextResponse.json({ nodes, links });
  } catch (err) {
    console.error('Graph DB error:', err);
    const msg = String((err as any)?.message ?? err ?? '');
    if (msg.includes('missing_connection_string') || msg.includes('POSTGRES_URL')) {
      return NextResponse.json(
        { error: 'Database not configured (missing POSTGRES_URL).', nodes: [], links: [] },
        { status: 500 }
      );
    }
    if (msg.includes('ENOTFOUND') || msg.toLowerCase().includes('fetch failed')) {
      return NextResponse.json(
        { error: 'Database unreachable (network/DNS).', nodes: [], links: [] },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: 'Database error while building graph.', nodes: [], links: [] },
      { status: 500 }
    );
  }
}
