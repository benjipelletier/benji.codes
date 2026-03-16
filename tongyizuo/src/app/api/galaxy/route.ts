// src/app/api/galaxy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export const revalidate = 3600;

function labelToHue(label: string): number {
  let h = 0;
  for (const c of label) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return h % 360;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '30', 10)));

  // 1. Fetch cluster batch
  const clusterRows = await sql`
    SELECT id, label, word_count
    FROM synonym_clusters
    ORDER BY word_count DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  if (clusterRows.rows.length === 0) {
    return NextResponse.json({ clusters: [], hasMore: false });
  }

  const clusterIds = clusterRows.rows.map((r) => r.id);

  // 2. Fetch member words with degree (synonym edge count) and core_scene
  const wordRows = await sql`
    SELECT
      cm.cluster_id,
      w.simplified,
      w.pinyin,
      w.core_scene,
      w.raw_glosses,
      (
        SELECT COUNT(*)::int FROM synonym_edges
        WHERE word1_id = w.id OR word2_id = w.id
      ) AS degree
    FROM cluster_members cm
    JOIN words w ON w.id = cm.word_id
    WHERE cm.cluster_id = ANY(${clusterIds as any}::int[])
  `;

  // 3. Fetch intra-cluster edges, aggregated per word pair with all glosses
  const edgeRows = await sql`
    SELECT
      se.cluster_id,
      w1.simplified AS source,
      w2.simplified AS target,
      array_agg(DISTINCT gt.token ORDER BY gt.token) AS glosses,
      COUNT(*)::int AS weight
    FROM synonym_edges se
    JOIN words w1 ON w1.id = se.word1_id
    JOIN words w2 ON w2.id = se.word2_id
    JOIN gloss_tokens gt ON gt.id = se.gloss_id
    WHERE se.cluster_id = ANY(${clusterIds as any}::int[])
    GROUP BY se.cluster_id, w1.simplified, w2.simplified
  `;

  // 4. Check if more clusters exist
  const countRow = await sql`SELECT COUNT(*)::int AS total FROM synonym_clusters`;
  const total = countRow.rows[0].total;
  const hasMore = offset + limit < total;

  // Assemble response
  const wordsByCluster: Record<number, typeof wordRows.rows> = {};
  for (const r of wordRows.rows) {
    if (!wordsByCluster[r.cluster_id]) wordsByCluster[r.cluster_id] = [];
    wordsByCluster[r.cluster_id].push(r);
  }

  const edgesByCluster: Record<number, typeof edgeRows.rows> = {};
  for (const r of edgeRows.rows) {
    if (!edgesByCluster[r.cluster_id]) edgesByCluster[r.cluster_id] = [];
    edgesByCluster[r.cluster_id].push(r);
  }

  const clusters = clusterRows.rows.map((c) => ({
    id: c.id,
    label: c.label,
    hue: labelToHue(c.label),
    words: (wordsByCluster[c.id] ?? []).map((w) => ({
      id: w.simplified,
      pinyin: w.pinyin ?? '',
      degree: w.degree ?? 1,
      core_scene: w.core_scene ?? null,
      raw_glosses: (w.raw_glosses as string[]) ?? [],
    })),
    edges: (edgesByCluster[c.id] ?? []).map((e) => ({
      source: e.source,
      target: e.target,
      glosses: e.glosses as string[],
      weight: e.weight,
    })),
  }));

  return NextResponse.json({ clusters, hasMore });
}
