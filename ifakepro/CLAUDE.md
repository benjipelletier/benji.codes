# iFake Pro — Claude Code Notes

An iReal Pro clone for the band's show charts at `benji.codes/ifakepro`.
Playlists of lead sheets, public to read. People with a playlist's invite link
sign in with Google and can then edit charts together, comment on bars, and
browse every version. Also: setlist mode (one chart full-screen, swipe
through), print/PDF, export back to iReal Pro, and a standards library of
1,460 charts to copy from.

## Tech

- Next.js App Router pages (`app/ifakepro/`) rendering client components (`ifakepro/components/`).
- API at `app/api/ifakepro/`, Postgres on Neon through the HTTP driver (`getDb()` in `app/api/ifakepro/db.ts`).
- Site-wide Neon Auth (`lib/auth.ts`). Anyone can sign in; what they may do is decided by playlist membership.
- No new dependencies. iReal links are read and written by our own code (`lib/ireal.ts`), not `ireal-reader`, because round-tripping needs every barline, ending and mark.

## Env vars

```
IFAKEPRO_DATABASE_URL=postgres://…        # Neon (Vercel ↔ Neon integration)
IFAKEPRO_ADMIN_EMAILS=a@x.com,b@y.com     # who can create playlists; unset = nobody (fails closed)
IFAKEPRO_NEON_FETCH_ENDPOINT=http://…     # optional, local dev only: a Neon HTTP proxy in front of a plain Postgres
```

Set up the tables (idempotent): `IFAKEPRO_DATABASE_URL=… npx tsx ifakepro/scripts/setup-db.ts`.

## Who can do what

- **Anyone**: read every public or unlisted playlist (unlisted ones aren't listed), its songs, comments, history and activity; export, print, setlist mode.
- **Editors** (joined through `?invite=<token>` while signed in): edit charts and song info, add, import, reorder, copy and delete songs, comment, resolve, restore versions.
- **Owner** (who created it; admins count as owners everywhere): visibility, reset the invite link, remove people, delete the playlist.
- **Admins** (`IFAKEPRO_ADMIN_EMAILS`): create playlists.

Emails are only sent to a playlist's owner (in the member list). Everyone else sees names and avatars.

Local dev: with `next dev` only, an `ifp_dev_user=<email>` cookie signs you in as that email without Google (`lib/session.ts`). Production never reads it. The shared auth module still needs `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` set, but dummy values are fine locally.

## Chart model (`lib/chart.ts`)

iReal lays charts out 16 cells to a row, and a bar owns a run of cells (usually 4). We keep exactly that:
`Chart { v: 1, bars: Bar[] }`, where each `Bar` has a stable `id` and its `cells` (each holding a chord in iReal spelling, a symbol `x` `r` `p` `n`, an alt chord, small, and the marks text/segno/coda/fermata/end), plus `open` (`|` `[` `{`), `close` (`]` `}` `Z`), `section`, `time`, `ending`, `spacer` (empty cells before the bar, e.g. an indented 2nd ending), `vspace` and `br` (an editor line break).

Bar ids are what comments (`bar_id`), merges and version diffs hang on. Copies and pastes get new ids.

Chords stay in iReal spelling (`C-7`, `Bb^7`, `F#h7`, `Eb7b9/G`, `W/C`). `lib/chords.ts` normalises typed input (`Cm7`, `Cmaj7`, `C△7`, `Cø`…), formats for display (fake-book signs, or spelled out), and transposes. The editor types a whole bar as one line (`C-7 F7`, `.` for an empty cell, `%` repeat, `C7(Db7)` alt) via `parseBarText` / `barToText`.

## iReal format (`lib/ireal.ts`)

`irealb://` + percent-encoded songs joined by `===`, with the playlist name last. Each song is `Title=Composer==Style=Key=Transpose=1r34LbKcu7<scrambled music>=Comp=BPM=Repeats`. The music is scrambled in 50-character chunks (`obfusc50`, which undoes itself), and uses the shorthands `Kcl` = `| x`, `LZ` = ` |`, `XyQ` = 3 empty cells. Composers are stored "Last First" and swapped for display. `findLinks` also pulls links out of iReal's exported HTML.

`npx tsx ifakepro/scripts/test-lib.ts` reads all 1,460 standards, writes each back out and reads it again (they must be identical), checks no characters are skipped, cross-checks chords against `ireal-reader`, and unit-tests merge, diff and chords.

## Collaboration (`components/useSongSync.ts`, `lib/merge.ts`)

- Every save is `PATCH /songs/[id] {baseRevision, meta, chart}` and lands only if `revision` still equals `baseRevision`, using `UPDATE … WHERE revision = $base`. Otherwise the server returns 409 with the current song.
- The client three-way merges bar by bar (base = last server state, mine, theirs) and saves again. If both people changed the same bar, theirs wins and a toast names who.
- Autosave runs 800ms after the last edit. Saves retry with backoff when offline.
- `GET /songs/[id]/poll?rev=&bar=&editing=` runs every 3s (8s for guests) while the tab is visible. It returns any newer revision (merged in when we have unsaved edits), presence (`ifp_presence`, 20s window), and a comment stamp that tells the client to refetch comments.
- Undo and redo replay one's own steps as three-way merges, so they never undo a collaborator's edits.

## Versions and the edit log

- Each save adds or updates a row in `ifp_versions`. Saves by the same person within 10 minutes fold into one version, like Google Docs. Naming a version (`label`) stops further folding into it.
- The summary comes from `lib/diff.ts` ("Edited bars 5–8, added 4 bars, key C → D").
- Restore writes the old chart as a new revision and a new `restore` version, so nothing is lost.
- `ifp_activity` is the edit log, per playlist, per song, and across everything (`/ifakepro/activity`). Edit entries point at their version and fold along with it.
- Other kinds: create, import, copy, delete, undelete, reorder, comment add/reply/resolve, member join, playlist create/update.

## Schema (`db/schema.sql`)

| Table | What it holds |
|---|---|
| `ifp_profiles` | Copied from Neon Auth on sign-in, since that table lives in another DB |
| `ifp_playlists` | Includes `slug`, `visibility`, `edit_token` and soft delete |
| `ifp_members` | `owner` / `editor` |
| `ifp_songs` | `meta`, `chart` JSONB, `revision`, `position`, soft delete |
| `ifp_versions` | Version history |
| `ifp_comments` | Threads through `parent_id`, `bar_id` NULL means the whole song, `updated_at` for the poll stamp |
| `ifp_activity` | The edit log |
| `ifp_presence` | Who has a song open, and which bar |

The Neon HTTP driver can't run interactive transactions. Multi-row inserts use `sql.transaction([...])` batches, and everything else is ordered writes or compare-and-set.

## Standards library (`lib/standards.ts`)

Parses `jazz/charts_raw/jazz.ireal` once per server instance. `next.config.ts` traces that file into the routes that read it (`/api/ifakepro/standards…`, `/playlists`, `/playlists/[slug]/songs`). Adding a standard copies its chart. The library is never written.

## UI

- The look is a lead sheet on cream paper (dark mode follows the system, with a toggle in the header).
- Fonts: Barlow Condensed for chords, Fraunces for titles, Noto Music for symbols (𝄋 𝄌 𝄐 𝄎 ♭).
- The chart (`components/ChartView.tsx`) is a 16-column grid that sizes with container units, so it reads on a phone.
- Getting charts in and out:
  - **Upload from iReal Pro**: the default tab of New playlist and Add songs. You can upload or drop the `.html` file iReal shares, or paste an `irealb://` link.
  - **⬇ iReal Pro**: a button on every playlist and song (`ExportDialog`). It offers the `irealb://` link (opens the app), the same as an `.html` file, or a copy of the link. A song is encoded in the browser from what's on screen, unsaved edits included.
- It's mobile first:
  - dialogs are bottom sheets
  - the song's comments, history and activity are a bottom sheet behind a tab bar (a side column at ≥1000px)
  - the toolbar scrolls sideways
  - tapping a bar opens a docked entry bar with quick keys (♭ ♯ – △ ø °)
  - setlist mode swipes, takes taps at the edges, and keeps the screen awake

Routes:

| Route | Page |
|---|---|
| `/ifakepro` | Home |
| `/ifakepro/songs` | All songs |
| `/ifakepro/activity` | Edit log |
| `/ifakepro/p/[slug]` | Playlist (also handles `?invite=`) |
| `/ifakepro/p/[slug]/s/[songId]` | Song |
| `/ifakepro/p/[slug]/play` | Setlist mode |
| `/ifakepro/p/[slug]/print` | Print (`?song=`, `?auto=1`) |

## Checks

- `npx tsx ifakepro/scripts/test-lib.ts`: the libraries and the 1,460-song round trip.
- `BASE=http://localhost:3000 ADMIN=<an admin email> npx tsx ifakepro/scripts/test-api.ts`: end to end against `next dev` with a throwaway database. It covers permissions, invites, conflicting saves and merges, version folding and restore, comments, activity, reorder, delete, export and copy.
