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
│   ├── chongfuxi/          # /chongfuxi route
│   ├── ifakepro/           # /ifakepro route
│   └── api/                # API routes namespaced per project
│       ├── riddleyu/
│       ├── gecijielong/
│       ├── longku/
│       ├── chongfuxi/
│       └── ifakepro/
├── projects.config.ts      # Enable/disable projects, metadata
├── riddleyu/               # Source code (components, lib, styles)
├── gecijielong/            # Source code
├── jazz/                   # Source code
├── longku/                 # Source code
├── chongfuxi/              # Source code
└── ifakepro/               # Source code
```

## Running locally

```bash
npm install
npm run dev   # localhost:3000
```

## Enabling/disabling projects

Set `enabled: true/false` in `projects.config.ts`. Disabled projects don't appear
on the landing page. All six current projects are enabled.

## Key conventions

- API routes namespaced: `/api/<project>/<endpoint>`
- Env vars namespaced: `<PROJECT>_DATABASE_URL` (e.g., `GECIJIELONG_DATABASE_URL`)
- Vite projects use `dynamic(() => import(...), { ssr: false })` page wrappers
- Lazy DB initialization pattern with `getDb()` to avoid build-time env var evaluation
- Path aliases: `@riddleyu/*`, `@gecijielong/*`, `@jazz/*`, `@longku/*`, `@chongfuxi/*`, `@ifakepro/*` defined in tsconfig paths

## Third-party data

- **longku** embeds data derived from [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict)
  (headwords, readings and English definitions), licensed
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Anything
  redistributing `longku/data/cedict*.txt` or the glosses folded into
  `chengyu.json` inherits that licence. Regenerate with
  `longku/scripts/build-cedict.py`.
- **longku** frequencies come from [wordfreq](https://github.com/rspeer/wordfreq)
  (MIT), via `longku/scripts/build-frequency.py`.
- **chongfuxi** embeds [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict)
  (CC BY-SA 4.0) as `chongfuxi/data/cedict.txt`, rebuilt with
  `chongfuxi/scripts/build-dict.ts`, and copies its definitions onto the word
  rows it serves; the app credits it. It reads Pleco backups on the server
  with [sql.js](https://github.com/sql-js/sql.js) (MIT). The repo ships no
  sentence data: sentences come from the owner's Pleco backup, live in the
  `CHONGFUXI_DATABASE_URL` store and are served read-only. That backup
  includes third-party sentence decks.

- **ifakepro**'s standards library is the jazz project's `jazz/charts_raw/jazz.ireal`
  (1,460 iReal Pro charts), read at run time; picking one copies it into a
  playlist. Users' own charts come from iReal Pro links they paste.
- **ifakepro** draws charts in Steinberg's [Petaluma](https://github.com/steinbergmedia/petaluma)
  fonts (Petaluma Script for chords, Petaluma Text for SMuFL music signs),
  shipped unmodified in `public/ifakepro/fonts/` under the SIL Open Font
  License 1.1 (`OFL.txt` alongside).
- **chongfuxi** fetches song lyrics from [LRCLIB](https://lrclib.net) when a
  Spotify link is added (`app/api/chongfuxi/spotify.ts`), splits them into
  words and keeps only the words; the lyrics themselves aren't stored.
- **chongfuxi**'s Muse page (`app/api/chongfuxi/musepage.ts`) may quote
  passages from the web, credited with a link; pages are served only to the
  owner.
- **chongfuxi** keeps drama subtitles its owner's agent hands in
  (`app/api/chongfuxi/episodes.ts`) for the owner's study; they are served
  only to the owner, never publicly.

## 龙库 and 重复习 share a database

龙库's tables now live in `CHONGFUXI_DATABASE_URL`, and its chengyu are 重复习
deck words, linked both ways (see chongfuxi/CLAUDE.md, "龙库 is backed by this
app"). The `LONGKU_DATABASE_*` store is no longer read; it keeps the data as it
was before the move.

## Per-project CLAUDE.md

Each project directory has its own CLAUDE.md with project-specific details (tech stack, aesthetic, data model, etc.).
