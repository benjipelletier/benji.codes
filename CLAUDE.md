# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo structure

Single Next.js 15 monorepo. Each sub-project is a route at `benji.codes/<project_name>`, controlled by `projects.config.ts`.

```
benji.codes/
├── app/                    # Next.js App Router (pages + API routes)
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Landing page (reads projects.config.ts)
│   ├── LandingClient.tsx   # Landing page client component
│   ├── globals.css         # Landing page styles
│   ├── riddleyu/           # /riddleyu route
│   ├── gecijielong/        # /gecijielong route
│   ├── jazz/               # /jazz route
│   ├── longku/             # /longku route
│   └── api/                # API routes namespaced per project
│       ├── riddleyu/
│       ├── gecijielong/
│       └── longku/
├── projects.config.ts      # Enable/disable projects, metadata
├── riddleyu/               # Source code (components, lib, styles)
├── gecijielong/            # Source code
├── jazz/                   # Source code
└── longku/                 # Source code
```

## Running locally

```bash
npm install
npm run dev   # localhost:3000
```

## Enabling/disabling projects

Set `enabled: true/false` in `projects.config.ts`. Disabled projects don't appear
on the landing page. All four current projects are enabled.

## Key conventions

- API routes namespaced: `/api/<project>/<endpoint>`
- Env vars namespaced: `<PROJECT>_DATABASE_URL` (e.g., `GECIJIELONG_DATABASE_URL`)
- Vite projects use `dynamic(() => import(...), { ssr: false })` page wrappers
- Lazy DB initialization pattern with `getDb()` to avoid build-time env var evaluation
- Path aliases: `@riddleyu/*`, `@gecijielong/*`, `@jazz/*`, `@longku/*` defined in tsconfig paths

## Third-party data

- **longku** embeds data derived from [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict)
  (headwords, readings and English definitions), licensed
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Anything
  redistributing `longku/data/cedict*.txt` or the glosses folded into
  `chengyu.json` inherits that licence. Regenerate with
  `longku/scripts/build-cedict.py`.
- **longku** frequencies come from [wordfreq](https://github.com/rspeer/wordfreq)
  (MIT), via `longku/scripts/build-frequency.py`.

## Per-project CLAUDE.md

Each project directory has its own CLAUDE.md with project-specific details (tech stack, aesthetic, data model, etc.).
