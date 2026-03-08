# CLAUDE.md — 古脉 (Gǔmài)

## Commands

```bash
npm install
npm run dev      # Vite dev server — uses seed data (no DB needed)
npm run build
```

No tests. Deploy to Vercel with root directory set to `gumai/`.

## What this is

A daily-growing fog-of-war knowledge map of Chinese dynastic history. One new node per day — 成语, historical figures, characters with etymology, or cultural concepts. Complete a micro-challenge to reveal the node's connections to the existing map.

See `spec.md` for full product spec.

## Tech stack

- **Frontend**: React + Vite (JSX)
- **Map**: d3-force for layout, React SVG for rendering, d3-zoom for pan/zoom
- **DB**: Neon Postgres via `@neondatabase/serverless`
- **AI**: Anthropic API for daily generation
- **Hosting**: Vercel

## Env vars needed

```
DATABASE_URL=         # Neon Postgres connection string
ANTHROPIC_API_KEY=    # For daily generation cron
CRON_SECRET=          # Bearer token to protect /api/gumai/generate
```

## Dev mode

Without `DATABASE_URL`, the app falls back to hardcoded seed data in `src/seedData.js` (3 nodes: 守株待兔, 韩非子, 木).

## File structure

```
gumai/
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── index.css
│   ├── seedData.js
│   ├── lib/
│   │   ├── dynasties.js      # Dynasty x-position mapping
│   │   └── progress.js       # localStorage helpers
│   └── components/
│       ├── Map.jsx            # d3-force SVG map
│       ├── Node.jsx           # Ink dot node
│       ├── Connection.jsx     # Brushstroke connection line
│       ├── FogOfWar.jsx       # Atmospheric fog overlay
│       ├── ChallengePanel.jsx # Slide-up panel (challenge + reveal)
│       ├── NodeDetail.jsx     # Completed node detail view
│       ├── Changelog.jsx      # Chronicle panel
│       ├── ReconstructChallenge.jsx
│       ├── MatchChallenge.jsx
│       └── Onboarding.jsx
├── lib/
│   └── db.js                  # Neon client (used by API routes)
├── api/
│   └── gumai/
│       ├── nodes.js           # GET all nodes + connections
│       ├── changelog.js       # GET changelog entries
│       └── generate.js        # POST daily cron (protected)
├── spec.md
├── index.html
├── package.json
├── vite.config.js
└── vercel.json
```

## Design aesthetic

Ink-on-silk. Aged parchment background (`#F5F0E8`). Ink wash nodes. Vermillion red (`#C23B22`) used sparingly for seal stamps and today's highlight. All styles are inline JS objects in `const s = { ... }` at the bottom of each component (matching riddleyu/gecijielong pattern).
