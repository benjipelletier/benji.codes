# Jazz Practice Log — Claude Code Notes

A multi-user practice logging app for jazz piano. Each user logs practice sessions per standard, recording which skills (LH shells, RH melody, walking bass, etc.) they practiced and at what BPM. Single owner today (configured by `JAZZ_OWNER_EMAIL`); unauthenticated visitors see the owner's data in spectator mode.

This is a redesign — the previous cross-song familiarity feature (`mastered_skills` × `common_progressions` × `chart_progressions`) was stripped out.

---

## Tech Stack

- Next.js 16 (App Router) inside the benji.codes monorepo (React 19)
- Postgres on Neon (`@neondatabase/serverless`)
- Neon Auth (current Better Auth–based product, `@neondatabase/auth`) — auth providers configured in the Neon dashboard
- Tailwind CSS, recharts (sparklines)
- iReal Pro chart import via `ireal-reader`

> Note: the legacy `@stackframe/stack`–based "Neon Auth (legacy)" product is **not** what we use. Don't reintroduce `NEXT_PUBLIC_STACK_*` env vars.

---

## Env vars (`.env.local`)

Most are provisioned by the Vercel ↔ Neon integration and pulled via `vercel env pull .env.local --environment=development`.

```
JAZZ_DATABASE_URL=postgres://...                       # auto-injected by Neon ↔ Vercel
JAZZ_NEON_AUTH_BASE_URL=https://<endpoint>.neonauth.<region>.aws.neon.tech/neondb/auth
                                                       # auto-injected by Neon Auth ↔ Vercel
JAZZ_NEON_AUTH_COOKIE_SECRET=<32+ char random>         # MUST set manually (openssl rand -base64 32)
JAZZ_OWNER_EMAIL=you@example.com                       # the user whose data spectators see
```

Sign-in providers (Google, GitHub, email, etc.) are toggled in the **Neon Console → jazz project → Auth tab**, not in code. The Neon-hosted Auth server handles OAuth registration on your behalf.

---

## Data flow

1. **Source charts**: 1,460 jazz standards in `charts_raw/jazz.ireal` (a single concatenated iReal Pro URI).
2. **Parse step** (`scripts/parse-ireal.ts`): runs `ireal-reader` over the file, normalizes keys/time-sig, applies a style→BPM heuristic (the dataset has zero embedded BPMs), and writes `data/standards.json` + `data/standards.summary.json`.
3. **Seed step** (`scripts/seed.ts`): runs `db/schema.sql`, inserts the owner user, the 10 checklist skills, and all standards from `data/standards.json`. Idempotent.
4. **Runtime**: app reads from Postgres. The static JSON files are not loaded by the running app.

---

## Schema (`db/schema.sql`)

```
standards              — title, composer, style, home_key, target_bpm, bpm_source ('ireal'|'style_heuristic'|'manual'), chart_data JSONB
checklist_skills       — the 10 practice dimensions; tracks_bpm=false for "By memory"
practice_sessions      — one per sitting: user_id (TEXT, Stack user id), standard_id, practice_key, started_at, ended_at, notes
practice_session_items — per-skill row inside a session: skill_id, bpm, duration_seconds, notes
target_bpm_changes     — audit trail of who changed target_bpm
```

User identities live in `neon_auth.user` (Better Auth's default `user` table, in the `neon_auth` schema, managed by Neon and populated on first sign-in). We store `user_id` as TEXT without a FK constraint — `neon_auth.user` rows can be deleted when accounts are removed. To get display info (name/email/avatar) for a user, JOIN against `neon_auth.user` on `id`.

Cross-song familiarity tables (`common_progressions`, `chart_progressions`, `mastered_skills`, `practice_log`) are intentionally gone. The redesign is logging-first; mastery analytics are punted until the data is rich enough to support a smart formula (likely recency-decay + reps).

---

## API routes (`app/api/jazz/`)

Reads return data for the viewed user (session user if signed in, else owner via spectator mode). Writes require auth.

- `GET /api/jazz/viewer` — who's signed in / who's being viewed
- `GET /api/jazz/standards` — paginated list with `?q=<search>`, `?sort=title|recent|target_bpm`, `?limit`, `?offset`
- `GET /api/jazz/standards/[id]` — chart + per-skill log summary + recent-session sparkline data
- `PATCH /api/jazz/standards/[id]` — body `{ targetBpm }`; writes audit row
- `GET /api/jazz/skills` — checklist skill catalog
- `GET /api/jazz/sessions` — viewed user's sessions, filter `?standardId=`
- `POST /api/jazz/sessions` — body `{ standardId, practiceKey?, notes?, items: [{ skillId, bpm?, durationSeconds?, notes? }] }`
- `DELETE /api/jazz/sessions/[id]` — session owner only

Neon's HTTP driver doesn't support transactions; `POST /api/jazz/sessions` inserts the session, then items sequentially, and rolls back via `DELETE` on failure.

---

## UI pages (`app/jazz/`)

- `/jazz/standards` — searchable, paginated list (1,460 entries). Each card shows target BPM, sessions count, skills-logged count, last-practiced relative time.
- `/jazz/standards/[id]` — chart in selected key, editable target BPM (auth-gated), skill panel with last/best BPM + days-since + sparkline, "+ Log practice session" button → `PracticeSessionForm` modal.
- `/jazz/voicings` (+ `/practice`, `/library`) — the voicing trainer; see below.
- Header (`app/jazz/layout.tsx`): Google sign-in / sign-out + spectator indicator.

`ChartDisplay` is reused from the old design with `progressions={[]}` — the bar-highlighting machinery is unused now but easy to wire back in.

---

## Running locally

```bash
# One-time: parse iReal source into JSON
npx tsx jazz/scripts/parse-ireal.ts

# Apply schema + seed catalog
JAZZ_DATABASE_URL=... JAZZ_OWNER_EMAIL=... npx tsx jazz/scripts/seed.ts

# Dev server
npm run dev
```

To import additional charts later, append more songs to `charts_raw/jazz.ireal` (or replace it), re-run `parse-ireal.ts`, then re-run `seed.ts` — the seed is `ON CONFLICT (title, composer) DO NOTHING`, so existing rows aren't touched.

---

## Design decisions worth knowing

1. **`practice_key`** is captured per session (not per item). Same song in a different key on a different day is a different session.
2. **Mastery is intentionally not computed** in v1. The UI shows raw signals (last BPM, best BPM, days-since, sparkline) so we can see what "mastery" should feel like before locking a formula.
3. **Target BPM is shared** across all users for now. `target_bpm_changes` tracks who edited what; per-user override can come later without a destructive migration.
4. **All 1,460 source charts had null BPM** (iReal Pro doesn't ship tempo metadata in this collection). Target BPM is seeded from a style heuristic in `lib/style-bpm.ts` (e.g. "Medium Swing" → 130, "Ballad" → 70, "Up Tempo Swing" → 220). Anyone signed in can adjust.
5. **`is_minor` flag** on standards comes from iReal Pro's key encoding (`C-` means C minor). UI uses it to display "Gm" vs "G".

---

## Voicing trainer (`/jazz/voicings`)

Flashcards and timed drills for piano voicings, built from the "Voicing Trainer
v1" spec. The goal is speed: a card counts as **learned** only when it is
answered right *and* under its target time (default 2 s, set per mode in
Review → Settings and per card in the Library). Right but slow is a weak pass
and comes back sooner. Works fully offline.

**Pages** (links between them are plain `<a>`, so the service worker can serve
each one with no connection):
- `/jazz/voicings` — SRS Review: cards due across all three modes, then new
  cards (15 a day by default, each voicing starting on a different mode, one
  new mode per voicing per day). A miss comes round again 4 cards later, once.
  Summary: accuracy, average time, slowest cards. Also the ✈ Offline panel.
- `/jazz/voicings/practice` — Practice in Context: a set (ii–V–Is in one key or
  all, the diatonic chords of a key, a tune's changes in any key, or a tag
  filter; tags also choose which voicings a progression uses), a mode, a timed
  run. Progressions and tunes step in order and pick, for each chord, the
  voicing that moves least from the last. Every run is saved (`voicing_runs`)
  and compared with the last run of the same set. Right-but-slow and missed
  cards become due now.
- `/jazz/voicings/library` — browse/search/filter by chord, key, family and tag,
  grouped by chord; a voicing's sheet edits tags, muddy, lowest register,
  notes, per-card target, and shows per-mode stats (accuracy, average,
  isolated vs in-context medians). Add and delete voicings.

**Answer modes**: Play (tap the keys; the voicing may be played whole octaves
away, never with its bottom below `lowest_register`), Spell (A–G + ♭/♯ pad,
accidental first; enharmonics accepted unless strict spelling is on), Name
(root + quality + chord tone on top; any library voicing with the same keys
counts). Play and Spell submit themselves once the note count is reached.
Timed from the card being painted to the answer.

**Context gap**: when a card's isolated median (last 10 right answers) is over
target and ≥ 25% slower than its in-context median (≥ 3 of each), it's flagged:
in Review it's pulled in up to 2 days early and its interval steps are halved.

**Code**: `jazz/lib/voicings/` (`theory.ts` spelling, qualities, chart-symbol
mapping, starter generator; `srs.ts` scheduling and queue; `practice.ts`
grading and set building; `idb.ts` IndexedDB), `jazz/components/voicings/`
(`TrainerProvider` holds state + sync; `Keyboard`, `NotePad`, `CardRunner`
shared by all pages), `app/api/jazz/trainer/` (`schema.ts`, `sync.ts`),
`public/jazz-voicings-sw.js`, `jazz/styles/voicings.css`.

**Data** (tables in `db/schema.sql`, also created on first use by
`ensureTrainer`): `voicings` (global library; `notes` spelled bottom to top
with octave, e.g. `{F3,Ab3,C4,Eb4}`), `contexts` (ii–V–I / ii–V–i in 12 keys;
steps may pin a voicing, else voice leading picks), `attempts`, `srs_state`
(one per user × voicing × mode; `interval_days`), `voicing_runs`. The first
bundle read seeds 624 starter voicings (drop-2 inversions of maj7, m7, 7, m7♭5,
6, m6, °7, m(maj7), 7sus; rootless A/B of maj7, m7, 7, 7alt, 7♭9, m7♭5, 6, m6 —
all 12 keys) and the progressions when empty, and brings in each
`chord_voicings` row (popover voicings) once, spelled from its MIDI notes.

**API**: `GET /api/jazz/trainer/bundle` (library, progressions, the viewed
user's schedules, last 20k answers, last 500 runs), `GET /api/jazz/trainer/tunes`
(every standard's chord sequence), `POST /api/jazz/trainer/sync` (owner only:
voicing upserts/deletes, attempts, srs, runs; idempotent, newer schedule wins).

**Offline**: everything lives in IndexedDB (`jazz-voicings`). Answers are saved
with `synced = false`; schedules changed on the device are `dirty`. Sync runs on
open, on `online`, after a session and every 2 min while anything waits:
push, then pull (dirty schedules keep the device copy), tunes weekly, then
the pages and their `/_next/static` code are fetched through the service worker
(production only). A spectator's answers stay on the device (`local_only`).
Tested on a production build: opened online, cut off, reloaded all three
pages, reviewed and ran a tune, reconnected, uploaded.

---

## Not yet built / future ideas

- Mastery score with recency decay and rep counting
- Per-user target BPM overrides
- Practice history calendar / heatmap
- iReal Pro file upload UI for importing new playlists from the browser
- Session in-progress mode (start a session, add items as you go, end it)
- Cross-song progression familiarity (the original idea — shelved, schema can be added back later)
- Voicing trainer v2 (from the spec): hand-split practice (2+2 vs 1+3), loop / harmonise-a-line mode (a top line + a chord rule, e.g. Barry Harris sixth-diminished, voiced in a chosen family, movable to any key), interval answer mode
