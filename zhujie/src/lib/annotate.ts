import Anthropic from '@anthropic-ai/sdk';
import type { ContentMap, LineAnnotation } from './types';

let _client: Anthropic | null = null;
function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _client;
}
const MODEL = 'claude-opus-4-6';

// ─── Pass 1: Content Map ─────────────────────────────────────────────────────

const PASS1_SYSTEM = `You are a Chinese language analysis engine. You will receive a complete piece of Chinese content (song lyrics, TV subtitles, or transcript).

Produce a JSON content map with the following structure:
{
  "summary": "2-3 sentence thematic/emotional summary",
  "motifs": ["list of recurring images, metaphors, or thematic threads"],
  "structural_patterns": ["parallel lines, repeated frames, refrains"],
  "register_profile": "overall register description and notable shifts",
  "speakers": [{"id": "...", "description": "..."}],
  "cultural_references": ["broad cultural context relevant to the whole piece"],
  "language_variant": "simplified | traditional",
  "key_vocabulary_threads": [
    {"word": "鯨魚", "appears_in_lines": [1, 8, 15], "evolution": "how its meaning shifts across appearances"}
  ]
}

Be specific and grounded. Every observation must reference specific lines or words. Do not make generic statements about Chinese culture — only flag cultural context that is necessary to understand THIS specific content.

Return ONLY valid JSON. No markdown, no explanation.`;

export async function generateContentMap(text: string): Promise<ContentMap> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: PASS1_SYSTEM,
    messages: [{ role: 'user', content: text }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');

  return parseJSON<ContentMap>(content.text);
}

function parseJSON<T>(raw: string): T {
  let s = raw.trim();
  // Strip code fences
  if (s.startsWith('```')) {
    s = s.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    s = s.trim();
  }
  // Extract the outermost JSON object
  const start = s.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let depth = 0;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('Unterminated JSON object in response');
  return JSON.parse(s.slice(start, end + 1)) as T;
}

// ─── Pass 2: Line Annotation ─────────────────────────────────────────────────

const PASS2_SYSTEM = `You are annotating a single line of Chinese content for an intermediate-to-advanced learner (HSK 4-6 level). Your goal is to maximize comprehension of this specific line in context.

You have access to:
- The full content map (themes, motifs, patterns)
- The complete original text
- The target line and its surrounding lines

Produce annotations following this JSON schema:
{
  "line_index": number,
  "chinese": "the line text",
  "translation": "contextual English translation",
  "insight": "ONE concise non-obvious observation",
  "words": [
    {
      "chars": "word",
      "pinyin": "only if pronunciation is a gotcha",
      "has_pinyin_gotcha": boolean,
      "note": "contextual meaning woven with cultural insight",
      "is_pattern_key": boolean,
      "difficulty": "hsk1-6 or hsk5+"
    }
  ],
  "grammar_unlock": null | {
    "pattern": "pattern template",
    "explanation": "what it does",
    "examples": ["example1", "example2", "example3"]
  },
  "cross_references": [
    { "target_line": number, "note": "specific connection explanation" }
  ],
  "dropped_subject": null | "explanation of implied subject",
  "negation_note": null | "explanation of negation pattern"
}

Rules:
- CONTEXTUAL MEANINGS ONLY. Never give dictionary defaults. What does this word mean in THIS sentence?
- WEAVE cultural insight into vocabulary notes. Don't separate "culture" from "meaning."
- PINYIN only when pronunciation is a gotcha: 多音字, unexpected tones, commonly mispronounced. Set has_pinyin_gotcha: true for these. Otherwise omit pinyin and set has_pinyin_gotcha: false.
- INSIGHT must be ONE concise observation — the single most important non-obvious thing about this line. Not a summary. An insight.
- GRAMMAR UNLOCK only when a pattern is the actual comprehension bottleneck. If grammar is straightforward, set to null.
- CROSS-REFERENCES must be specific. "This connects to line X" is useless. "This line's V來V去 mirrors line 2's, but swimming became running — the exhaustion escalates" is useful.
- SKIP boring words. 我, 你, 的, 在 — don't annotate unless doing something unusual.
- For particles (了, 呢, 吧, etc.), explain what the particle is DOING in this specific sentence.
- Flag dropped subjects explicitly.
- Note register only when the word choice is surprising or meaningful.

Return ONLY valid JSON. No markdown, no explanation.`;

export async function generateLineAnnotation(
  contentMap: ContentMap,
  fullText: string,
  lines: string[],
  lineIndex: number,
): Promise<LineAnnotation> {
  const start = Math.max(0, lineIndex - 3);
  const end = Math.min(lines.length - 1, lineIndex + 3);
  const surroundingLines = lines
    .slice(start, end + 1)
    .map((line, i) => {
      const idx = start + i;
      const marker = idx === lineIndex ? ' <<<' : '';
      return `${idx}: ${line}${marker}`;
    })
    .join('\n');

  const userMessage = `## Content Map
${JSON.stringify(contentMap, null, 2)}

## Full Text
${fullText}

## Target Line
Line ${lineIndex}: ${lines[lineIndex]}

## Surrounding Lines (±3)
${surroundingLines}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: PASS2_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = response.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');

  return parseJSON<LineAnnotation>(content.text);
}
