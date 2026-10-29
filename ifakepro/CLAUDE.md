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

The API creates its tables, and brings an older database up to date (tables added since, and the columns in `MIGRATIONS` in `db/schema.ts`), the first time it meets a database without the newest table, through `ensureSchema` in `app/api/ifakepro/db.ts`, run by every route's `handle()`. To set them up ahead of time, or after a schema change, run `IFAKEPRO_DATABASE_URL=… npx tsx ifakepro/scripts/setup-db.ts` (idempotent).

## Who can do what

- **Anyone**: read every public or unlisted playlist (unlisted ones aren't listed), its songs, comments, history and activity; export, print, setlist mode.
- **Editors** (joined through `?invite=<token>` while signed in): edit charts and song info, add, import, reorder, copy and delete songs, comment, resolve, restore versions.
- **Owner** (who created it; admins count as owners everywhere): visibility, reset the invite link, remove people, delete the playlist.
- **Admins** (`IFAKEPRO_ADMIN_EMAILS`): create playlists.

Emails are only sent to a playlist's owner (in the member list). Everyone else sees names and avatars.

Local dev: with `next dev` only, an `ifp_dev_user=<email>` cookie signs you in as that email without Google (`lib/session.ts`). Production never reads it. The shared auth module still needs `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` set, but dummy values are fine locally.

## Chart model (`lib/chart.ts`)

A bar is a short timeline. `Chart { v: 2, bars: Bar[] }`; each `Bar` has a stable `id`, its frame (`open` `|` `[` `{`, `close` `]` `}` `Z`, `section`, `time`, `ending`, `spacer`, `vspace`, `br`), an optional `simile` (1- or 2-bar repeat sign), and `events`.

- An event (`Ev`) is `{id, at, dur, kind, ch?, alt?, small?, text?, segno?, coda?, fermata?, end?}`. Times are in ticks, `WHOLE = 96` to a whole note (a quarter is 24, an eighth-note triplet 8), so triplets and sixteenths are exact.
- Kinds: `chord`, `rest`, `nc` (N.C.), `hold` (the chord before keeps sounding, drawn as nothing), `slash` (keep time, `/`), `hit` (an accented stab, drawn with `>`).
- A bar's events are contiguous and fill it exactly; `fitEvents` enforces that whenever the meter changes. `meter(time)` gives the bar length, the beat (the time signature's lower note: an eighth in 6/8) and the grouping (3 in 6/8, 9/8, 12/8).
- Event ids are stable too (`${barId}.${k}` for upgraded charts, random for new ones). The editor's selection, undo and merges hang on bar and event ids. Copies and pastes get new ones.
- Repeats, endings and sections live on the bar frame, not in the events.

The old cell grid (`v: 1`, `lib/legacy.ts`) is still read: the server upgrades it on every read (`upgrade()` in `app/api/ifakepro/store.ts`, deterministic so ids don't change between reads) and `sanitizeChart` upgrades anything a client sends. `lib/convert.ts` maps cells ↔ time. When the cells divide evenly into beats it's proportional; otherwise chords snap to beats with the earlier chord taking the extra (a waltz bar of two chords is 2 + 1, Take Five's 5/4 is 3 + 2). An event keeps a `cell` hint when two cells would mean the same time, so iReal charts go out exactly as they came in.

Chords stay in iReal spelling (`C-7`, `Bb^7`, `F#h7`, `Eb7b9/G`, `W/C`). `lib/chords.ts` normalises typed input (`Cm7`, `Cmaj7`, `C△7`, `Cø`, `C7(b9)`…), splits and joins root / quality / bass for the picker, formats for display (fake-book signs, or spelled out), and transposes.

### Editing (`lib/edit.ts`, `lib/progression.ts`, `lib/forms.ts`)

Every edit is a pure `Chart → Chart` function, so undo, merges and tests all work the same way.

- Events: `setChord`, `setKind`, `splitEvent` / `splitOnGrid`, `insertAt` (a new event at a tick), `setDuration` (longer swallows what follows; shorter hands the time to the next event, or a rest at the end), `moveBoundary` (snapped, never past a neighbour), `shiftEvent`, `mergeWithNext`, `removeEvent` (the one before takes its time).
- Bars: `insertBars`, `duplicateBars`, `deleteBars` (keeps the section letter, time signature and repeat signs that were on deleted bars), `moveBars`, `clearBars`, `transposeBars` / `transposeChart`, `patchBar`.
- `parseProgression` reads typed or pasted text: `| Dm7 G7 | Cmaj7 |`, `C:3 G7:1`, `/` to continue, `r` rest, `nc`, `%`, `C7>` hit, `C7(b9)` alteration vs `C7(Db7)` alternate chord. Counts that don't divide evenly are placed long-first and flagged, and the Type panel won't apply a flagged bar until it's fixed. `barText` writes a bar back out the same way.
- `formChart` starts a song from a form: empty, 12-bar blues, jazz blues, 32-bar AABA or ABAC (minor keys get a minor blues).

## The editor (`components/ChartEditor.tsx`, `components/editor/`)

Reading view is the default; "✎ Edit chart" (or tapping a bar, or `?edit=1`) opens it. The chart stays on screen and a sheet docks at the bottom (side by side with it on a wide screen); the page pads itself so the selected bar is never hidden behind the sheet or the keyboard (`--ed-h`, `--kb` from `visualViewport`).

- Header: previous / next event, where you are ("Bar 5 · beat 3 · 2 beats"), undo, redo, Done.
- The selected bar as a `Timeline`: each event as wide as it is long; in rhythm mode a beat ruler, drag handles on the boundaries (also arrow keys; snapped to the grid) and `+` marks to start an event on a grid line.
- Tabs: **Chord** (type a chord, or pick root, quality, bass; tritone sub, ii–V, rest, N.C., more kinds), **Rhythm** (grid of 1, ½, triplet, ¼ beat; length, earlier / later, split, merge), **Bar** (insert, duplicate, delete, clear, copy / paste, move, transpose, section, time, ending, barlines, marks, a text field (first in the tab) for the bar's note: the selected beat's, else the one already in the bar, else a new one on the selected beat; comment; a selection can grow to a range, a section or everything), **Type** (paste a progression, with a live preview and flags; replace, insert, append, or the whole chart).
- Keyboard: arrows move (Shift extends), letters start typing a chord, Enter moves on (adding a bar at the end), Delete, `r` rest, `n` N.C., `s` split, ⌘Z / ⇧⌘Z, ⌘C / ⌘X / ⌘V / ⌘D. Pasting text parses it as a progression.
- Transposing is kept apart: the Chord tab changes one chord; the Bar tab moves a selection; Song info moves the whole chart's key; "View in" (concert, B♭, E♭, F, or any key) is per viewer, not saved, and the editor locks while it's on.
- Typing edits fold into one undo step (`change(fn, {coalesce})` in `useSongSync`), as do drags.

## Edits by people's AI agents

People ask their own AI agent in English ("make bars 5–8 a ii–V into C", "G7 on beat 3 of bar 12 for a beat", "add a 4-bar intro", "put it in E♭"). The agent turns that into ops and sends them here. The English stays on the agent's side; the server only speaks an exact edit language and refuses anything ambiguous. Nothing here is tied to one agent: anything that can make HTTP requests will do.

- **Access** (`agentFor` in `app/api/ifakepro/agent.ts`): `Authorization: Bearer ifp_…`, a token its person made in the app under the account menu's "✦ Your agent…" (`components/AgentTokens.tsx`, `/api/ifakepro/agent-tokens`), shown once, with a note to paste to the agent. Only a SHA-256 is kept (`ifp_agent_tokens`), with the start of it (`prefix`) to tell them apart and `last_used_at`. The agent acts as that person, with their playlists (`roleIn`; an admin's agent can edit every playlist), and its edits carry the name they gave the token ("Agent" by default), whatever a request says. Up to 10 live tokens each; revoking one shuts its agent out at once. Only its person sees or revokes it. A missing, unknown or revoked token is a 401.
- **Reading** (`lib/script.ts`): `chartText` is the chart in numbered rows, laid out as on screen (`  5 | Am7b5 | D7b13 | Gm6 | % :|`, `[A]` sections, `|: :|` repeats, `‖end`, endings, time changes, marks). `agentBars` is the same per bar, with each bar's text in the Type panel's syntax and its events by beat. Bar numbers are positions in chart order, the numbers the "# Bars" toggle shows. Beats count from 1 in the bar's own meter (eighths in 6/8); `2.5` or `2+` is the and-of-2.
- **Changing** (`applyOps` in `lib/script.ts`): ops `chords` (rewrite bars from text; counts must match), `put` (one event from a beat, optionally for n beats; what was sounding carries on after it), `remove`, `insert` (with `text` and `section`), `delete`, `clear`, `copy`, `move`, `transpose` (bars, or the whole song and its key), `key` (move or relabel), `format` (section, time for just those bars, ending, repeat, barline, segno, coda, fermata, text, new line), `info` (title, composer, style, bpm). Each is built on the editor's own `lib/edit.ts` functions.
- **Safety**: every number in a request means the chart as read at `revision`; all refs are resolved to bar ids before anything is applied, so an insert early on doesn't shift a later op. All or nothing: any problem (a bar that isn't there, a beat outside the bar, a bar the parser would flag, an unknown field, a request that changes nothing) refuses the whole request (422) with a message per op naming the bar and beat. A stale `revision` is a 409 carrying the song as it is now. `dryRun` shows the result without saving. Undo puts back the version before the agent's last edit, only while nothing has happened since.
- **Saving** (`saveSong(…, agent)` in `store.ts`): as the person, with `ifp_versions.agent`/`note` set and `ifp_songs.updated_agent`. An agent's edit is always a version of its own: it never folds, and a person's later save never folds into it. The edit log entry carries `data.agent` and `data.note`. Undo only undoes the same agent's edit for the same person.
- **In the app**: a "✦ Agent" pill (`AgentPill` in `components/ui.tsx`, with the token's name) beside the person's name in History and the edit log, with the note in quotes; someone with the song open sees its bars flash and "✦ Agent changed bars 5–8 for Benji" (the poll returns `agent`).
- **Routes** (`app/api/ifakepro/agent/`): `GET /agent` (the brief, `lib/brief.ts`, and the playlists and songs the person can edit, `?q=`), `GET|POST /agent/songs/[id]`, `POST /agent/songs/[id]/undo`, `POST /agent/playlists/[slug]/songs` (a new song from text, a form, or empty bars). The brief is what an agent reads first; keep it in step with `lib/script.ts`.

## iReal format (`lib/ireal.ts`)

`irealb://` + percent-encoded songs joined by `===`, with the playlist name last. Each song is `Title=Composer==Style=Key=Transpose=1r34LbKcu7<scrambled music>=Comp=BPM=Repeats`. The music is scrambled in 50-character chunks (`obfusc50`, which undoes itself), and uses the shorthands `Kcl` = `| x`, `LZ` = ` |`, `XyQ` = 3 empty cells. Composers are stored "Last First" and swapped for display. iReal has no rests or hits, so those export as N.C. and as plain chords, and durations iReal's cells can't show (triplets, sixteenths) go to the nearest cell. `findLinks` also pulls links out of iReal's exported HTML.

`npx tsx ifakepro/scripts/test-lib.ts` reads all 1,460 standards, writes each back out and reads it again (charts and cells must be identical), checks no characters are skipped, cross-checks chords against `ireal-reader`, and unit-tests merge, diff and chords.

## Collaboration (`components/useSongSync.ts`, `lib/merge.ts`)

- Every save is `PATCH /songs/[id] {baseRevision, meta, chart}` and lands only if `revision` still equals `baseRevision`, using `UPDATE … WHERE revision = $base`. Otherwise the server returns 409 with the current song.
- The client three-way merges bar by bar (base = last server state, mine, theirs) and saves again. If both people changed the same bar, theirs wins and a toast names who.
- Autosave runs 800ms after the last edit. Saves retry with backoff when offline.
- `GET /songs/[id]/poll?rev=&bar=&editing=` runs every 3s (8s for guests) while the tab is visible. It returns any newer revision (merged in when we have unsaved edits), presence (`ifp_presence`, 20s window), and a comment stamp that tells the client to refetch comments.
- Undo and redo replay one's own steps as three-way merges, so they never undo a collaborator's edits.

## Versions and the edit log

- Each save adds or updates a row in `ifp_versions`. Saves by the same person within 10 minutes fold into one version, like Google Docs. Naming a version (`label`) stops further folding into it. Edits by an agent never fold (see above).
- The summary comes from `lib/diff.ts` ("Edited bars 5–8, added 4 bars, key C → D").
- Restore writes the old chart as a new revision and a new `restore` version, so nothing is lost.
- `ifp_activity` is the edit log, per playlist, per song, and across everything (`/ifakepro/activity`). Edit entries point at their version and fold along with it.
- Other kinds: create, import, copy, delete, undelete, reorder, comment add/reply/resolve, member join, playlist create/update.

## Schema (`db/schema.ts`)

| Table | What it holds |
|---|---|
| `ifp_profiles` | Copied from Neon Auth on sign-in, since that table lives in another DB |
| `ifp_playlists` | Includes `slug`, `visibility`, `edit_token` and soft delete |
| `ifp_members` | `owner` / `editor` |
| `ifp_songs` | `meta`, `chart` JSONB, `revision`, `position`, soft delete |
| `ifp_versions` | Version history; `agent` and `note` on the agent's edits |
| `ifp_comments` | Threads through `parent_id`, `bar_id` NULL means the whole song, `updated_at` for the poll stamp |
| `ifp_activity` | The edit log |
| `ifp_presence` | Who has a song open, and which bar |
| `ifp_agent_tokens` | People's tokens for their own agents: a SHA-256 of each, its name, `prefix`, `last_used_at`, `revoked_at` |

The Neon HTTP driver can't run interactive transactions. Multi-row inserts use `sql.transaction([...])` batches, and everything else is ordered writes or compare-and-set.

## Standards library (`lib/standards.ts`)

Parses `jazz/charts_raw/jazz.ireal` once per server instance. `next.config.ts` traces that file into the routes that read it (`/api/ifakepro/standards…`, `/playlists`, `/playlists/[slug]/songs`). Adding a standard copies its chart. The library is never written.

## UI

- The look is a lead sheet on cream paper (dark mode follows the system, with a toggle in the header).
- The chart (`components/ChartView.tsx`) is set out like iReal Pro's:
  - handwritten chords in Petaluma Script, with the flat or sharp small and raised and the quality small and dropped (`C♭△7`, `A-7`)
  - music signs from Petaluma Text (SMuFL code points in `SMUFL`): segno, coda, fermata, the 1- and 2-bar repeat signs, time signatures, △ ø °
  - the fonts are Steinberg's unmodified `.woff2` files in `public/ifakepro/fonts/`, under the OFL; don't subset or rename them, since a modified copy may not keep the name
  - `ChartHead`: "(style · ♩ = bpm)" on the left, the title in the script font in the middle, the composer on the right; editors tap the title for Song info
- Sizes are in em of `--cs` (about 7.6% of the chart's width), so chords are as big as the row allows on any screen. Small chords are 0.8 of full size; bars with 3+ chords (or anything shorter than a beat) shrink a little, and 4+ a little more. Each bar's events sit in a grid with columns in proportion to their durations, so a chord on beat 4 sits over beat 4. Whatever still doesn't fit is shrunk in that bar alone (`fitBars` in `ChartView.tsx` sets `--fit` on the `.bar-body`, after layout, on resize and once fonts load), so chords never run over a barline. Text and marks above a chord are sized by the chart (`--cs`), not by the chord under them.
- On phones the song sheet is edge to edge; in dark mode it's near-black, like iReal.
- Song info edits the title, composer, style, tempo and key. Changing the key moves every chord there by default (the short way round); unticked, it only relabels.
- A song opens with the whole chart on one screen ("⤢ Fit", on by default, remembered per device as `usePref('fitChart')`): `useScreenRoom` in `SongPage.tsx` measures the height from the chart's top to the bottom of the window (above the phone's tab bar), and ChartView's `fitHeight` brings `--cs` down until the chart fits, but not below 15px (`MIN_FIT_CS`), past which a very long tune scrolls. Off while editing, so the editor has full-size bars; off by the toggle to read full size and scroll. On phones the crumbs and toolbar sit tight to leave the chart more room.
- "View in" next to the chart is a per-viewer transposition that isn't saved.
- "# Bars" numbers every bar (top left, after the barline or section box), remembered per device (`usePref('barNumbers')`); always on while editing.
- Getting charts in and out:
  - **Upload from iReal Pro**: the default tab of New playlist and Add songs. You can upload or drop the `.html` file iReal shares, or paste an `irealb://` link.
  - **⬇ iReal Pro**: a button on every playlist and song (`ExportDialog`). It offers the `irealb://` link (opens the app), the same as an `.html` file, or a copy of the link. A song is encoded in the browser from what's on screen, unsaved edits included.
- It's mobile first:
  - dialogs are bottom sheets
  - the song's comments, history and activity are a bottom sheet behind a tab bar (a side column at ≥1000px)
  - the toolbar scrolls sideways
  - tapping a bar opens the editor sheet (above)
  - setlist mode swipes, takes taps at the edges, and keeps the screen awake; `FitChart` finds the widest chart that fits the screen, and scrolls instead when that would make chords smaller than about 24px (a long tune on a phone held sideways)

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

- `npx tsx ifakepro/scripts/test-lib.ts`: the libraries, the 1,460-song round trip, the editor's acceptance checks as pure functions, and the agent's edit language (every standard's bars read back from their text; addressing, each op, all-or-nothing).
- `BASE=http://localhost:3000 ADMIN=<an admin email> npx tsx ifakepro/scripts/test-api.ts`: end to end against `next dev` with a throwaway database. It covers permissions, invites, conflicting saves and merges, version folding and restore, comments, activity, reorder, delete, export and copy, upgrading old charts, starting from a form, and agents (tokens shown once, reading, dry run, refusals, attribution, stale revisions, undo, new songs, their person's playlists only, their name on the pill, revoking).
- `BASE=http://localhost:3000 ADMIN=<an admin email> node ifakepro/scripts/test-editor.cjs`: the editor in Playwright, same setup, on a phone (touch) and a laptop (keyboard), checking what the server saved after each edit; then bar numbers, an agent's edit arriving live and showing in History, and making, using and revoking a token in "Your agent".
