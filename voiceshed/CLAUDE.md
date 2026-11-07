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

The 6 chord (C6): one shape only, `drop-2 two-hand` 3 6 9 5 (the owner: "one
inversion 3 6 9 5"); flat names on black keys (C♯6, F♯6, G♯6 are rare on
charts).

m7♭5: the spread 1 ♭5 ♭7 11, whose top voice then moves to the ♭3 — one
voicing, a **movement**, not two (`top_move`; tags `spread`, `movement`) —
files under `drop-2 two-hand` (the owner: "only the spread one goes under
drop 2"; it has its root, so no `rootless` tag), so a drop-2 ii–V–i plays it.
`m7b5 closed` ♭5 ♭7 1 ♭3 ♭5 (5 notes) stays its own type. Moves so far: the
m7♭5 spread's 11 → ♭3. Next, when altered dominants come: ♯9 on top moving
to the ♭9 — a shape's `move` in `SHAPE_SETS` takes it. ♭9 and altered dominants come later. The register is the
owner's call and is settled: bottom note E♭3 to D4 for every family.

Spelling: each note is spelled as its interval above the root. A black-key
root is in the library under **both** names, flat and sharp (D♭m7 and C♯m7,
G♭7 and F♯7), each a card of its own — the owner wants both available. A name
that would need a double accidental is left out (E♭m7♭5 and A♭m7♭5 would need
B𝄫 and E𝄫, so only D♯m7♭5 and G♯m7♭5; A♯maj7 likewise). Single ones stay,
however rare (F♭, C♭, E♯, B♯) — but a spelling charts barely use is left out
too (`RARE_SPELLINGS`: under 10% of that chord's appearances in the 1,460
standards where the other name is in the library — A♯m7, C♯maj7, D♯m7, C♯7,
G♯7, A♯m7♭5, F♯maj7, G♯m7). Both names stay only where charts use both:
D♭m7 / C♯m7, G♭7 / F♯7. So a white key has 14 voicings, a black key 14, and
D♭/C♯ and G♭/F♯ 18, plus a 6 chord each. 188 voicings in all.

Everywhere a root is picked (Name mode, the Key filter, Practice's keys) a
black key shows both names and either counts. Progressions and tunes keep one
spelling: a chord takes the voicings spelled as the chart spells it.
Progressions are spelled from their key's name (in G♭: A♭m7 D♭7 G♭maj7), and
a black key's ii–V–I comes under both names (D♭ and C♯, G♭ and F♯) where
every chord then spells cleanly and none is a rare spelling: 22 progressions
(no C♯ or F♯ ones: they'd need G♯m7, G♯7, F♯maj7 or C♯7).

The seed is versioned (`SEED_VERSION` in `app/api/voiceshed/schema.ts`,
stored in `voiceshed_meta`): raising it adds the voicings a database doesn't
have yet (its own, edited or not, are left alone; a deleted one comes back),
updates the progressions' steps, and drops progressions no longer generated.
Version 3 also changed what was there: the m7♭5 spread's ♭3 cards went
(answers with them) and its 11 cards got their `top_move`; version 4 moved the
spread from its own type into `drop-2 two-hand`, keeping its tags; version 5
removed the rare spellings (generated ones only — a voicing added by hand stays);
version 6 added the 6 chord (into the library, not the deck).

---

## Pages (`app/voiceshed/`)

Links between them are plain `<a>`, so the service worker can serve each one
with no connection. Tabs sit along the bottom on a phone, in the top bar on a
wide screen; a run hides both.

- `/voiceshed` — SRS Review, from **the deck**: only the voicings the owner
  added on the Voicings page (the owner: "only what I add"; nothing joins on its
  own). Adding a voicing brings its Play, Spell and Name cards (an `srs_state`
  row each, `reps` 0 = new, due now); new ones come in the order added, a
  voicing's three modes spread through the session. An empty deck sends you to
  the Voicings page. A miss
  comes round again 4 cards later, once. Summary: accuracy, average time,
  slowest cards. The ✈ Offline panel and sign in/out.
  **This session** (`components/ReviewSetup.tsx`) tailors the run, kept on the
  device: answer modes (at least one), chord types, voicing types, keys (empty
  row = all), black-key chords under both names / flats / sharps, which cards
  (due now incl. context gap; new, within the day's limit; not due yet,
  soonest first — answered early they're rescheduled from then), and length
  (10–60 or all). Chips count the cards due now with them, given the other
  rows. A line above Start says what the session is.
- `/voiceshed/practice` — Practice in Context: ii–V–Is (one key or all), the
  diatonic chords of a key, a tune's changes in any key, or a tag filter; tags
  also choose which voicings a progression uses. Progressions and tunes step in
  order, each chord voiced by the voicing that moves least from the last.
  Runs are saved (`voicing_runs`) and compared with the last run of the set.
  Right-but-slow and missed cards become due now — if they're in the deck; any
  that aren't are listed with "Add N to deck", never added on their own.
  A tune's preview has "+ Add this tune's N voicings to my deck" (every voicing
  of every chord it plays, in its spelling, with the tags picked) — for
  learning a set.
  **Exact chords only** (`exactChartChord` in `lib/theory.ts`): a chart chord
  is played only when the library has its chord type — maj7 (`^`, `^7`,
  `^9`), 6 (`6`, `69`; the voicing carries the 9), m7 (`-7`, `-9`), 7 (`7`,
  `9`, `13`; the voicings carry the 9 and 13), m7♭5 (`h`, `h7`); a slash chord
  as the chord above the slash. Everything
  else is skipped, never stood in for, and the preview lists what's skipped
  with counts ("no voicing yet", or "none with these tags"). The same holds
  for progressions: a ii–V–i's 7alt and m6 are skipped until they exist.
  Across the 1,460 standards that plays 79% of chords (151 tunes whole); the
  biggest gaps, by chords: 7♭9 4.3%, altered 3.7%, bare major triad 2.9%, °7 2.2%,
  bare minor triad 1.8%, sus 1.6%, m6 1.4%, 7♯11 1.3%, maj7♯11 0.7%,
  m(maj7) 0.4%, m11 0.3%.
- `/voiceshed/voicings` — **Map** (default) or **List**, kept on the device.
  The map (`components/ProgressMap.tsx`) is the progress view: keys as
  columns round the cycle of fourths, voicing type × chord as rows (m7, 7,
  maj7, 6, m7♭5 per type), scrolling both ways with both headers pinned; each
  voicing a tile of three stripes (Play, Spell, Name): not in deck (dashed),
  new (outlined), learning (amber, by accuracy), learned (green, deeper the
  faster against target), a red dot for due; a black key's two spellings side
  by side. Above it a circle of fifths shaded by the share of each key's deck
  cards learned (tap a key to scroll to its column), voicings known (all three
  modes learned) of those in the deck, cards learned per mode, the five
  slowest cards; S/M/L tile size. Tap a tile to open its sheet. In map view the
  filter folds behind a Filter button; it narrows the map too.
  The list: every voicing, narrowed with a stackable filter
  (`components/VoicingFilter.tsx`): rows you scroll sideways and tap — Key
  (cycle of fourths), Chord, Voicing (each type drawn as a mini keyboard of one
  that fits the other rows), Only (muddy, context gap, not learned yet) — plus
  a text search. OR within a row, AND across rows; each chip shows how many it
  would leave given the other rows and fades at zero. What's picked sits in a
  sticky bar (tap a token to drop it, Clear for all) and in the address
  (`?key=F,Bb&chord=m7&type=drop-2+two-hand&only=new&q=`). Results grouped by
  chord, round the cycle of fourths. A voicing's sheet: tags, muddy, lowest
  register, notes, per-card target, per-mode stats (accuracy, average,
  isolated vs in-context; target editable once it's in the deck). Add and
  delete voicings. **The deck from here**: a "+ Deck / ✓ In deck" button on
  each voicing, "Add N to deck" / "Remove" for everything the filter shows, the
  sheet's Add / Remove, and "in my deck" / "not in my deck" in the Only row.
  Removing takes the cards' schedules out (`srsDeletes` in sync; the outbox
  holds them offline); answers stay, for the stats. **Inversions are
  connected** (the owner): a voicing and its other inversion — same chord,
  same voicing type (`partnersOf`) — are added and removed together, and a
  deck holding one of a pair gets the other on load. The 6 and the m7♭5s have
  no partner. Shape tags (`3-7-9-5`,
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

**Movement** (`top_move`): Play asks for the chord, then a tap where the top
goes ("now move the top"; lifting the old top on the way is fine; the move must
land in the chord's octave). Spell has one slot more, after an arrow. The
prompt says "→ ♭3" while asked and names the note once answered; Name grades
the chord and its starting top as before and shows the move after. The
Voicings page shows "C G♭ B♭ F → E♭" with the target outlined on the keys.

**Real piano size** (Review → Settings → Play keyboard; `lib/scale.ts`): Play's
keys drawn a piano's width, 23.5 mm (an octave 16.5 cm), from CSS px per real
inch — guessed from the device (iPads 132, iPad mini 163) and checked once
with a bank card held against an on-screen bar (85.6 mm), nudged ± and kept on
the device. Key size 100/90/80/70% of real. A screen shows what fits: an iPad
sideways 8–10 real keys, but two-hand drop-2 and m7♭5 spread span 10–12, so
‹ › move a key at a time and 8va an octave (taps stay); a voicing too wide to
show starts at its bottom note. The answer stays on the same keys at the same
size. Sideways on a wide screen the chord and verdict sit side by side above
the keys.

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
