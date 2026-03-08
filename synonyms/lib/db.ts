import { sql } from '@vercel/postgres';
import type { ClusterResponse, ClusterToStore } from './types';

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getWordCluster(simplified: string): Promise<ClusterResponse | null> {
  // Find the word
  const wordRows = await sql`
    SELECT id, simplified, traditional, pinyin, pinyin_display, raw_glosses, hsk_level, core_scene
    FROM words
    WHERE simplified = ${simplified}
    LIMIT 1
  `;

  if (wordRows.rows.length === 0) return null;
  const word = wordRows.rows[0];

  // Find clusters this word belongs to
  const clusterRows = await sql`
    SELECT sc.id, sc.label
    FROM synonym_clusters sc
    JOIN cluster_members cm ON cm.cluster_id = sc.id
    WHERE cm.word_id = ${word.id}
  `;

  if (clusterRows.rows.length === 0) return null;

  const clusters = await Promise.all(
    clusterRows.rows.map(async (cluster) => {
      // Get all members of this cluster
      const memberRows = await sql`
        SELECT w.id, w.simplified, w.traditional, w.pinyin, w.pinyin_display,
               w.raw_glosses, w.hsk_level, w.core_scene
        FROM words w
        JOIN cluster_members cm ON cm.word_id = w.id
        WHERE cm.cluster_id = ${cluster.id}
      `;

      // Get collocations for each member (with sharing info)
      const memberIds = memberRows.rows.map((m) => m.id);
      const collRows = memberIds.length > 0
        ? await sql`
            SELECT c.id, c.word_id, c.collocation, c.pinyin, c.gloss, c.weight,
                   c.pattern_type,
                   COALESCE(
                     array_agg(w2.simplified) FILTER (WHERE w2.simplified IS NOT NULL),
                     '{}'
                   ) AS shared_with_words
            FROM collocations c
            LEFT JOIN collocation_sharing cs ON cs.collocation_id = c.id
            LEFT JOIN words w2 ON w2.id = cs.also_word_id
            WHERE c.word_id = ANY(${memberIds}::int[])
            GROUP BY c.id, c.word_id, c.collocation, c.pinyin, c.gloss, c.weight, c.pattern_type
            ORDER BY c.weight DESC
          `
        : { rows: [] };

      // Group collocations by word_id
      const collByWord: Record<number, typeof collRows.rows> = {};
      for (const row of collRows.rows) {
        if (!collByWord[row.word_id]) collByWord[row.word_id] = [];
        collByWord[row.word_id].push(row);
      }

      // Get edges for this cluster
      const edgeRows = await sql`
        SELECT w1.simplified AS word1, w2.simplified AS word2, gt.token AS gloss
        FROM synonym_edges se
        JOIN words w1 ON w1.id = se.word1_id
        JOIN words w2 ON w2.id = se.word2_id
        JOIN gloss_tokens gt ON gt.id = se.gloss_id
        WHERE se.cluster_id = ${cluster.id}
      `;

      // Get situations for this cluster
      const situationRows = await sql`
        SELECT id, situation_en, answer_word_id, explanation, example_zh, difficulty
        FROM situations
        WHERE cluster_id = ${cluster.id}
        ORDER BY difficulty ASC
      `;

      const members = memberRows.rows.map((m) => ({
        id: m.id,
        simplified: m.simplified,
        traditional: m.traditional,
        pinyin: m.pinyin,
        pinyin_display: m.pinyin_display,
        raw_glosses: m.raw_glosses,
        hsk_level: m.hsk_level,
        core_scene: m.core_scene,
        collocations: (collByWord[m.id] || []).map((c) => ({
          collocation: c.collocation,
          pinyin: c.pinyin,
          gloss: c.gloss,
          weight: parseFloat(c.weight),
          pattern_type: c.pattern_type,
          shared_with_words: c.shared_with_words || [],
        })),
      }));

      return {
        id: cluster.id,
        label: cluster.label,
        members,
        edges: edgeRows.rows.map((e) => ({
          word1: e.word1,
          word2: e.word2,
          gloss: e.gloss,
        })),
        situations: situationRows.rows.map((s) => ({
          id: s.id,
          situation_en: s.situation_en,
          answer_word_id: s.answer_word_id,
          explanation: s.explanation,
          example_zh: s.example_zh,
          difficulty: s.difficulty,
        })),
      };
    })
  );

  return {
    word: {
      id: word.id,
      simplified: word.simplified,
      pinyin_display: word.pinyin_display,
      raw_glosses: word.raw_glosses,
      core_scene: word.core_scene,
    },
    clusters,
  };
}

// ─── Write ───────────────────────────────────────────────────────────────────

export async function storeCluster(data: ClusterToStore): Promise<void> {
  // 1. Upsert all words + get their IDs
  const wordIdMap: Record<string, number> = {};

  for (const member of data.members) {
    const result = await sql`
      INSERT INTO words (simplified, traditional, pinyin, raw_glosses, core_scene)
      VALUES (
        ${member.simplified},
        ${member.traditional},
        ${member.pinyin},
        ${member.raw_glosses as unknown as string},
        ${member.core_scene ?? null}
      )
      ON CONFLICT (simplified, pinyin)
      DO UPDATE SET
        traditional = EXCLUDED.traditional,
        raw_glosses = EXCLUDED.raw_glosses,
        core_scene = COALESCE(EXCLUDED.core_scene, words.core_scene)
      RETURNING id
    `;
    wordIdMap[member.simplified] = result.rows[0].id;
  }

  // 2. Upsert all gloss tokens + get their IDs
  const allTokens = new Set<string>(data.edges.map((e) => e.gloss));
  for (const member of data.members) {
    member.normalized_tokens.forEach((t) => allTokens.add(t));
  }

  const glossIdMap: Record<string, number> = {};
  for (const token of allTokens) {
    await sql`
      INSERT INTO gloss_tokens (token)
      VALUES (${token})
      ON CONFLICT (token) DO NOTHING
    `;
    const result = await sql`SELECT id FROM gloss_tokens WHERE token = ${token}`;
    glossIdMap[token] = result.rows[0].id;
  }

  // 3. Insert word_glosses for each member's tokens
  for (const member of data.members) {
    const wordId = wordIdMap[member.simplified];
    for (const token of member.normalized_tokens) {
      const glossId = glossIdMap[token];
      if (glossId) {
        await sql`
          INSERT INTO word_glosses (word_id, gloss_id)
          VALUES (${wordId}, ${glossId})
          ON CONFLICT DO NOTHING
        `;
      }
    }
  }

  // 4. Create synonym cluster
  const clusterResult = await sql`
    INSERT INTO synonym_clusters (label, word_count)
    VALUES (${data.label}, ${data.members.length})
    RETURNING id
  `;
  const clusterId = clusterResult.rows[0].id;

  // 5. Insert cluster members
  for (const member of data.members) {
    const wordId = wordIdMap[member.simplified];
    await sql`
      INSERT INTO cluster_members (cluster_id, word_id)
      VALUES (${clusterId}, ${wordId})
      ON CONFLICT DO NOTHING
    `;
  }

  // 6. Insert synonym edges (one per shared gloss per pair)
  for (const edge of data.edges) {
    const word1Id = wordIdMap[edge.word1];
    const word2Id = wordIdMap[edge.word2];
    const glossId = glossIdMap[edge.gloss];
    if (!word1Id || !word2Id || !glossId) continue;

    // Always store with smaller id first to avoid duplicates
    const [w1, w2] = word1Id < word2Id ? [word1Id, word2Id] : [word2Id, word1Id];
    await sql`
      INSERT INTO synonym_edges (cluster_id, word1_id, word2_id, gloss_id)
      VALUES (${clusterId}, ${w1}, ${w2}, ${glossId})
      ON CONFLICT DO NOTHING
    `;
  }

  // 7. Insert collocations + sharing
  for (const member of data.members) {
    const wordId = wordIdMap[member.simplified];
    if (!member.collocations) continue;

    for (const coll of member.collocations) {
      const result = await sql`
        INSERT INTO collocations (word_id, collocation, pinyin, gloss, weight, pattern_type)
        VALUES (
          ${wordId},
          ${coll.phrase},
          ${coll.pinyin},
          ${coll.gloss},
          ${coll.weight},
          ${coll.pattern}
        )
        ON CONFLICT (word_id, collocation) DO UPDATE SET
          weight = EXCLUDED.weight,
          pinyin = EXCLUDED.pinyin,
          gloss = EXCLUDED.gloss
        RETURNING id
      `;
      const collId = result.rows[0].id;

      // Insert sharing entries for other members
      for (const sharedSimplified of coll.shared_with) {
        const alsoWordId = wordIdMap[sharedSimplified];
        if (alsoWordId && alsoWordId !== wordId) {
          await sql`
            INSERT INTO collocation_sharing (collocation_id, also_word_id)
            VALUES (${collId}, ${alsoWordId})
            ON CONFLICT DO NOTHING
          `;
        }
      }
    }
  }

  // 8. Insert situations
  if (data.situations) {
    for (const sit of data.situations) {
      const answerWordId = wordIdMap[sit.answer];
      if (!answerWordId) continue;

      await sql`
        INSERT INTO situations (cluster_id, answer_word_id, situation_en, explanation, example_zh, difficulty)
        VALUES (
          ${clusterId},
          ${answerWordId},
          ${sit.scenario},
          ${sit.why},
          ${sit.example_zh},
          ${sit.difficulty}
        )
        ON CONFLICT (cluster_id, situation_en) DO NOTHING
      `;
    }
  }
}
