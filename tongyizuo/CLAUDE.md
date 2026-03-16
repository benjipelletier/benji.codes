# synonyms — 同义词星图

Chinese vocabulary learning tool. Teaches word distinctions through synonym clusters, collocational gravity fields, and contextual challenges.

## Tech Stack

- **Framework**: Next.js 15 (App Router) + TypeScript
- **Database**: Postgres on Neon via `@vercel/postgres`
- **LLM**: Anthropic Claude API (`@anthropic-ai/sdk`) — `claude-opus-4-6`
- **Data Source**: CC-CEDICT at `data/cedict_ts.u8` (download separately from mdbg.net)
- **Deployment**: Vercel (root directory = `synonyms/`)

## Aesthetic

Dark amber/gold: `#0a0806` background, `#d9a441` accent (`#b8831a` darker variant).
NOT the ink-on-paper look of riddleyu.
Fonts: Noto Serif SC weight 900 for Chinese characters, JetBrains Mono weight 300-500 for UI.
All styles as inline JS objects (no Tailwind, no CSS modules).

## Running locally

```bash
npm install
npm run dev   # localhost:3000
```

Needs `POSTGRES_URL` env var (Neon connection string) and `ANTHROPIC_API_KEY`.

## Key files

- `lib/types.ts` — All TypeScript interfaces
- `lib/db.ts` — DB queries: `getWordCluster`, `storeCluster`
- `lib/cedict.ts` — Runtime CC-CEDICT parser (singleton)
- `lib/enrichment.ts` — Claude API enrichment calls
- `src/app/api/cluster/[word]/route.ts` — Main API route
- `src/app/page.tsx` — Search/explore landing page
- `src/app/cluster/[word]/page.tsx` — Cluster view page
- `src/components/SynonymGraph.tsx` — SVG graph visualization
- `src/components/CollocationField.tsx` — Orbital collocation display
- `src/components/ChallengeMode.tsx` — Situation quiz
- `scripts/build_clusters.py` — Offline CC-CEDICT → clusters JSON

## Data model

Bipartite graph: Chinese words ↔ English gloss tokens.
Two words sharing a gloss = one synonym edge. More shared glosses = tighter synonyms.
Clusters = projections onto the Chinese word side (2–12 members).

## Gloss normalization rules

Strip prefixes: `"to "`, `"to be "`, `"to get "`, `"to make "`, `"to become "`, `"a "`, `"an "`, `"the "`
Strip suffixes: `" (of sth)"`, `" (sb)"`, `" (sth)"`, `" sth"`, `" sb"`, `" (lit.)"`, `" (fig.)"`, `" (coll.)"`
Remove: parentheticals `(...)`, text after `;`
Skip entirely: starts with `"classifier "`, `"variant of "`, `"see "`, `"abbr. "`, `"surname "`, `"CL:"`
Min token length: 2 chars after cleaning

## Color palette per word (up to 6 words)

```
0: #d9a441  (amber/gold — primary)
1: #41b8d9  (cyan)
2: #d94141  (rose)
3: #41d972  (green)
4: #9b41d9  (violet)
5: #d97841  (orange)
```
