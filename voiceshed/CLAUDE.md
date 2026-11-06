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
1 ♭5 ♭7 ♭3. ♭9 and altered dominants come later. The register is the
owner's call and is settled: bottom note E♭3 to D4 for every family.

Spelling: each note is spelled as its interval above the root. A black-key
root is in the library under **both** names, flat and sharp (D♭m7 and C♯m7,
G♭7 and F♯7), each a card of its own — the owner wants both available. A name
that would need a double accidental is left out (E♭m7♭5 and A♭m7♭5 would need
B𝄫 and E𝄫, so only D♯m7♭5 and G♯m7♭5; A♯maj7 likewise). Single ones stay,
however rare (F♭, C♭, E♯, B♯). 219 voicings in all.

Everywhere a root is picked (Name mode, the Key filter, Practice's keys) a
black key shows both names and either counts. Progressions and tunes keep one
spelling: a chord takes the voicings spelled as the chart spells it.
Progressions are spelled from their key's name (in G♭: A♭m7 D♭7 G♭maj7), and
a black key's ii–V–I comes under both names (D♭ and C♯, G♭ and F♯) where
every chord then spells cleanly: 26 progressions.

The seed is versioned (`SEED_VERSION` in `app/api/voiceshed/schema.ts`,
stored in `voiceshed_meta`): raising it adds the voicings a database doesn't
have yet (its own, edited or not, are left alone; a deleted one comes back),
updates the progressions' steps, and drops progressions no longer generated.

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
  **Exact chords only** (`exactChartChord` in `lib/theory.ts`): a chart chord
  is played only when the library has its chord type — maj7 (`^`, `^7`,
  `^9`), m7 (`-7`, `-9`), 7 (`7`, `9`, `13`; the voicings carry the 9 and 13),
  m7♭5 (`h`, `h7`); a slash chord as the chord above the slash. Everything
  else is skipped, never stood in for, and the preview lists what's skipped
  with counts ("no voicing yet", or "none with these tags"). The same holds
  for progressions: a ii–V–i's 7alt and m6 are skipped until they exist.
  Across the 1,460 standards that plays 74% of chords; the biggest gaps, by
  chords: 6/6/9 5.3%, 7♭9 4.3%, altered 3.7%, bare major triad 2.9%, °7 2.2%,
  bare minor triad 1.8%, sus 1.6%, m6 1.4%, 7♯11 1.3%, maj7♯11 0.7%,
  m(maj7) 0.4%, m11 0.3%.
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
bottom below `lowest_register`), Spell (A–G pad; ♭/♯ after a letter change
the note before it, as it's said — A then ♭ is A♭; a full pad waits 650 ms for
an accidental on its last note, timed from the last tap; enharmonics accepted
unless strict spelling is on), Name (root + quality +
chord tone on top; any library voicing with the same keys counts). Play and
Spell submit themselves at the note count. Timed from the card being painted.
After a miss or "Don't know" the answer is shown: chord, top note, voicing
type and notes (Name mode reveals its chord then).

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
(ii–V–I and ii–V–i, black keys under both names; the minor one's 7alt and m6
are skipped until those exist), `attempts`, `srs_state` (owner × voicing × mode;
`interval_days`), `voicing_runs`, `voiceshed_meta` (seed version). `user_id` is the owner's email.

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
