# zhujie — 注解

## Commands
- `npm run dev` — Start dev server
- `npm run build` — Production build

## Architecture
- Next.js App Router (TypeScript)
- Neon Postgres for content/annotation cache
- Anthropic SDK (claude-opus-4-6) for annotation generation
- Inline JS style objects (no Tailwind, no CSS modules)

## Key Patterns
- Two-pass LLM: content-map (Pass 1) then lazy annotate-line (Pass 2)
- Cache keyed by SHA-256 of normalized text
- Annotation colors: amber (vocab), blue (insight), coral (grammar), green (cross-ref), purple (culture)

## Environment
- DATABASE_URL — Neon Postgres connection string
- ANTHROPIC_API_KEY — Anthropic API key
