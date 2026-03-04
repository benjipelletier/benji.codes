# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install    # install dependencies
npm run dev    # start Vite dev server (uses hardcoded puzzles locally)
```

There are no tests. Deployment is to Vercel via GitHub push.

## What this is

A daily 成语 (Chinese four-character idiom) puzzle game, inspired by Wordle. The player solves 4 riddles to identify 4 characters, chains them together, and uncovers today's idiom. Built for people learning Chinese at a beginner level.

## Game mechanics

1. A 4×4 grid of 16 Chinese characters is shown — shuffled, no visible grouping
2. There are 4 riddles, one per character position in the 成语 (slot 0, 1, 2, 3)
3. Riddles are revealed one at a time. Each riddle describes a **semantic category** that applies to multiple characters in the grid (e.g. "I am an animal" → 马, 龙, 虎, 牛 are all in the grid)
4. The player clicks a character from the grid that matches the current riddle
5. That character locks into the chain (slot 0 → 1 → 2 → 3), and the next riddle appears
6. Once all 4 slots are filled, the player submits
7. Feedback per character: 🟩 green = correct char correct slot, 🟨 yellow = correct char wrong slot, ⬜ grey = not in 成语
8. 5 lives total. Wrong attempt resets the chain; player tries again with feedback visible

## Key data concept: slotMap

Each of the 16 grid characters belongs to exactly one slot (0–3). `slotMap[i]` tells which slot `grid[i]` is an answer or imposter for. This controls which characters are selectable — only characters whose `slotMap` value equals `currentSlot` are clickable at any given time.

Example for 马到成功:
- Slot 0 (马): real=马, imposters=龙,虎,牛 → all have slotMap value 0
- Slot 1 (到): real=到, imposters=来,去,行 → all have slotMap value 1

## Puzzle data shape

```json
{
  "date": "YYYY-MM-DD",
  "chengyu": ["字","字","字","字"],
  "pinyin": "mǎ dào chéng gōng",
  "meaning": "English meaning",
  "origin": "One sentence historical context",
  "riddles": [
    { "type": "字谜|形谜|场景谜", "text": "Chinese riddle", "translation": "English translation of the riddle", "hint": "English hint for hint button" },
    { "type": "...", "text": "...", "translation": "...", "hint": "..." },
    { "type": "...", "text": "...", "translation": "...", "hint": "..." },
    { "type": "...", "text": "...", "translation": "...", "hint": "..." }
  ],
  "grid": ["字", ...16 chars total, shuffled],
  "slotMap": [0, 1, 2, ...16 slot indices matching grid positions]
}
```

## Tech stack

- **Frontend**: React + Vite
- **Hosting**: Vercel
- **Daily puzzle API**: Vercel serverless function (`/api/puzzle.js`)
- **Caching**: Vercel KV (Redis) — puzzle generated once per day, cached 25h
- **AI generation**: Anthropic API (`claude-sonnet-4-20250514`)

## Current state

- Hardcoded puzzles in `src/puzzles.js` (2 puzzles for dev/testing)
- AI generation via Anthropic API is built in `api/puzzle.js` but not yet wired to the frontend
- The frontend currently calls `getPuzzleForDate()` synchronously from hardcoded data
- To switch to AI: make `getPuzzleForDate` async and fetch from `/api/puzzle?date=YYYY-MM-DD`

## File structure

```
riddleyu/
├── src/
│   ├── main.jsx              # Entry point
│   ├── App.jsx               # Routes between intro/game/result phases
│   ├── index.css             # CSS variables, global reset
│   ├── puzzles.js            # Hardcoded puzzle data + getPuzzleForDate()
│   ├── hooks/
│   │   └── useGame.js        # All game logic (state, selection, feedback, lives)
│   └── components/
│       ├── IntroScreen.jsx   # How-to-play + start button
│       ├── GameScreen.jsx    # Main game: header, history, chain, riddle, grid, actions
│       └── ResultScreen.jsx  # End screen: 成语 reveal, meaning, attempt history
├── api/
│   └── puzzle.js             # Vercel serverless: generate + cache daily puzzle
├── index.html
├── vite.config.js
├── vercel.json
├── package.json
└── CLAUDE.md
```

## Design aesthetic

Ink-on-paper feel. Warm cream tones (`#f5f0e8`). Noto Serif SC for Chinese characters. Playfair Display for English labels. Red seal stamp decoration. Clean, focused, no clutter. Feels handcrafted rather than digital. See `index.css` for CSS variables.

All styles are inline JS objects defined in a `const s = { ... }` block at the bottom of each component file.

## Riddle types

Each riddle uses one of three types. The `type` field is informational; the frontend doesn't render it differently.

**字谜 (Character Composition)** — use when the character has 2+ clearly decomposable components.
Describe how the parts combine without naming the character. e.g.:
- 功: "出力又出工，缺一不可。" / "Effort and labor — neither can be missing." / hint: "工 (work) + 力 (strength) = 功"
- 石: "山崖下藏着一张嘴，坚硬千年。" / "A mouth hidden beneath a cliff — hard for a thousand years." / hint: "厂 (cliff) + 口 (mouth) = 石"
- 到: "持刀而至，方才到达。" / "Carry a blade beside 'arrive' — and you've gotten there." / hint: "至 (to reach) + 刂 (knife) = 到"

**形谜 (Visual/Shape)** — use for visually simple characters (few strokes, geometric).
Describe what you see without naming it. e.g.:
- 一: "万物之始，我只有一笔，横贯天地。" / "The beginning of all things — just one stroke." / hint: "A single horizontal line"
- 二: "比一多一笔，比三少一笔，两横平行。" / "One more than one, one fewer than three — two parallel lines." / hint: "Two horizontal strokes"

**场景谜 (Scene Riddle)** — fallback when A/B don't work. A vivid specific scenario, NOT a broad category ("I am an animal" is forbidden). e.g.:
- 马: "皇帝出征，骑着我才能打天下。" / "The emperor rides me to conquer the realm." / hint: "A powerful animal ridden by warriors and emperors"
- 鸟: "春天清晨，我在树梢叫醒你。" / "On a spring morning, I wake you from the treetop." / hint: "A feathered creature that sings at dawn"

The `translation` field is displayed below the Chinese riddle text in a small italic Playfair Display font, helping learners who can't fully read the Chinese. The `hint` is shown only when the player taps the hint button.

## Things to keep in mind

- This is a learning game — riddles and feedback should feel educational, not punishing
- The grid must always look scrambled — never reveal column groupings visually
- Chinese characters should always use Noto Serif SC at generous size
- The hint button exists so beginners aren't stuck — using it should feel fine, not penalised
- Yellow feedback is important: "you found a real character but put it in the wrong slot" — make sure this is clearly communicated
