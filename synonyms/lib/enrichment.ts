import Anthropic from '@anthropic-ai/sdk';
import type { CedictEntry } from './types';
import type { SynonymCluster } from './cedict';

const client = new Anthropic();

export interface EnrichmentResult {
  words: Record<string, {
    core_scene: string;
    collocations: Array<{
      phrase: string;
      pinyin: string;
      gloss: string;
      weight: number;
      pattern: string;
      shared_with: string[];
    }>;
  }>;
  situations: Array<{
    scenario: string;
    answer: string;
    why: string;
    example_zh: string;
    difficulty: number;
  }>;
}

function buildPrompt(cluster: SynonymCluster): string {
  const memberLines = cluster.members.map((m) => {
    const tokens = m.normalized_tokens.slice(0, 5).join(', ');
    const glosses = m.raw_glosses.slice(0, 3).join('; ');
    return `  - ${m.simplified} (${m.traditional}) [${m.pinyin}]: ${glosses} | key tokens: ${tokens}`;
  });

  // Group edges by pair to show shared gloss count
  const pairGlosses: Record<string, string[]> = {};
  for (const edge of cluster.edges) {
    const key = `${edge.word1}↔${edge.word2}`;
    if (!pairGlosses[key]) pairGlosses[key] = [];
    pairGlosses[key].push(edge.gloss);
  }
  const edgeLines = Object.entries(pairGlosses).map(
    ([pair, glosses]) => `  - ${pair}: shared glosses: ${glosses.join(', ')}`
  );

  const membersStr = cluster.members.map((m) => m.simplified).join('/');

  return `You are a Chinese linguistics expert. Analyze this synonym cluster and return ONLY valid JSON.

Cluster label: "${cluster.label}"
Words: ${membersStr}

Members:
${memberLines.join('\n')}

Edges (shared glosses):
${edgeLines.join('\n')}

Return JSON with this exact shape:
{
  "words": {
    "<simplified>": {
      "core_scene": "1 sentence describing the specific perceptual/physical scene this word evokes — what makes it DIFFERENT from its siblings",
      "collocations": [
        {
          "phrase": "<Chinese phrase>",
          "pinyin": "<pinyin>",
          "gloss": "<English gloss>",
          "weight": <0.0-1.0, higher = stronger association>,
          "pattern": "<compound|verb-object|complement|modifier|idiom>",
          "shared_with": ["<simplified chars of other cluster members that also commonly use this collocation>"]
        }
      ]
    }
  },
  "situations": [
    {
      "scenario": "<English situation description, 1-2 sentences>",
      "answer": "<simplified char of the correct word>",
      "why": "<explanation of why this word fits and others don't>",
      "example_zh": "<example sentence in Chinese using the correct word>",
      "difficulty": <1=obvious, 2=requires thought, 3=tricky>
    }
  ]
}

Rules:
- 5-8 collocations per word
- 2-3 situations total (not per word), covering different words as answers
- core_scene must highlight the DISTINGUISHING feature vs siblings
- situations should be concrete, sensory, real-world scenarios
- Return ONLY the JSON, no markdown fences, no preamble`;
}

export async function enrichCluster(cluster: SynonymCluster): Promise<EnrichmentResult> {
  const prompt = buildPrompt(cluster);

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Strip markdown fences if Claude wrapped the JSON anyway
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let result: EnrichmentResult;
  try {
    result = JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse enrichment response:', cleaned.slice(0, 500));
    throw new Error(`Enrichment JSON parse failed: ${err}`);
  }

  // Validate basic shape
  if (!result.words || !result.situations) {
    throw new Error('Enrichment response missing required fields');
  }

  return result;
}
