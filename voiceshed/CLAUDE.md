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

7♭9: `drop-2 two-hand` only for now (the owner: "just drop 2 rootless"),
3 ♭7 ♭9 5 · ♭7 3 5 ♭9 — the 5 stays (no 13), so `13b9` charts aren't exact.
Its four notes are a diminished seventh chord, so one hand shape is four
dominants a minor third apart (C7♭9 = E♭7♭9 = G♭7♭9 = A7♭9 on the keys) and
four °7s (below). They stay separate voicings and separate deck entries,
connected on the sheet (the diminished family).

Altered dominant (`7alt`; the owner: "3 ♭7 ♯9 ♭13 without the move and then
♭7 3 ♭13 ♯9 with the move"): `drop-2 two-hand`, a pair — 3 ♭7 ♯9 ♭13 (top ♭13)
and ♭7 3 ♭13 ♯9, whose ♯9 on top then moves down to the ♭9 (`top_move`, tag
`movement`). G7alt: B F A♯ E♭ · F B E♭ A♯ → A♭. Plays chart `7alt`, `7♯9`,
`7♭13` (the owner's pick) and, since a ♯5 is the ♭13 (the owner: "remember
♭13"), `7♯5` and `7♯9♯5`; `7♭9♯5`, `9♯5`, `7♭5` and aug stay skipped.

Diminished seventh (`dim7`, shown °7; the owner: "fill in fully diminished
… connect this to the dominant 4 chords that have the same rootless shape"):
`drop-2 two-hand`, all four inversions (the owner: "I want all 4"): R ♭5 𝄫7 ♭3
· ♭5 R ♭3 𝄫7 (the 7♭9 shapes seen from the °7's own root, so E°7's first
voicing, E3 B♭3 D♭4 G4, is C7♭9's on the same keys) · ♭3 𝄫7 R ♭5 · 𝄫7 ♭3 ♭5 R
— connected like a pair (all four in and out of the deck together).
Interval `bb7` (9 semitones, a seventh's letter): C°7 is C E♭ G♭ B𝄫. All 17
names charts write are in (both names on black keys; A♯°7 just makes 10%),
with their double flats (`CHARTED_DOUBLE`). Plays chart `o7` (a bare `o`, the
triad, stays skipped). **The diminished family** (`useDimFamily` in
`VoicingsPage.tsx`): a 7♭9 or °7 voicing's sheet shows, near the top, the
voicings on exactly the same keys, the four °7s (both names) and four 7♭9s
whose notes are those four, as chips that open that chord's voicing on the
same keys (else its first), underlined when in the deck, and "+ Add the whole
family to my deck (N voicings)". They aren't partners — each is its own chord,
added on its own unless the family button is used. Name mode already counts
any library voicing on the same keys, so E°7 is a right answer for C7♭9's
3 ♭7 ♭9 5 and vice versa.

**The iii** (the owner: "for the 3 chord of a key … we don't wanna play the 9
bc it's not in the key, instead we play the 8, or play block chords 5 7 1 3 5"):
every m7 also has voicings tagged `iii` (`isIii`) — drop-2 two-hand ♭3 ♭7 1 5 ·
♭7 ♭3 5 1 (a pair of their own: `partnersOf` keeps iii and 9 pairs apart),
right-hand 5 ♭7 1 ♭3 (one shape: "I don't want the bunch at the top"), and the
block chord 5 ♭7 1 ♭3 5 in `closed (block)` (the type that was "m7b5 closed",
renamed in seed version 12; it holds the m7♭5's block too). Em7: G D E B ·
D G B E, B D E G, B D E G B. Practice uses them (and only them) for One key's
iii and for a m7 that's the iii of a tune's home major key, in whatever key
it's played (`candidatesFor(…, iii)`); everywhere else a m7 keeps its 9. Cards,
sheets and prompts say "as iii"; the map gives them their own row (m7 as iii).

The 6 chord (C6): one shape only, `drop-2 two-hand` 3 6 9 5 (the owner: "one
inversion 3 6 9 5"); flat names on black keys (C♯6, F♯6, G♯6 are rare on
charts).

m7♭5: the spread 1 ♭5 ♭7 11, whose top voice then moves to the ♭3 — one
voicing, a **movement**, not two (`top_move`; tags `spread`, `movement`) —
files under `drop-2 two-hand` (the owner: "only the spread one goes under
drop 2"; it has its root, so no `rootless` tag), so a drop-2 ii–V–i plays it.
The m7♭5 block chord ♭5 ♭7 1 ♭3 ♭5 (5 notes) is its own type, `closed (block)`. Moves so far: the
m7♭5 spread's 11 → ♭3, the altered ♭7 3 ♭13 ♯9's ♯9 → ♭9 (a shape's `move`
in `SHAPE_SETS`). The register is the
owner's call and is settled: bottom note E♭3 to D4 for every family.

Spelling: each note is spelled as its interval above the root. A black-key
root is in the library under **both** names, flat and sharp (D♭m7 and C♯m7,
G♭7 and F♯7), each a card of its own — the owner wants both available. A name
that would need a double accidental is left out (E♭m7♭5 and A♭m7♭5 would need
B𝄫 and E𝄫, so only D♯m7♭5 and G♯m7♭5 — the owner declined adding them;
A♯maj7 likewise) — except where charts use that name (`CHARTED_DOUBLE`, the
owner: "keep the ones charts actually use"): D♭7♭9 (F C♭ E𝄫 A♭, 54% of its
chart appearances) and A♭7♭9 (C G♭ B𝄫 E♭, 93%); every altered name charts
use — E7alt's ♯9 is F𝄪, B7alt's C𝄪, C♯/F♯/G♯7alt's D𝄪/G𝄪/A𝄪, D♭7alt's ♭13
B𝄫, G♭7alt's E𝄫, and the moves to D♭'s E𝄫, G♭'s A𝄫, A♭'s B𝄫. Notes are stored with
ASCII `bb`/`##` and shown as 𝄫/𝄪. Single ones stay,
however rare (F♭, C♭, E♯, B♯) — but a spelling charts barely use is left out
too (`RARE_SPELLINGS`: under 10% of that chord's appearances in the 1,460
standards where the other name is in the library — A♯m7, C♯maj7, D♯m7, C♯7,
G♯7, A♯m7♭5, F♯maj7, G♯m7, C♯6, F♯6, G♯6, D♯7♭9, G♭7♭9, G♯7♭9, A♯7♭9,
D♯7alt, A♯7alt). Both names stay only where charts use both: D♭m7 / C♯m7,
G♭7 / F♯7, D♭7♭9 / C♯7♭9, D♭/C♯, G♭/F♯ and A♭/G♯7alt. So a white key has 14
voicings, a black key 14, and D♭/C♯ and G♭/F♯ 18, plus a 6 chord each, two
7♭9s per name (13 names), two 7alts per name (15), four °7s per name (17) and
four iii voicings per m7 name (13). 364 voicings in all.

Everywhere a root is picked (Name mode, the Key filter, Practice's keys) a
black key shows both names and either counts. Progressions and tunes keep one
spelling: a chord takes the voicings spelled as the chart spells it.
Progressions are spelled from their key's name (in G♭: A♭m7 D♭7 G♭maj7), and
a black key's ii–V–I comes under both names (D♭ and C♯, G♭ and F♯) where
every chord then spells cleanly and none is a rare spelling: 24 progressions
(no C♯ or F♯ major ones: they'd need G♯m7, G♯7, F♯maj7 or C♯7; C♯ and F♯
minor are in, their V being G♯7alt and C♯7alt).

The seed is versioned (`SEED_VERSION` in `app/api/voiceshed/schema.ts`,
stored in `voiceshed_meta`): raising it adds the voicings a database doesn't
have yet (its own, edited or not, are left alone; a deleted one comes back),
updates the progressions' steps, and drops progressions no longer generated.
Version 3 also changed what was there: the m7♭5 spread's ♭3 cards went
(answers with them) and its 11 cards got their `top_move`; version 4 moved the
spread from its own type into `drop-2 two-hand`, keeping its tags; version 5
removed the rare spellings (generated ones only — a voicing added by hand stays);
version 6 added the 6 chord (into the library, not the deck); version 7 the
7♭9s, version 8 the altered dominants, version 9 the °7s (likewise);
version 10 ended the minor ii–V–i on m7; version 11 added the °7's other two
inversions; version 12 the iii voicings (and the `closed (block)` rename).

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
  diatonic chords of a key, a tune's changes in any key, or **My charts** (a
  song from the owner's iFake Pro playlists, below). **Voicings**: Drop-2
  two-hand or Right-hand rootless (the owner: "I don't care about filtering
  for tags … I just wanna switch between right-hand rootless and drop-2s";
  kept as the type's tag in `spec.tags`, `drop-2` by default; the tag-filter
  set is gone). A chord with no voicing of that type is skipped ("none of
  this voicing type yet"). Progressions and tunes step in
  order, each chord voiced by the voicing that moves least from the last.
  Runs are saved (`voicing_runs`) and compared with the last run of the set.
  Right-but-slow and missed cards become due now — if they're in the deck; any
  that aren't are listed with "Add N to deck", never added on their own.
  **Every set** (the owner: "every practice page should allow me to click to
  see all the possible chords so I can add them to my deck"; "make choose
  voicings a bit more obvious") has one big button, "+ Add this set's/tune's
  voicings to your deck · N chords · k of M voicings in your deck ›", opening
  **Choose voicings** (the owner: "selectively add voicings to my deck"): every
  chord the set plays (`BuiltSet.order`: label, count, and whether as a iii —
  whatever the shuffle or card limit, progressions in their own order), with
  "+ Add all N" and Done pinned at the bottom. Only the voicings the set plays
  are offered: a iii's iii voicings, every other chord's own; another m7 has a
  collapsed "Show Dm7 as iii (8 for 9) ▾" (the owner: "a little hidden button")
  that adds its iii voicings below, outside Add all. Block chords (the owner:
  "add block chords to the sheet"), whatever the voicing type picked, as a
  "Block chord" row under the chord — the iii's 5 ♭7 1 ♭3 5 and the m7♭5's;
  another m7's block sits behind its iii toggle. They're offered, not played
  in runs, so they aren't in Add all. The sheet lists the chords in
  the order they come ("Cm7 ×2 · 2/4 in deck"),
  each with its voicings as the Voicings page's cards — + Deck on each (its
  other inversion with it), tap one for its sheet. The tune search finds the
  standards and the owner's iFake Pro songs (theirs first).
  **My charts** (the owner: "see the tunes I have in ifakepro and add chord
  charts from there"): every playlist the owner owns or edits in iFake Pro
  (`app/api/voiceshed/charts.ts`, matched by email through `ifp_profiles`;
  spectators get the public ones), each song with its written key, "x/y
  chords" the library plays (exact chords, tags picked) and ↗ to the chart in
  iFake Pro. Picking a song runs it like a standard; each playlist has
  "+ Add all <playlist>'s N voicings to my deck" — a show's set in one go —
  and Choose voicings… over the whole playlist.
  Chords are read in chart order, a 1- or 2-bar repeat sign playing the bars
  it stands for, a chord held into the next bar written once; repeats and
  endings aren't unfolded (as with the standards). Read-only: charts are
  edited in iFake Pro.
  **Exact chords only** (`exactChartChord` in `lib/theory.ts`): a chart chord
  is played only when the library has its chord type — maj7 (`^`, `^7`,
  `^9`), 6 (`6`, `69`; the voicing carries the 9), m7 (`-7`, `-9`), 7 (`7`,
  `9`, `13`; the voicings carry the 9 and 13), 7♭9 (`7b9`), altered (`7alt`,
  `7#9`, `7b13`, `7#5`, `7#9#5`), °7 (`o7`), m7♭5 (`h`, `h7`); a slash chord
  as the chord above the slash. Everything
  else is skipped, never stood in for, and the preview lists what's skipped
  with counts ("no voicing yet", or "none with these tags"). The same holds
  for progressions. The minor ii–V–i ends on m7 for now (the owner: "we can
  just end on m7"; `starterProgressions`, seed version 10): Dm7♭5 G7alt Cm7.
  Across the 1,460 standards that plays 88% of chords (469 tunes whole); the
  biggest gaps, by chords: bare major triad 2.9%, bare minor triad 1.8%, sus 1.6%, m6 1.4%, 7♯11 1.3%, maj7♯11 0.7%, other altered (7♭5,
  aug, 7♭9♯5) 0.6%, m(maj7) 0.4%, m11 0.3%, 13♭9 / 7♭9♭13 0.2%.
- `/voiceshed/voicings` — **Map** (default) or **List**, kept on the device.
  The map (`components/ProgressMap.tsx`) is the progress view, **one chart per
  voicing type** (the owner: "separate charts for the different rootless
  types"): tabs above it — drop-2 two-hand, right-hand rootless, closed (block) —
  each with "known/in deck", the pick kept on the device; everything below
  (circle, totals, slowest, grid, and the page's deck bar) is that chart's.
  Keys as columns round the cycle of fourths, chords as rows (m7, 7, 7♭9, °7,
  7alt, maj7, 6, m7♭5), scrolling both ways with both headers pinned; each
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
  deck holding one of a pair gets the other on load. On screen (`VoicingGrid`,
  used by the list and Practice's Choose voicings; the owner: "make it more
  obvious when cards are connected by an inversion"; their pick of four
  mock-ups: "rails with rounded lines") each card of a pair keeps its border
  with a thick bottom edge, and a rounded fork joins those edges into one
  "+ Deck both / ✓ Both in deck" button (°7's four: a 2 × 2, a short rail
  joining each top card to the one below, "+ Deck all 4"); the rails turn full
  accent when all are in the deck. A voicing with no partner keeps its own button. The 6 and the m7♭5s have
  no partner; a 7♭9's diminished siblings aren't partners. Shape tags (`3-7-9-5`,
  `1-5-7-11`…) stay on the voicings but aren't offered as filters, here or in
  Practice.

**The card** (Play and Spell; the owner: "the bottom note, what kind of voicing,
and then the top note … three big headers", since they build from the bottom up):
the chord, then three boxes — **Bottom** (note and interval), **Voicing**
(Drop-2 / Right-hand / Block, with two-hand / rootless / as iii), **Top** (note,
interval, and "→ ♭3" for a move). Review → Settings → "Play and Spell cards
show": Bottom & top (default), Bottom, or Top (`settings.cues`); the voicing type
always shows, and the answer shows both.

**Sideways on a phone, only in a run** (the owner: "allow me to play in
landscape mode on my phone but only … when I'm reviewing cards"): the installed
app is portrait (manifest `orientation`); `useRunOrientation` in `CardRunner`
calls `screen.orientation.lock('any')` while a run is on screen and `unlock()`
(back to portrait) when it ends, and sets `html.vt-running`. A browser tab can't
lock, so on a sideways phone (landscape, height ≤ 500px, touch) outside a run a
cover asks to turn it upright (`.vt-rotate` in `TrainerShell`). In a run the
card packs into one row (chord and the three boxes) above full-width keys.

**Answer modes**: Play (tap keys; whole octaves away is fine, never with the
bottom below `lowest_register`), Spell (A–G pad; ♭/♯ after a letter change
the note before it, as it's said — A then ♭ is A♭, ♭ again A𝄫, a third time A;
a full pad waits 650 ms for
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
- `app/api/voiceshed/`: `bundle`, `tunes`, `charts` (+ `charts.ts`), `sync`, `viewer`; `schema.ts`
  (`ensureTrainer`), `sync.ts` (`applySync`), `db.ts`.
- `public/voiceshed-sw.js`, `public/voiceshed/` (manifest, icons),
  `styles/voiceshed.css` (light/dark by system), `db/schema.sql`.

## Data

`VOICESHED_DATABASE_URL` if set, else the jazz database (`JAZZ_DATABASE_URL`).
Tunes are always read from the jazz app's `standards` (via its `getDb`), and
My charts from iFake Pro's database (`IFAKEPRO_DATABASE_URL`, its `getDb`;
read only; none set or no tables = no charts).
Tables (made on first use by `ensureTrainer`, also in `db/schema.sql`):
`voicings` (global; `notes` spelled bottom to top with octave), `contexts`
(ii–V–I and ii–V–i, black keys under both names; the minor one ends on m7
for now), `attempts`, `srs_state` (owner × voicing × mode;
`interval_days`), `voicing_runs`, `voiceshed_meta` (seed version). `user_id` is the owner's email.

API: `GET bundle` (library, progressions, the owner's schedules, last 20k
answers, last 500 runs), `GET tunes`, `GET charts` (the owner's iFake Pro
playlists as tunes), `POST sync` (owner only; voicing
upserts/deletes, attempts, srs, runs; idempotent, newer schedule wins),
`GET viewer`.

## Offline

Everything lives in IndexedDB (`voiceshed`). Answers are saved with
`synced = false`; schedules changed on the device are `dirty`. Sync runs on
open, on `online`, after a session and every 2 min while anything waits:
push, pull (dirty schedules keep the device copy), tunes weekly, My charts
every time (kept in IndexedDB `meta` as `charts`; a failed fetch keeps the
device copy), then the pages
and their `/_next/static` code (fonts included, via next/font) through the
service worker (production only). Tested on a production build: opened online,
cut off, reloaded all three pages, reviewed, ran a tune, reconnected, uploaded.

## Next (from the spec)

Other altered chords (7♭5, 7♭9♯5, aug); 7♭9 and 7alt in other voicing types; m6; hand-split practice (2+2 vs 1+3); loop /
harmonise-a-line mode (a top line + a chord rule, e.g. Barry Harris
sixth-diminished, voiced in a chosen family, movable to any key); interval
answer mode.
