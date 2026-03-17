# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install    # install dependencies
npm run dev    # start Vite dev server (uses hardcoded puzzles locally)
```

There are no tests. Deployment is to Vercel via GitHub push.

## What this is

A daily 成语 (Chinese four-character idiom) puzzle game. The player reads a narrative story with 4 emoji placeholders, then gathers witness testimonies to identify each character. Each emoji hint represents one character; witnesses give indirect clues. Once you're convinced, you hit "solve" to reveal it.

## Game mechanics

1. **Story Canvas** — a 4-line narrative is shown at the top, with emoji placeholders for each of the 4 characters
2. **Witness Box** — shows the active emoji large, then testimonies from named witnesses (2–3 per character). Each testimony hints at the character without ever naming it. The emoji replaces the character in the testimony text.
3. **Solve** — when confident, tap "🐎 = 马 → solve" to reveal that character in the canvas
4. **All 4 solved** — full idiom appears, victory screen shown, share button available
5. **Persistence** — game state saved to localStorage by date; archive grows over time
6. **Echo** — in the archive, a spaced-recall widget shows emoji row of a past puzzle and asks you to identify the idiom (4-choice quiz)

## Puzzle data shape

```json
{
  "date": "YYYY-MM-DD",
  "chengyu": ["字","字","字","字"],
  "pinyin": "mǎ dào chéng gōng",
  "meaning": "English meaning",
  "origin": "One sentence historical context in English",
  "origin_zh": "同样的故事，简单中文",
  "story": [
    { "before": "将军骑着", "char": "马", "after": "，一路疾驰，" },
    { "before": "", "char": "到", "after": "达前线，敌军闻风丧胆，" },
    { "before": "大获全", "char": "成", "after": "，凯旋而归，" },
    { "before": "此乃盖世之", "char": "功", "after": "。" }
  ],
  "riddles": [
    {
      "emoji": "🐎",
      "type": "场景谜",
      "text": "Chinese riddle",
      "translation": "English translation",
      "hint": "English hint for hint button",
      "witnesses": [
        { "speaker": "将军 · General Wei", "text": "「testimony using 🐎 in place of 马」", "translation": "English" },
        { "speaker": "史书 · The Chronicle", "text": "「...」", "translation": "..." }
      ]
    }
  ],
  "grid": ["字", ...16 chars shuffled],
  "slotMap": [0, 1, 2, ...16 slot indices]
}
```

Note: `grid` and `slotMap` are generated but unused by the current UI (witness-based game doesn't use the grid). They're kept for potential future use.

## Tech stack

- **Frontend**: React + Vite
- **Hosting**: Vercel
- **Daily puzzle API**: Vercel serverless function (`/api/puzzle.js`)
- **Caching**: Vercel KV (Redis) — puzzle generated once per day, cached 25h
- **AI generation**: Anthropic API (`claude-sonnet-4-20250514`)
- **Analytics**: Vercel Analytics

## File structure

```
riddleyu/
├── src/
│   ├── main.jsx              # Entry point
│   ├── App.jsx               # Renders EmojiPrototype + Analytics
│   ├── index.css             # CSS variables, global reset
│   ├── puzzles.js            # Hardcoded puzzles (dev) + getPuzzleForDate()
│   ├── Game.jsx              # The entire game (story canvas, witness box, archive, echo)
│   ├── components/           # Old grid-game components — kept but unused
│   │   ├── IntroScreen.jsx
│   │   ├── GameScreen.jsx
│   │   └── ResultScreen.jsx
│   └── hooks/
│       └── useGame.js        # Old grid-game hook — kept but unused
├── api/
│   ├── puzzle.js             # Vercel serverless: serve puzzle from KV
│   └── generate.js           # Vercel cron: generate + cache daily puzzle via Anthropic API
├── index.html
├── vite.config.js
├── vercel.json               # Rewrites + cron (5 AM ET daily)
├── package.json
└── CLAUDE.md
```

## LocalStorage schema

```
riddleyu_v1       — { date, solved: bool[4], activeChar: 0–3 }
riddleyu_archive  — [{ date, dateLabel, idiom, emojis: str[], pinyin }, ...]
```

## Design aesthetic

Ink-on-paper feel. Warm cream tones (`#f5f0e8`). Noto Serif SC for Chinese characters. Playfair Display for English labels. Red seal stamp on victory. Clean, focused, handcrafted rather than digital. All styles are inline JS objects inside each component.

## Riddle types

**字谜** — character decomposition. Describe how the parts combine without naming the character.
**形谜** — visual shape. Describe what you see without naming it.
**场景谜** — scene riddle. Vivid specific scenario, NOT a broad category. "I am an animal" is forbidden.

## Witness guidelines

- Each witness is a named character relevant to the origin story
- 2–3 per riddle; more witnesses appear as player taps "+ another witness"
- Never name the target character directly — describe its role, effect, or feeling
- Use the riddle emoji as a stand-in for the character in the testimony text
- Testimonies should feel literary and atmospheric, not dry hints
