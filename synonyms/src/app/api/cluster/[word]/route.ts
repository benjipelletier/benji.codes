import { NextRequest, NextResponse } from 'next/server';
import { getWordCluster, storeCluster } from '../../../../../lib/db';
import { findSynonyms } from '../../../../../lib/cedict';
import { enrichCluster } from '../../../../../lib/enrichment';
import type { ClusterToStore } from '../../../../../lib/types';

export const maxDuration = 60; // Allow up to 60s for on-the-fly enrichment

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ word: string }> }
) {
  const { word } = await params;
  const simplified = decodeURIComponent(word);

  if (!simplified) {
    return NextResponse.json({ error: 'Missing word' }, { status: 400 });
  }

  // 1. Check DB cache
  try {
    const cached = await getWordCluster(simplified);
    if (cached) {
      return NextResponse.json(cached);
    }
  } catch (err) {
    console.error('DB lookup error:', err);
    // Fall through to on-the-fly build
  }

  // 2. Build on the fly
  const synonymClusters = findSynonyms(simplified);

  if (synonymClusters.length === 0) {
    return NextResponse.json(
      { error: `No synonyms found for "${simplified}" in CC-CEDICT` },
      { status: 404 }
    );
  }

  // Use the largest cluster (most connections) as the primary one
  const primaryCluster = synonymClusters.reduce((best, c) =>
    c.members.length > best.members.length ? c : best
  );

  // 3. Enrich with Claude API
  let enrichment;
  try {
    enrichment = await enrichCluster(primaryCluster);
  } catch (err) {
    console.error('Enrichment error:', err);
    // Store without enrichment — still useful
    enrichment = null;
  }

  // 4. Build ClusterToStore shape
  const clusterToStore: ClusterToStore = {
    label: primaryCluster.label,
    members: primaryCluster.members.map((m) => ({
      simplified: m.simplified,
      traditional: m.traditional,
      pinyin: m.pinyin,
      raw_glosses: m.raw_glosses,
      normalized_tokens: m.normalized_tokens,
      core_scene: enrichment?.words[m.simplified]?.core_scene,
      collocations: enrichment?.words[m.simplified]?.collocations,
    })),
    edges: primaryCluster.edges,
    situations: enrichment?.situations,
  };

  // 5. Persist to DB
  try {
    await storeCluster(clusterToStore);
  } catch (err) {
    console.error('DB store error:', err);
    // Continue — return the data even if we couldn't cache it
  }

  // 6. Re-fetch from DB to get proper IDs, or construct response from local data
  try {
    const fresh = await getWordCluster(simplified);
    if (fresh) return NextResponse.json(fresh);
  } catch (err) {
    console.error('Re-fetch error:', err);
  }

  // Fallback: build response from local data (no IDs)
  const wordData = primaryCluster.members.find((m) => m.simplified === simplified);
  const response = {
    word: {
      id: -1,
      simplified,
      pinyin_display: wordData?.pinyin ?? null,
      raw_glosses: wordData?.raw_glosses ?? [],
      core_scene: enrichment?.words[simplified]?.core_scene ?? null,
    },
    clusters: [
      {
        id: -1,
        label: primaryCluster.label,
        members: primaryCluster.members.map((m) => ({
          id: -1,
          simplified: m.simplified,
          traditional: m.traditional,
          pinyin: m.pinyin,
          pinyin_display: m.pinyin,
          raw_glosses: m.raw_glosses,
          hsk_level: null,
          core_scene: enrichment?.words[m.simplified]?.core_scene ?? null,
          collocations: (enrichment?.words[m.simplified]?.collocations ?? []).map((c) => ({
            collocation: c.phrase,
            pinyin: c.pinyin,
            gloss: c.gloss,
            weight: c.weight,
            pattern_type: c.pattern,
            shared_with_words: c.shared_with,
          })),
        })),
        edges: primaryCluster.edges,
        situations: (enrichment?.situations ?? []).map((s, i) => ({
          id: i,
          situation_en: s.scenario,
          answer_word_id: -1,
          explanation: s.why,
          example_zh: s.example_zh,
          difficulty: s.difficulty,
        })),
      },
    ],
  };

  return NextResponse.json(response);
}
