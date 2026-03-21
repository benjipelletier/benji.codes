# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install    # install dependencies
npm run dev    # start Vite dev server (uses hardcoded puzzles locally)
```

There are no tests. Deployment is to Vercel via GitHub push.

## What this is

A daily 成语 (Chinese four-character idiom) puzzle game. The player finds clusters of semantically related characters and picks the correct one for each position in the idiom. Built for people learning Chinese at a beginner to intermediate level.

## Game mechanic

- 16 characters in a 4×4 grid, grouped into 4 clusters of 4
- Each cluster contains 1 correct 成语 character + 3 semantically related distractors
- Player solves clusters sequentially (in 成语 order):
  1. **Picking phase**: Read the cluster hint, select 4 matching characters from the grid (Connections-style)
  2. **Choosing phase**: Read a mini lesson explaining distinctions, then pick the correct character
- Wrong cluster guess → 4 yellow tiles in share result
- Wrong specific pick → 1 yellow tile in share result
- No lives system — wrong guesses only affect share score

## Key data concept: clusters

Each cluster has `{ hint, chars, answer, lesson }`. The `hint` describes what all 4 characters share. The `lesson` explains what makes the `answer` unique among the 4.

## Puzzle data shape

```json
{
  "date": "YYYY-MM-DD",
  "chengyu": {
    "chars": ["字","字","字","字"],
    "pinyin": "xxx",
    "meaning": "English meaning"
  },
  "story": "Chinese story summary",
  "grid": ["字", ...16 chars shuffled],
  "clusters": [
    {
      "hint": "一句话描述这四个字的共同主题",
      "chars": ["字","字","字","字"],
      "answer": "字",
      "lesson": "一句话解释为什么这个字是正确的"
    },
    ...4 clusters total
  ]
}
```

## Tech stack

- **Frontend**: React + Vite
- **Hosting**: Vercel
- **Daily puzzle API**: Vercel serverless function (`/api/puzzle.js`)
- **Caching**: Vercel KV (Redis) — puzzle generated once per day
- **AI generation**: Anthropic API (`claude-sonnet-4-20250514`)

## Current state

- 1 hardcoded puzzle in `src/puzzles.js` for dev (马到成功)
- AI generation via Anthropic API is in `api/generate.js`
- `getPuzzleForDate()` uses hardcoded data in dev, fetches from `/api/puzzle?date=YYYY-MM-DD` in production
- To manually trigger puzzle generation: `GET /api/generate?date=YYYY-MM-DD&force=true` with `Authorization: Bearer CRON_SECRET`
- `force=true` regenerates clusters/lessons for the SAME 成语 (for prompt tweaking)

## File structure

```
riddleyu/
├── src/
│   ├── main.jsx              # Entry point
│   ├── App.jsx               # Routes between intro/game/result phases
│   ├── index.css             # CSS variables, global reset, animations
│   ├── puzzles.js            # Hardcoded puzzle data + getPuzzleForDate()
│   ├── hooks/
│   │   └── useGame.js        # Game state: selected, solvedClusters, answers, declarations
│   └── components/
│       ├── IntroScreen.jsx   # How-to-play with SVG visuals + start button
│       ├── GameScreen.jsx    # Hint/lesson bar + grid + action bar
│       ├── ClaimBar.jsx      # Current hint or lesson display
│       ├── CharacterGrid.jsx # 4×4 grid of character cards with multi-select
│       └── ResultScreen.jsx  # 成语 reveal + share button
├── api/
│   ├── puzzle.js             # Vercel serverless: serve cached puzzle from KV
│   └── generate.js           # Vercel serverless: generate puzzle via Claude + cache in KV
├── index.html
├── vite.config.js
├── vercel.json
├── package.json
└── CLAUDE.md
```

## Design aesthetic

Ink-on-paper feel. Warm cream tones (#f5f0e8). Noto Serif SC for Chinese characters. Playfair Display for English labels. Red accent for selections. All styles as inline JS objects in `const s = { ... }` blocks. See `index.css` for CSS variables.

## Things to keep in mind

- All 16 grid characters must be distinct
- Each cluster's answer must match the corresponding 成语 position
- This is a learning game — lessons teach semantic distinctions between similar characters
- Chinese characters should use Noto Serif SC at generous size
- `used_chengyu` in KV tracks all used 成语 to prevent repeats
