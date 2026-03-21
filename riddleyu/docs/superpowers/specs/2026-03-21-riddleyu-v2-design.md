# Riddleyu v2 — Claim Consistency 成语 Puzzle

## Overview

A daily Chinese 成语 (four-character idiom) deduction game for intermediate learners. Inspired by [Clues by Sam](https://cluesbysam.com/), the player investigates a grid of 16 Chinese characters to determine which 4 form today's 成语. Each correctly opened card reveals a **claim** (in Chinese) about the idiom's structure. Claims from correct characters are true; claims from distractors are plausible lies. The player cross-references claims to chain deductions and spell out the idiom.

## Target audience

Intermediate Chinese learners who can read characters independently, look up pronunciation on their own, and don't need pinyin scaffolding. The game teaches 成语 structure, semantic distinctions between similar characters, and component relationships — not basic literacy.

## Core mechanic

### The grid

- 16 distinct Chinese characters displayed in a 4×4 grid (no duplicate characters allowed)
- 4 are **在** (in the 成语, in order: position 0–3)
- 12 are **不在** (not in the 成语)
- The first character (position 0) is pre-revealed with its claim visible — this is automatic, not a player action, and does not appear as a tile in the share result

### Claims

- Each character has one **claim** — a short statement in Chinese about the idiom's meaning, structure, or character relationships
- **在 characters' claims are TRUE** — they accurately describe the idiom's semantic progression, character distinctions, component structure, or founding story
- **不在 characters' claims are FALSE** — they sound plausible but contain a specific error detectable by cross-referencing with true claims
- All claims are in Chinese. Simple language, not dumbed down.

### Gameplay loop

1. Player reads the current claim at the top of the screen
2. Player taps a character in the grid to select it
3. Player presses **在** or **不在** to declare their judgment
4. **Correct declaration**: card opens (green for 在, grey for 不在), the character's claim appears at the top. Previous claims accessible by swiping left.
5. **Wrong declaration**: card flashes, stays closed. Yellow tile recorded in share score. Player can select any other closed card next (including this one on a later turn — but since the player now knows the correct answer for this card, re-trying it is trivially correct and still counts as a tile).
6. **Win condition**: all 4 在 characters found. Discovery is enforced in position order (0→1→2→3) — the player must find position 1 before position 2, etc. This matches the claim chain design where each true claim points toward the next position. After the last 在 character is found, the game auto-transitions to the result screen after a brief celebration animation (~1.5s).

### No lives system

Wrong guesses are not punished with game-over. The penalty is cosmetic: yellow tiles in the share result. This keeps the game learner-friendly — mistakes are learning opportunities, not failures.

## Game phases

### 1. Intro (`intro`)

- Brief how-to-play explanation
- Start button

### 2. Game (`game`)

- **Claim bar** (top): shows the current claim text, source label ("来自：马"), swipeable history of all previously revealed claims
- **Progress dots**: 4 dots indicating position-order progress. Dot 0 is always filled (given). The next unfound position has a ring/pulse (currently searching). Later positions are empty (locked — can't be found until earlier ones are).
- **Character grid**: 4×4 grid of cards. States:
  - **Closed**: white card, character visible, no claim. Tappable.
  - **在 (found)**: green border/background, character prominent, small 在 label
  - **不在 (eliminated)**: grey/muted, small 不在 label
  - **Selected**: red border highlight (awaiting 在/不在 declaration)
  - **Wrong flash**: brief shake/red flash on incorrect guess, then returns to closed
- **Action bar** (bottom): 在 and 不在 buttons. Disabled until a card is selected.

### 3. Result (`result`)

- Full 成语 displayed: characters, pinyin, English meaning
- Story summary — a brief explanation of the idiom's origin/meaning, generated at puzzle creation time and stored in the `story` field of the puzzle data
- Share button
- "Come back tomorrow" / countdown to next puzzle

### Share format

```
谜语 2026-03-21
🟩🟨🟩🟩🟨🟩🟩
```

Each tile represents one declaration attempt in chronological order:
- 🟩 = correct (在 or 不在)
- 🟨 = wrong guess

Fewer total tiles = more efficient. Fewer yellow = more accurate. Both are bragging rights.

## Claim design

### Semantic decomposition

Every 成语 is decomposed into 4 roles before claims are written:

| Position | Role | Description |
|----------|------|-------------|
| 0 | Setup / Context | The initiating element — a subject, a situation, a starting state |
| 1 | Transition / Change | The action or shift — movement, arrival, transformation |
| 2 | Resolution / Process | The mechanism — how the outcome is achieved, becoming |
| 3 | Outcome / Evaluation | The result — what was gained, lost, or proven |

This decomposition is the ground truth that all claims reference.

### True claims (在 characters)

Each true claim must:
- Be in Chinese (clear, natural phrasing)
- Reference the semantic decomposition accurately
- Narrow the field for the NEXT position (chain forward)
- Require cross-referencing with at least one other claim to be actionable (no single claim is sufficient alone)
- Include a mix of: semantic progression, character meaning distinctions, component structure (e.g. 功 = 工 + 力), and/or story references

Example true claims for 马到成功:
- 马 (pos 0): "这个成语描述一个过程：先有行动，然后到达，接着完成，最后取得成果。"
- 到 (pos 1): "我表示具体的到达，到一个确切的地方。跟在我后面的字表示'变成'或'完成'，不是最终的结果本身。"
- 成 (pos 2): "我表示'变成'或'达成'——是转变的过程。我后面的字由两个部分组成，一个代表劳动，一个代表力量。"
- 功 (pos 3): "我由'工'和'力'组成——劳动加上力量等于成就。我不是胜利，我是靠努力获得的成果。"

### False claims (不在 characters)

Three categories of lies, mixed across the 12 distractors:

#### Near-miss
Almost correct, but one specific detail is wrong. Requires careful reading to catch.
- Example (达): "第二个字可以表示'到达'也可以表示'达到'——两种理解都说得通。"
- Why false: 马's claim specifies concrete arrival (到达), not abstract attainment (达到). The ambiguity contradicts the specificity.

#### Category confusion
Mixes up the semantic roles between positions.
- Example (完): "第三个字标志着结束——过程已经完毕。"
- Why false: Position 3 (per 到's claim) means "becoming/completing" — an active transition, not finality. 完 describes an ending, 成 describes a transformation.

#### Structural error
Misrepresents the overall pattern or relationship structure.
- Example (胜): "最后一个字表示赢——在竞争中胜出。"
- Why false: 成's claim says the final character is built from labor + strength (功), not about winning competition (胜).

### Claim validation rules

Before a puzzle ships, these must hold:

1. **Uniqueness**: The 4 true claims, taken together, uniquely identify exactly one set of 4 characters from the 16
2. **Necessity**: Each true claim is needed — removing any one would leave multiple valid interpretations
3. **Interaction**: At least 2 claims must be combined to eliminate any single distractor (no distractor is dismissable from one claim alone)
4. **Chain**: True claims guide discovery in position order (claim 0 → find position 1, claim 1 → find position 2, etc.). Discovery is enforced in this order by the game engine — the player cannot declare a character 在 for position N+1 until position N is found.

## Distractor selection

The 12 不在 characters are chosen to create meaningful interference:

### Synonym traps (3–4 characters)
Characters with similar meaning to the correct ones. Force the player to learn precise distinctions.
- 达 vs 到 (both mean arriving, but 达 is more abstract)
- 胜 vs 功 (both relate to success, but 胜 is winning, 功 is earned achievement)
- 完 vs 成 (both relate to completion, but 完 is finality, 成 is transformation)

### Component parts (2–3 characters)
Characters that are literal components of correct characters. Teaches character composition.
- 工 and 力 (components of 功)
- 至 (component of 到)

### Same-category (3–4 characters)
Characters from the same semantic field. Creates thematic noise.
- 走, 进 (motion verbs alongside 到)
- 果 (result word alongside 功)

### Thematic noise (2–3 characters)
Characters related to the idiom's story but not in the idiom itself.
- 骑 (riding — related to 马 but not in the idiom)
- 路 (road — related to journey theme)

**Hard rule**: Each distractor must plausibly satisfy some true claims but fail against others. No character should be trivially dismissable.

## Puzzle data shape

```json
{
  "date": "2026-03-21",
  "chengyu": {
    "chars": ["马", "到", "成", "功"],
    "pinyin": "mǎ dào chéng gōng",
    "meaning": "to achieve immediate success"
  },
  "story": "出自元代无名氏的杂剧。形容一到达就立刻取得成功，比喻事情顺利，一开始就取得好成绩。",
  "grid": ["马", "达", "赢", "终", "到", "走", "成", "果", "力", "功", "完", "骑", "路", "胜", "至", "进"],
  "characters": {
    "马": { "zai": true, "position": 0, "claim": "这个成语描述一个过程：先有行动，然后到达，接着完成，最后取得成果。" },
    "达": { "zai": false, "claim": "第二个字可以表示'到达'也可以表示'达到'——两种理解都说得通。" },
    "到": { "zai": true, "position": 1, "claim": "我表示具体的到达，到一个确切的地方。跟在我后面的字表示'变成'或'完成'，不是最终的结果本身。" },
    "成": { "zai": true, "position": 2, "claim": "我表示'变成'或'达成'——是转变的过程。我后面的字由两个部分组成，一个代表劳动，一个代表力量。" },
    "功": { "zai": true, "position": 3, "claim": "我由'工'和'力'组成——劳动加上力量等于成就。我不是胜利，我是靠努力获得的成果。" },
    "完": { "zai": false, "claim": "第三个字标志着结束——过程已经完毕。" },
    "胜": { "zai": false, "claim": "最后一个字表示赢——在竞争中胜出。" },
    "走": { "zai": false, "claim": "..." },
    "赢": { "zai": false, "claim": "..." },
    "终": { "zai": false, "claim": "..." },
    "果": { "zai": false, "claim": "..." },
    "力": { "zai": false, "claim": "..." },
    "骑": { "zai": false, "claim": "..." },
    "路": { "zai": false, "claim": "..." },
    "至": { "zai": false, "claim": "..." },
    "进": { "zai": false, "claim": "..." }
  }
}
```

## AI generation

### Architecture

Same as current riddleyu:
- **Generator**: Vercel serverless function (`/api/generate.js`) calls Anthropic API (Claude)
- **Cache**: Vercel KV — puzzle generated once per day, cached by date
- **Trigger**: Daily cron or manual `GET /api/generate?date=YYYY-MM-DD&force=true` with `Authorization: Bearer CRON_SECRET`
- **Dedup**: KV key `used_chengyu` tracks all previously used 成语 to prevent repeats

### Generation prompt structure

The prompt instructs Claude to:

1. **Select a 成语** — common enough for intermediate learners, not previously used, has clear semantic decomposition
2. **Decompose semantically** — output the 4-role breakdown (setup/transition/resolution/outcome) as an intermediate step before writing claims
3. **Generate 4 true claims** in Chinese that:
   - Are jointly consistent
   - Define the idiom uniquely against the distractors
   - Include structure, position constraints, and semantic distinctions
   - Chain forward (each claim points toward the next position)
   - Require combining 2+ claims for any single deduction
4. **Select 12 distractors** with variety:
   - 3–4 synonym traps
   - 2–3 component parts
   - 3–4 same-category
   - 2–3 thematic noise
5. **Generate 12 false claims** in Chinese:
   - Mix of near-miss, category confusion, and structural errors
   - Not trivially dismissable — each must sound plausible until cross-referenced
6. **Validate**:
   - Only one consistent interpretation exists across all 16 characters
   - Every true claim is necessary (no redundancy)
   - At least 2 claims must combine to eliminate any distractor
   - The puzzle teaches meaningful semantic distinctions

### Generation output

JSON matching the puzzle data shape above. The semantic decomposition is used as an intermediate reasoning step during generation but is NOT included in the final puzzle JSON served to the client — it would leak puzzle internals. Only `chengyu`, `story`, `grid`, and `characters` are cached and served.

## UI components

### ClaimBar
- Fixed at top of game screen
- Shows current claim text with source label (e.g. "来自：马")
- Swipe gesture: swipe left on the claim bar to scroll back through previously revealed claims (older claims slide in from the left). Swipe right to return to the most recent claim.
- Subtle animation when new claim appears

### ProgressDots
- 4 dots below the claim bar
- States: filled (在 found), ring with pulse (currently searching), empty (not yet reachable)

### CharacterGrid
- 4×4 grid of cards
- Card states: closed (white, character visible), 在 (green), 不在 (grey/muted), selected (red border), wrong-flash (shake animation)
- Characters rendered in Noto Serif SC at generous size

### ActionBar
- Two buttons: 不在 (left, outlined) and 在 (right, solid green)
- Disabled until a card is selected
- Tap either to commit the declaration

### ResultScreen
- Full 成语 in large characters
- Pinyin and English meaning
- Story summary from `story` field in puzzle data
- Share button (copies emoji grid + date)
- "Come back tomorrow" / countdown

### Error / loading states
- **Loading**: show "谜语..." centered (same as v1)
- **API error / no puzzle**: show "今天的谜语还没准备好" with a retry button
- **Offline**: if puzzle was previously loaded and cached in localStorage, serve from cache

## Design aesthetic

Unchanged from current riddleyu:
- Ink-on-paper feel
- Warm cream background (`#f5f0e8`)
- Noto Serif SC for Chinese characters
- Playfair Display for English labels
- Red accent color for selections, highlights, seal decoration
- Clean, focused, no clutter
- All styles as inline JS objects in `const s = { ... }` blocks

## File structure (changed from current)

```
riddleyu/
├── src/
│   ├── main.jsx
│   ├── App.jsx                # Routes between intro/game/result phases
│   ├── index.css              # CSS variables, global reset
│   ├── puzzles.js             # Hardcoded puzzle data + getPuzzleForDate()
│   ├── hooks/
│   │   └── useGame.js         # Game state: selected, opened, claims history, declarations
│   └── components/
│       ├── IntroScreen.jsx    # How-to-play + start button
│       ├── GameScreen.jsx     # Claim bar + grid + action bar
│       ├── ClaimBar.jsx       # Current claim display + swipeable history
│       ├── CharacterGrid.jsx  # 4×4 grid of character cards
│       └── ResultScreen.jsx   # 成语 reveal + share button
├── api/
│   ├── puzzle.js              # Vercel serverless: serve cached puzzle from KV
│   └── generate.js            # Vercel serverless: generate puzzle via Claude + cache in KV
├── index.html
├── vite.config.js
├── vercel.json
├── package.json
└── CLAUDE.md
```

## Dev / local mode

`puzzles.js` contains one hardcoded puzzle in the new data shape for local development. `getPuzzleForDate()` returns hardcoded data when `import.meta.env.DEV` is true, otherwise fetches from `/api/puzzle?date=YYYY-MM-DD`. The hardcoded puzzle should be a complete, working example with all 16 claims filled in (no `...` placeholders).

## Enforcement: position-order discovery

When a player declares a character 在, the game checks whether it matches the NEXT expected position. If the player says 在 for a character that is actually 在 but at a later position (e.g., they find 功 before 到), the game treats this as a wrong guess — the card stays closed and a yellow tile is recorded. The player must find positions in order: 0 → 1 → 2 → 3.

However, declaring 不在 is always valid for any 不在 character regardless of current position progress.

## Migration from v1

- All existing components are replaced (new game mechanic)
- `useGame.js` is rewritten entirely (different state model)
- `api/puzzle.js` serves new data shape
- `api/generate.js` uses new generation prompt
- Old KV entries are incompatible — flush before deploying
- The `data/idiom.json` dataset may still be useful for validating 成语 selection
