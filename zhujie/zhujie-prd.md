# 注解 (Zhùjiě) — Pre-Consumption Annotation Engine

## Product Requirements Document

---

## Vision

A Genius-style annotation layer for Chinese native content (songs, TV shows, podcasts) that uses LLM-powered contextual analysis to pre-study every line before consumption. The goal: by the time you press play, you're recognizing — not decoding.

Part of the benji.codes suite.

---

## Core Concept

The user pastes Chinese content (lyrics, subtitle files, transcript text). The system produces deep, contextual, line-by-line annotations designed to maximize comprehension. Previously annotated content is cached and served instantly.

---

## Architecture

### Two-Pass LLM Annotation Pipeline

**Pass 1 — Content Map (single call, full text)**

Send the entire content to the LLM. Output a structured JSON "content map" containing:

- Thematic summary (what this piece is about emotionally and narratively)
- Recurring motifs and imagery (e.g., water imagery, temporal references)
- Structural patterns (parallel lines, repeated grammatical frames, refrains)
- Register profile (is this literary, colloquial, mixed? what's the baseline?)
- Character/speaker identification (for TV/dialogue content)
- Key cultural references that span the whole piece
- Relationship dynamics and forms of address (for multi-speaker content)

This content map becomes the shared context for all Pass 2 calls.

**Pass 2 — Line-by-Line Annotation (parallelizable)**

For each line, send:
1. The content map from Pass 1
2. The full original text (for cross-reference awareness)
3. The target line number and text
4. Surrounding lines (±3 lines for local context)

Output: structured annotation JSON for that single line.

**Why two passes instead of one massive call:**
- Output quality degrades when asking for deep annotations on 40+ lines simultaneously
- Pass 2 calls are independent and can be parallelized (significant speed improvement)
- If a single line annotation fails or is low quality, it can be retried without regenerating everything
- The content map can be reused if the user requests re-annotation with different settings

### Caching Strategy

**Content-level cache (Neon Postgres):**

```
content_hash (SHA-256 of normalized input text) → {
  content_map: JSON,        // Pass 1 output
  metadata: {
    title: string | null,
    artist: string | null,
    content_type: "song" | "tv" | "podcast" | "other",
    language_variant: "simplified" | "traditional",
    created_at: timestamp,
    source_text: string
  }
}
```

**Line-level cache:**

```
content_hash + line_index → {
  annotation: JSON,         // Pass 2 output for this line
  version: int              // for future re-annotation with improved prompts
}
```

Cache is keyed to content hash, so identical content pasted by different users hits the same cache. Over time this organically builds a content library.

**Cache invalidation:** Version field on annotations allows bulk re-annotation when the prompt improves, without losing the content map.

---

## UX Layout

### Two-Panel Layout (Desktop)

```
┌─────────────────────┬──────────────────────────────────┐
│                     │                                  │
│   LINE LIST (left)  │   ANNOTATION VIEW (right/main)   │
│                     │                                  │
│   1  誰陪我做執迷的鯨魚  │   [Selected line, large]         │
│      shéi péi wǒ... │                                  │
│      Who will stay...│   Word-level interactive text     │
│                     │   with tappable popovers          │
│   2  在人海中游來游去  │                                  │
│      zài rénhǎi...  │   Insight strip                   │
│      Swimming back...│                                  │
│                     │   Grammar unlock (if applicable)  │
│   3  誰陪我建永恆的故居 │                                  │
│      shéi péi wǒ... │   Cross-references                │
│      Who will help...│                                  │
│                     │                                  │
│   4  在歲月中跑來跑去  │                                  │
│      zài suìyuè...  │                                  │
│                     │                                  │
└─────────────────────┴──────────────────────────────────┘
```

### Left Panel — Line List

- Scrollable list of all lines
- Each line shows: line number, Chinese text, pinyin (smaller), contextual English translation
- Active line highlighted with gold left border
- Lines are clickable — selecting one populates the right panel
- Navigation: arrow keys, click, or cross-reference jumps
- On mobile: line list is the default view; tapping a line transitions to a full-screen annotation view with back navigation

### Right Panel — Annotation View (Main)

Three progressive layers:

**Layer 1 — The Line (always visible)**
- Chinese text rendered large, with word segmentation
- Each meaningful word/phrase is tappable (dotted underline)
- Key grammar patterns have a distinct underline style (dashed, blue-tinted)
- Pinyin displayed below the Chinese
- Contextual English translation

**Layer 2 — Word Popovers (on tap)**
- Tap any dotted-underline word to open a compact popover
- Popover contains:
  - The word + pinyin + contextual meaning (as used HERE, not dictionary default)
  - Cultural/contextual insight woven directly into the explanation (not a separate section)
  - Register note if the word choice is notable (e.g., "literary — you'd say X in casual speech")
  - Character decomposition if etymology illuminates meaning
- Popovers are dismissible by tapping elsewhere
- Only one popover open at a time

**Layer 3 — Line-Level Insight Strip (on line selection)**
- Appears below the interactive line text
- Contains ONE concise insight — the single most important non-obvious thing about this line
- Grammar unlock: only shown when a grammar pattern is the actual comprehension bottleneck for this line. Includes pattern template + 2-3 example usages
- Cross-reference links: clickable pills that jump to related lines, with a one-line explanation of the connection

---

## Annotation Schema

### Per-Line Annotation Object

```json
{
  "line_index": 0,
  "chinese": "誰陪我做執迷的鯨魚",
  "pinyin": "shéi péi wǒ zuò zhímí de jīngyú",
  "translation": "Who will stay with me, being a stubbornly obsessed whale",
  "insight": "Opens with a rhetorical 誰 — not really asking, just aching. Mirrors line 3 structurally: both pleas, but the desire shifts from wandering to rootedness.",
  "words": [
    {
      "chars": "執迷",
      "pinyin": "zhímí",
      "note": "Stubbornly obsessed. 執 = grip tightly, 迷 = lost. Often negative (執迷不悟 = persist in folly), but the singer reclaims it as identity, not flaw.",
      "is_pattern_key": false,
      "difficulty": "hsk5+"
    }
  ],
  "grammar_unlock": null | {
    "pattern": "V來V去",
    "explanation": "...",
    "examples": ["想來想去", "走來走去", "翻來覆去"]
  },
  "cross_references": [
    {
      "target_line": 2,
      "note": "Line 2 literalizes this metaphor — the whale swims in a 人海."
    }
  ],
  "dropped_subject": null | "Subject is still 她 from line 12",
  "negation_note": null | "不是不想 — stacked negation: it's not that I don't want to"
}
```

### Word Annotation Priorities

These are ordered by how often they produce comprehension breakthroughs:

1. **Contextual meaning** — what this word means HERE, not the dictionary default
2. **Cultural load** — woven into the meaning note, not a separate field
3. **Particle nuance** — 了/的/得/过/呢/吧/啊/嘛: what is this particle DOING in this sentence?
4. **Register signal** — literary vs. colloquial, and what that choice communicates
5. **Sound-meaning play** — homophones, tonal puns, deliberate echoes
6. **Emotional coloring of near-synonyms** — 看 vs 望 vs 瞧 vs 盯 (all "look," vastly different energy)
7. **Measure word choices** — when the measure word carries meaning (位 implies respect)
8. **Character decomposition** — only when etymology genuinely illuminates (矛盾 = spear + shield)

### Line-Level Annotation Priorities

1. **Dropped/implied subjects** — who is speaking/being referenced when pronouns are omitted
2. **Sentence rhythm and emphasis** — what word order communicates (topic-fronting)
3. **Cross-references** — structural parallels, repeated motifs, evolving imagery
4. **Grammar unlock** — only when a pattern is the bottleneck (V來V去, 連...都, 越...越)
5. **Connector logic** — 卻/倒/反而/偏偏 and what flavor of "but" they carry
6. **Negation subtlety** — stacked negation, 別 vs 不要 vs 不用
7. **Fixed frames** — 不是...而是, 與其...不如, when they're structurally important

---

## LLM Prompt Design

### Pass 1 System Prompt (Content Map)

```
You are a Chinese language analysis engine. You will receive a complete piece of Chinese content (song lyrics, TV subtitles, or transcript).

Produce a JSON content map with the following structure:
{
  "summary": "2-3 sentence thematic/emotional summary",
  "motifs": ["list of recurring images, metaphors, or thematic threads"],
  "structural_patterns": ["parallel lines, repeated frames, refrains"],
  "register_profile": "overall register description and notable shifts",
  "speakers": [{"id": "...", "description": "..."}] // for multi-speaker content
  "cultural_references": ["broad cultural context relevant to the whole piece"],
  "language_variant": "simplified | traditional",
  "key_vocabulary_threads": [
    {"word": "鯨魚", "appears_in_lines": [1, 8, 15], "evolution": "how its meaning shifts across appearances"}
  ]
}

Be specific and grounded. Every observation must reference specific lines or words. Do not make generic statements about Chinese culture — only flag cultural context that is necessary to understand THIS specific content.
```

### Pass 2 System Prompt (Line Annotation)

```
You are annotating a single line of Chinese content for an intermediate-to-advanced learner (HSK 4-6 level). Your goal is to maximize comprehension of this specific line in context.

You have access to:
- The full content map (themes, motifs, patterns)
- The complete original text
- The target line and its surrounding lines

Produce annotations following this schema: [schema here]

Rules:
- CONTEXTUAL MEANINGS ONLY. Never give dictionary defaults. What does this word mean in THIS sentence?
- WEAVE cultural insight into vocabulary notes. Don't separate "culture" from "meaning" — they're the same thing.
- INSIGHT must be ONE concise observation — the single most important non-obvious thing about this line. Not a summary. Not a restatement. An insight.
- GRAMMAR UNLOCK only when a pattern is the actual comprehension bottleneck. If the grammar is straightforward, set to null.
- CROSS-REFERENCES must be specific. "This connects to line X" is useless. "This line's V來V去 mirrors line 2's, but swimming became running — the exhaustion escalates" is useful.
- SKIP boring words. 我, 你, 的, 在 — don't annotate these unless they're doing something unusual in this context.
- For particles (了, 呢, 吧, etc.), always explain what the particle is DOING in this specific sentence.
- Flag dropped subjects explicitly.
- Note register only when the word choice is surprising or meaningful (literary word in casual context, or vice versa).
```

---

## Content Input

### MVP: Paste Interface

- Large text input area
- User pastes raw Chinese text (lyrics, subtitles, transcript)
- Optional metadata fields: title, artist/show, content type
- "Annotate" button triggers the pipeline
- Loading state shows progress (Pass 1 complete → annotating line 1 of N...)

### Future: Subtitle File Support

- Accept .srt, .ass, .vtt subtitle files
- Parse timestamps and map to line indices
- Enable synced playback (highlight current line while media plays)

### Future: Content Library

- Browse previously annotated content
- Search by title, artist, or theme
- Community submissions (cached content becomes browsable)

---

## Tech Stack

- **Frontend:** React (Next.js), consistent with benji.codes suite
- **Backend:** Vercel serverless functions
- **Database:** Neon Postgres (content cache, user progress)
- **LLM:** Anthropic API (Claude Sonnet for Pass 2 parallelization, Opus for Pass 1 if quality demands it)
- **Styling:** Tailwind + CSS variables, dark theme with warm amber/gold accents, Noto Serif SC + JetBrains Mono

---

## Design Language

Consistent with benji.codes suite:

- **Background:** Near-black (#0A0A0B)
- **Surface:** Dark gray (#131316)
- **Primary accent:** Warm gold (#D4A853)
- **Text:** Warm off-white (#E8E4DC)
- **Chinese text:** Noto Serif SC, 500 weight
- **UI/monospace:** JetBrains Mono
- **Body:** Inter or system sans-serif
- **Annotation type colors:**
  - Vocabulary: gold (#D4A853)
  - Grammar: steel blue (#5B8FB9)
  - Culture: soft purple (#9B7EC8)
  - Cross-reference: sage green (#6B9E78)
  - Particle: muted red (#C9544A)

---

## Mobile Considerations

- Line list becomes full-screen default view
- Tapping a line transitions to full-screen annotation view
- Back button returns to line list
- Word popovers render as bottom sheets on mobile (not floating popovers)
- Swipe left/right to navigate between lines in annotation view

---

## Future Features (Post-MVP)

- **Synced playback:** Connect to audio/video and highlight lines in real time
- **Spaced repetition hooks:** Flag words/patterns for review in a separate SRS system
- **Difficulty profiling:** User sets their level; annotations adjust density accordingly
- **Comparative annotations:** See how the same word/pattern is used across different songs/shows
- **Export:** Generate study sheets or Anki cards from annotations
- **Content requests:** Users submit content URLs; system queues annotation jobs
- **Collaborative corrections:** Users can flag or improve individual annotations

---

## Open Questions

1. Should Pass 1 use a more capable model (Opus) while Pass 2 uses Sonnet for speed/cost? Or is Sonnet sufficient for both?
2. How aggressively should we segment words? Chinese word boundaries are ambiguous — should we use jieba/pkuseg for segmentation before sending to the LLM, or let the LLM handle segmentation as part of annotation?
3. For TV show content with many episodes, should we maintain a running content map across episodes (character knowledge, plot threads) or treat each episode independently?
4. Rate limiting and cost: a 40-line song = 1 Pass 1 call + 40 Pass 2 calls. At scale, how do we manage API costs? Caching helps, but first-annotation cost is non-trivial.
