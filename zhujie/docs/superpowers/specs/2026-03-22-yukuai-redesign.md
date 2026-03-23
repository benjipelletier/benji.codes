# Zhujie YuKuai Redesign — Design Spec

## Overview

Redesign zhujie from a passive annotation reader into a personalized Chinese learning tool built around **YuKuai** (语块) — atomic, reusable knowledge units that span across content. The system decomposes Chinese content into trackable vocab, grammar patterns, and expressions, tracks each user's familiarity with them across contexts, and uses active recall to build mastery.

## Core Concept: YuKuai

A YuKuai is a canonical, reusable knowledge atom. Three types:

- **Vocab** — words and compounds (鲸鱼, 人海, 疲倦)
- **Grammar** — productive structural patterns where you can slot in different words (V来V去, 是...的, 一...就...)
- **Expression** — fixed idiomatic phrases that are more than the sum of their parts (春花秋月, 一霎那)

YuKuai are **global entities** shared across all content and users. A YuKuai like `grammar:V来V去` appears in 老伴 as 游来游去 (aimless swimming) and might appear in a cooking show as 翻来翻去 (flipping back and forth). Same pattern, different contextual usage — both build the learner's understanding.

## Tech Stack

- **Framework:** Next.js App Router (TypeScript) — unchanged
- **Database:** Neon Postgres — expanded schema
- **LLM:** Anthropic SDK, `claude-sonnet-4-6` — narrower role (decomposition + connections)
- **Auth:** NextAuth.js with Google and GitHub OAuth
- **Static Data:** CC-CEDICT for pinyin, HSK levels, base definitions
- **Styling:** Inline JS style objects — unchanged
- **Fonts:** Noto Serif SC, JetBrains Mono, Inter — unchanged

## Data Model

### YuKuai Entity

```
yukuai {
  id:              "vocab:鲸鱼" | "grammar:V来V去" | "expr:春花秋月"
  type:            vocab | grammar | expression
  canonical_form:  "鲸鱼" | "V来V去" | "春花秋月"
  pinyin:          "jīng yú" | null (from CC-CEDICT, grammar/expr may not have pinyin)
  hsk_level:       1-6 | null (from static lookup)
  base_definition: "whale" (from dictionary, not LLM)
}
```

### YuKuai Encounter

A specific appearance of a YuKuai in a specific context for a specific user.

```
yukuai_encounter {
  user_id          → user
  yukuai_id        → yukuai
  content_hash     → content (which song/show)
  line_index       which line
  surface_form     "游来游去" (what it looks like in this line)
  contextual_meaning "swimming aimlessly back and forth — futility" (LLM-generated)
  created_at
}
```

### User YuKuai State

The user's evolving relationship with a YuKuai.

```
user_yukuai {
  user_id          → user
  yukuai_id        → yukuai
  familiarity      new | seen | familiar | known
  encounter_count  number
  last_seen_at
  contexts_seen    number (distinct content sources)
}
```

### User

```
user {
  id               uuid
  email
  name
  provider         "google" | "github"
  created_at
}
```

### Content

Unchanged from current system — identified by SHA-256 hash of normalized text. Content map and line decompositions are shared/global (same lyrics = same decomposition for everyone).

> **Future note:** Content identity will need to evolve from hash-based to stable UUID when adding external sources (Spotify, YouTube, TV show APIs). For now, the hash is simple and deduplicates automatically.

## Familiarity Engine

### Transitions

```
new → seen → familiar → known

new:       YuKuai exists in a line you viewed, but you haven't interacted with it
seen:      You've viewed lines containing this YuKuai in 2+ contexts
familiar:  You've successfully recalled this YuKuai in active recall
known:     You've recalled it across 2+ different content sources
```

### Initial Calibration

Cold start — no self-declaration. The system starts with everything as `new` and learns purely from the user's interactions. The more content you study, the more personalized it gets.

### Active Recall

Not a separate quiz mode. Woven into the reading experience. When you click a line containing YuKuai you've seen before, occasionally one is presented in "recall mode":

- **Vocab:** show characters, hide contextual meaning → "what does 人海 mean here?" → tap to reveal
- **Grammar:** show surface form, hide pattern name → "what pattern is 游来游去?" → tap to reveal
- **Expression:** show partial, hide meaning → tap to reveal

The system picks which YuKuai to test based on: time since last seen, current familiarity level, whether it's been seen in this content before. Simple spaced-repetition-inspired logic, not a full SRS algorithm.

## LLM Pipeline

### Pass 1 — Content Map (mostly unchanged)

On paste, the LLM analyzes the full text and returns themes, motifs, structural patterns. Cached by content hash. This feeds into connections generation in Pass 2.

### Pass 2 — Line Decomposition (replaces line annotation)

When a user clicks a line, the LLM decomposes it into YuKuai with contextual information.

**Input:** content map + full text + target line + surrounding lines

**Output:**
```json
{
  "translation": "Swimming back and forth in the sea of people, speaking a language only I understand",
  "yukuai": [
    {
      "canonical_id": "vocab:人海",
      "type": "vocab",
      "surface_form": "人海",
      "contextual_meaning": "sea of people — extends the whale metaphor from line 0"
    },
    {
      "canonical_id": "grammar:V来V去",
      "type": "grammar",
      "surface_form": "游来游去",
      "contextual_meaning": "aimless back-and-forth swimming — conveys futility and restlessness"
    },
    {
      "canonical_id": "vocab:言语",
      "type": "vocab",
      "surface_form": "言语",
      "contextual_meaning": "language/speech — here a private language no one else understands"
    }
  ],
  "connections": [
    {
      "from": "grammar:V来V去",
      "to_line": 3,
      "note": "V来V去 shifts from 游 (swimming) to 跑 (running) — the medium changes, the exhaustion escalates"
    }
  ],
  "gotchas": [
    {
      "yukuai_id": "vocab:言语",
      "note": "言语 (yán yǔ) not 语言 (yǔ yán) — same characters reversed, more literary/poetic register"
    }
  ]
}
```

**What the LLM is responsible for:**
- Parsing which YuKuai exist in the line (proposing canonical IDs)
- Contextual meaning for each YuKuai in this specific usage
- Connections between YuKuai across lines
- Gotchas (pronunciation traps, false friends, register surprises)

**What the LLM is NOT responsible for:**
- HSK levels (static CC-CEDICT lookup)
- Pinyin (static CC-CEDICT lookup)
- Base/dictionary definitions (static CC-CEDICT lookup)
- Boring words (我, 的, 在) — skip unless usage is unusual

**Canonical ID deduplication:** The LLM proposes canonical IDs. On insert, if a YuKuai with that ID already exists, we reuse it and just create a new encounter. If it's new, we create the YuKuai entity and enrich it with CC-CEDICT data.

Line decompositions are cached by content hash + line index (shared across users). User-specific data (encounters, familiarity) is written per-user on top of the shared decomposition.

## Auth

NextAuth.js with Google and GitHub OAuth providers.

- Unauthenticated users can paste content and browse decompositions, but nothing is tracked
- Login unlocks: familiarity tracking, active recall, personalized highlights
- No roles, teams, or settings beyond what OAuth provides

## UI Design

### Line List (left panel)

Mostly unchanged, with familiarity signals added:

- Each line shows a subtle indicator of the ratio of new/seen/familiar/known YuKuai
- Lines with more `new` YuKuai are visually prominent
- Lines you've mastered fade back
- Logged-out users see no indicators

### Annotation View (right panel)

New layout when clicking a line:

1. **Line + translation** — Chinese text at top with YuKuai highlighted by type (color-coded). Translation hidden by default, tap to reveal (active recall for the whole line).

2. **Vocab section** — Cards for vocab YuKuai. Each card shows: characters, pinyin (from dictionary), contextual meaning (LLM), familiarity badge (new/seen/familiar/known), HSK level tag.

3. **Grammar section** — Cards for grammar YuKuai. Each card shows: canonical pattern (e.g., V来V去), surface form in this line, explanation of what the pattern does here.

4. **Expressions section** — Cards for expression YuKuai. Each card shows: the expression, contextual meaning, cultural context if relevant.

5. **Connections** — How YuKuai in this line relate to YuKuai in other lines (LLM-generated). Clickable to jump to the connected line.

6. **Gotchas** — Pronunciation traps, false friends, register surprises (LLM-generated).

### Active Recall Cards

When the system decides to test a YuKuai, its card renders in "recall mode" — key info hidden, tap to reveal. Same card component, different render state based on whether the system is prompting recall.

### Word Highlighting

The Chinese text at the top of the annotation view highlights which characters map to which YuKuai, color-coded by type (amber for vocab, coral for grammar, purple for expressions). Tapping a highlighted segment scrolls to its card below rather than opening a popover.

## What Changes from Current System

### Keep
- Next.js App Router, Neon Postgres, Anthropic SDK, inline styles
- Dark theme with vivid accent colors
- Content map Pass 1
- Content hash caching for deduplication
- Keyboard navigation (j/k, arrows)
- Font stack (Noto Serif SC, JetBrains Mono, Inter)

### Change
- Pass 2 prompt → decompose into YuKuai + connections + gotchas
- DB schema → add yukuai, yukuai_encounter, user_yukuai, users tables
- Annotation view → sectioned YuKuai cards
- Add NextAuth.js for OAuth
- Add CC-CEDICT lookup for pinyin/HSK/base definitions
- Translation → hidden by default (tap to reveal)
- LLM model → claude-sonnet-4-6 (cost)

### Remove
- WordPopover component
- InsightStrip component (insight folded into connections)
- Per-word difficulty/pinyin from LLM output
- Content map display in line list (already removed)

## Future Considerations

- **Content identity evolution:** Move from content hash to stable UUID when adding external sources (Spotify, YouTube, TV show APIs)
- **Full SRS algorithm:** Current familiarity engine uses simple heuristics; could evolve into proper spaced repetition
- **Content recommendations:** Suggest content based on knowledge gaps
- **User-facing YuKuai profile:** "Show me all grammar patterns I know" dashboard
