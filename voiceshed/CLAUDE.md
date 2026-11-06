# Voiceshed — Claude Code Notes

Flashcards and timed drills for jazz piano voicings, at `benji.codes/voiceshed`.
Built from the owner's "Voicing Trainer v1" spec. Speed is the measure: a card
counts as **learned** only when it's answered right *and* under its target time
(default 2 s, set per mode in Review → Settings and per card on the Voicings page).
Right but slow is a weak pass and comes back sooner. Phone first, and works
fully offline (it was built for a 20-hour flight).

Single owner: `VOICESHED_OWNER_EMAIL`, else `JAZZ_OWNER_EMAIL` (the same person).
Everyone else is a spectator who sees the owner's progress and can practise,
but their answers stay on their device.

---

## The library: the owner's shapes only

`lib/theory.ts` → `SHAPE_SETS` is the whole generator. The owner is strict
about voicings: generate only what they've named, nothing "textbook". Shapes
are bottom to top. Every key, each placed in the lowest octave whose bottom
note is at or above **E♭3** (the E♭ below middle C), and `lowest_register = 51`
so Play mode never accepts one lower.

| Family | m7 | maj7 | 7 (the 5 becomes 13) |
|---|---|---|---|
| `drop-2 two-hand` (rootless; LH bottom two) | ♭3 ♭7 9 5 · ♭7 ♭3 5 9 | 3 7 9 5 · 7 3 5 9 | 3 ♭7 9 13 · ♭7 3 13 9 |
| `right-hand rootless` | ♭3 5 ♭7 9 · ♭7 9 ♭3 5 | 3 5 7 9 · 7 9 3 5 | 3 13 ♭7 9 · ♭7 9 3 13 |

m7♭5: `m7b5 closed` ♭5 ♭7 1 ♭3 ♭5 (5 notes) and `m7b5 spread` 1 ♭5 ♭7 11 and
1 ♭5 ♭7 ♭3. 180 voicings in all. ♭9 and altered dominants come later.

Spelling: each note is spelled as its interval above the root. Roots: flats
for maj7 and 7 (so G♭7 has F♭), C♯ F♯ G♯ for minor-family chords, and a root
that would need a double accidental takes its enharmonic (E♭m7♭5 → D♯m7♭5,
A♭m7♭5 → G♯m7♭5). The seed only runs when the `voicings` table is empty; to
regenerate after changing the shapes, empty it (attempts and schedules cascade).

---

## Pages (`app/voiceshed/`)

Links between them are plain `<a>`, so the service worker can serve each one
with no connection. Tabs sit along the bottom on a phone, in the top bar on a
wide screen; a run hides both.

- `/voiceshed` — SRS Review: cards due across all three modes, then new cards
  (15 a day; each voicing starts on a different mode, one new mode per
  voicing a day). A miss comes round again 4 cards later, once. Summary:
  accuracy, average time, slowest cards. The ✈ Offline panel and sign in/out.
- `/voiceshed/practice` — Practice in Context: ii–V–Is (one key or all), the
  diatonic chords of a key, a tune's changes in any key, or a tag filter; tags
  also choose which voicings a progression uses. Progressions and tunes step in
  order, each chord voiced by the voicing that moves least from the last.
  Runs are saved (`voicing_runs`) and compared with the last run of the set.
  Right-but-slow and missed cards become due now.
- `/voiceshed/voicings` — every voicing, narrowed with a stackable filter
  (`components/VoicingFilter.tsx`): rows you scroll sideways and tap — Key
  (cycle of fourths), Chord, Voicing (each type drawn as a mini keyboard of one
  that fits the other rows), Only (muddy, context gap, not learned yet) — plus
  a text search. OR within a row, AND across rows; each chip shows how many it
  would leave given the other rows and fades at zero. What's picked sits in a
  sticky bar (tap a token to drop it, Clear for all) and in the address
  (`?key=F,Bb&chord=m7&type=drop-2+two-hand&only=new&q=`). Results grouped by
  chord, round the cycle of fourths. A voicing's sheet: tags, muddy, lowest
  register, notes, per-card target, per-mode stats (accuracy, average,
  isolated vs in-context). Add and delete voicings. Shape tags (`3-7-9-5`,
  `1-5-7-11`…) stay on the voicings but aren't offered as filters, here or in
  Practice.

**Answer modes**: Play (tap keys; whole octaves away is fine, never with the
bottom below `lowest_register`), Spell (A–G pad, ♭/♯ armed before the letter;
enharmonics accepted unless strict spelling is on), Name (root + quality +
chord tone on top; any library voicing with the same keys counts). Play and
Spell submit themselves at the note count. Timed from the card being painted.

**Context gap**: a card whose isolated median (last 10 right answers) is over
target and ≥ 25% slower than its in-context median (≥ 3 of each) is flagged:
pulled into Review up to 2 days early, interval steps halved.

---

## Code

- `lib/`: `theory.ts` (spelling, qualities, chart-symbol mapping, `SHAPE_SETS`,
  progressions), `srs.ts` (scheduling, queue, stats), `practice.ts` (grading,
  sets, voice leading), `idb.ts` (IndexedDB), `session.ts` (owner check).
- `components/`: `TrainerProvider` (state + sync), `TrainerShell` (frame),
  `Keyboard`, `NotePad`, `CardRunner` (shared by all pages), the three pages.
- `app/api/voiceshed/`: `bundle`, `tunes`, `sync`, `viewer`; `schema.ts`
  (`ensureTrainer`), `sync.ts` (`applySync`), `db.ts`.
- `public/voiceshed-sw.js`, `public/voiceshed/` (manifest, icons),
  `styles/voiceshed.css` (light/dark by system), `db/schema.sql`.

## Data

`VOICESHED_DATABASE_URL` if set, else the jazz database (`JAZZ_DATABASE_URL`).
Tunes are always read from the jazz app's `standards` (via its `getDb`).
Tables (made on first use by `ensureTrainer`, also in `db/schema.sql`):
`voicings` (global; `notes` spelled bottom to top with octave), `contexts`
(ii–V–I and ii–V–i in 12 keys; minor steps fall back 7alt→7♭9→7, m6→m(maj7)→m7
until those exist), `attempts`, `srs_state` (owner × voicing × mode;
`interval_days`), `voicing_runs`. `user_id` is the owner's email.

API: `GET bundle` (library, progressions, the owner's schedules, last 20k
answers, last 500 runs), `GET tunes`, `POST sync` (owner only; voicing
upserts/deletes, attempts, srs, runs; idempotent, newer schedule wins),
`GET viewer`.

## Offline

Everything lives in IndexedDB (`voiceshed`). Answers are saved with
`synced = false`; schedules changed on the device are `dirty`. Sync runs on
open, on `online`, after a session and every 2 min while anything waits:
push, pull (dirty schedules keep the device copy), tunes weekly, then the pages
and their `/_next/static` code (fonts included, via next/font) through the
service worker (production only). Tested on a production build: opened online,
cut off, reloaded all three pages, reviewed, ran a tune, reconnected, uploaded.

## Next (from the spec)

♭9 and altered dominants; hand-split practice (2+2 vs 1+3); loop /
harmonise-a-line mode (a top line + a chord rule, e.g. Barry Harris
sixth-diminished, voiced in a chosen family, movable to any key); interval
answer mode.
