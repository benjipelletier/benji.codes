# Voiceshed — Claude Code Notes

Flashcards and timed drills for jazz piano voicings, at `benji.codes/voiceshed`.
Built from the owner's "Voicing Trainer v1" spec. Speed is the measure: a card
counts as **solid** (`learned`) only when it's answered right *and* under its
target time (default 2 s, set per mode in Review → Settings and per card on the
Voicings page) several times in a row, and then in a ii–V–I. Review drills,
rather than spacing one answer a day (below). Phone first, and works
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
| `right-hand rootless` — **later** | ♭3 5 ♭7 9 · ♭7 9 ♭3 5 | 3 5 7 9 · 7 9 3 5 | 3 13 ♭7 9 · ♭7 9 3 13 |

**The types** (the owner: "left-hand rootless, right-hand rootless and two-hand
are the main chord types, and under two-hand we have drop-2s … and then block
chords"): **Two-hand** = `drop-2 two-hand` + `closed (block)` (both tagged
`two-handed`; shown "Two-hand · drop-2" / "Two-hand · block" via `familyLabel`);
left-hand and right-hand rootless are later. The map shows Drop-2 and Block
on one Two-hand chart (split tiles where a chord has both); Practice's switch is Two-hand (tag
`two-handed`), so runs play block chords too (the owner: "we can do block in
practice runs") — voice-leading picks drop-2 or block per chord (a iii, an
m7♭5); Choose voicings keeps block chords in their own row and in Add all.
Seed version 14 tagged the block chords `two-handed`.

**Two-hand comping only, for now** (the owner: "I want to keep this as a two-hand
comping thing … get rid of all the right-handed stuff"; left-hand rootless,
for under a solo line or the melody, comes later too). `right-hand rootless`
is marked `later` in `SHAPE_SETS`: its shapes (and its iii shape, 5 ♭7 1 ♭3)
are kept but nothing is generated; seed version 13 deleted its voicings, with
their cards and answers. `LATER_FAMILIES` (left-hand rootless, right-hand
rootless) show as greyed placeholders — "later" — in Practice's Voicings
switch and the map's tabs. To bring one back: drop `later`, raise the seed.

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
right-hand 5 ♭7 1 ♭3 (one shape: "I don't want the bunch at the top"; later,
with right-hand), and the
block chord 5 ♭7 1 ♭3 5 in `closed (block)` (the type that was "m7b5 closed",
renamed in seed version 12; it holds the m7♭5's block too). Em7: G D E B ·
D G B E, and the block B D E G B. Practice uses them (and only them) for One key's
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
in `SHAPE_SETS`). On a keyboard (`Keyboard.tsx`, mark `move`) the key it moves
to is striped and outlined in the accent, and an arrow arches over the keys from
the top note to it (drawn in once; the owner: "make the motion more obvious");
written notes put "→ E♭" in the accent. The register is the
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
G♭7 / F♯7, D♭7♭9 / C♯7♭9, D♭/C♯, G♭/F♯ and A♭/G♯7alt. 275 voicings in all: drop-2 two-hand 250 (m7, its iii
pair, maj7, 6, 7, 7♭9, m7♭5, 7alt, °7) and closed (block) 25 (the iii's m7,
the m7♭5).

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
inversions; version 12 the iii voicings (and the `closed (block)` rename);
version 13 removed right-hand rootless (for now); version 14 tagged block
chords `two-handed`.

---

## Pages (`app/voiceshed/`)

Links between them are plain `<a>`, so the service worker can serve each one
with no connection. Tabs sit along the bottom on a phone, in the top bar on a
wide screen; a run hides both.

- `/voiceshed` — Review: **today's set**, from **the deck**: only the voicings
  the owner added on the Voicings page (the owner: "only what I add"; nothing
  joins on its own). Adding a voicing brings its Play, Spell and Name cards (an
  `srs_state` row each, `reps` 0 = new, due now). An empty deck sends you to the
  Voicings page. The algorithm is `lib/drill.ts` — the owner found one-answer
  spacing useless for voicings ("seeing one voicing, getting it wrong then not
  seeing it for another day … not that useful"), so a voicing is treated as a
  motor skill:
  1. **The set** (`chooseSet`, 4–10 cards, 6 by default): shaky cards first
     (answered before, not solid, or flagged for the context gap; lowest
     `fluencyScore` first — each of the last 6 answers scores target ÷ time,
     capped at 1, a miss 0), then solid cards due a check, then new ones in the
     order added (a voicing's modes spread across sets; only with "New voicings"
     on), then — to fill — solid cards ahead of their check, soonest first.
  2. **The drill** (`startDrill`, `nextSlot`, `answerDrill`): the cards mixed,
     never one twice running. A miss or slow answer comes back 2 turns later
     and resets the streak; a fast one later each time. A card leaves after
     `FLUENT_STREAK` (3) right-and-fast answers in a row — a check after 1,
     unless it slips — or after `MAX_ASKS` (10), still shaky. The top says
     "2 / 6 fluent".
  3. **In a ii–V–I** (`contextSteps`): each card that came out fluent is played
     once in the first stored progression with its chord (same root, quality,
     spelling), its own voicing there and the library's of the same family,
     voice-led, on the other chords; cards of one progression and mode share
     it. iii voicings, found ones and chords no progression has skip it.
  4. **The schedule**: every answer counts a rep; a solid card that's slow or
     missed (in the drill, the ii–V–I, or a Practice run) is demoted —
     `learned` false, due now — so it leads the next set (`demote`,
     `afterAnswer`). Leaving fluent: solid, a check in 1 day; a check passed:
     3 days, then ×2.5, at most 120 (`afterSlot`). Stuck: shaky, due now.
     `ease` is no longer used.
  The home shows shaky / checks / new and the set's cards as chips. The summary
  ("Set done") lists each card — fluent in N, check passed, still shaky, not
  finished — with how it did in context and a dot per answer, then accuracy
  (first tries), average time and the slowest cards. The ✈ Offline panel and
  sign in/out.
  **This session** (`components/ReviewSetup.tsx`), kept on the device: answer
  modes (at least one), chord types, voicing types, keys (empty row = all),
  black-key chords under both names / flats / sharps, cards in a set, and
  whether new voicings join. Chips count the cards waiting (shaky, due a check,
  new) with them, given the other rows. A line above Start says what the
  session draws from.
- `/voiceshed/practice` — Practice in Context: ii–V–Is (one key or all), the
  diatonic chords of a key, **One root** (every chord type on one root — Cm7,
  C7, C7♭9, C7alt, C°7, Cmaj7, C6, Cm7♭5 — both names of a black key, shuffled;
  the owner: "practice chords with the same root, so all C type chords"; a m7's
  iii voicings stay out), a tune's changes in any key, or **My charts** (a
  song from the owner's iFake Pro playlists, below). **Voicings**: Two-hand
  (drop-2 and block), with Left-hand and Right-hand rootless as greyed "later"
  placeholders (the owner first asked for a drop-2 / right-hand switch instead
  of tags, then to keep it two-hand; kept as the type's tag in `spec.tags`,
  always `two-handed` now; the tag-filter set is gone). A chord with no voicing of that type is skipped ("none of
  this voicing type yet"). Progressions and tunes step in
  order, each chord voiced by the voicing that moves least from the last.
  Runs are saved (`voicing_runs`) and compared with the last run of the set.
  Right-but-slow and missed cards are no longer solid (due now, at the front of
  the next set) — if they're in the deck; any that aren't are listed with "Add N to deck", never added on their own.
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
  "add block chords to the sheet") as a "Block chord" row under the chord — the
  iii's 5 ♭7 1 ♭3 5 and the m7♭5's; another m7's block sits behind its iii
  toggle. Two-hand runs play them, so Add all includes them. The sheet lists the chords in
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
- `/voiceshed/voicings` — **Map** (default), **List** or **Found**, kept on the device.
  **Found** (the owner: "log extra voicings I hear in the wild … linked to a
  certain time in a YouTube video or a Spotify song, so I always have that
  reference"): "Log a voicing you heard" opens the New voicing form in `found`
  mode — a standard (optional; searches the standards and the owner's iFake
  Pro songs), the recording (who, what), link (YouTube or Spotify, optional), time (filled from a link's `t=` or
  Spotify `#1:23`; `lib/source.ts`), chord, the notes tapped on a keyboard, a
  note. Saved as family `found` (`FOUND`, tag `found`) with `source_url`,
  `source_time` (seconds), `source_label`, and the standard as `source_tune_id`
  (a standard's id, or an iFake Pro song's) and `source_tune_title`, on the
  voicing (columns added by `TRAINER_DDL`; `applySync` keeps only http(s) links,
  ≤ 10 h, 200-char labels and titles, 100-char tune ids). The owner: "I want it
  to be attachable to a standard as well" — with or without a link.
  The Found view lists them newest first, each with its source line — "♪ Bill
  Evans — Peace Piece at 1:23 ▶ YouTube" (YouTube opens at the second; Spotify
  can't be trusted to jump, so its time is shown), above it a 𝄞 chip for its
  standard — its note and its card (+ Deck). Chips above the list narrow it to
  one standard. In Practice, a tune with found voicings gets a **Heard in this
  tune** section at the top of its Choose voicings sheet (and the button shows
  even if the tune has no other voicings); Add all takes them too.
  A found voicing's sheet shows the same line; it has no partners; Review cards
  call it "Found". Not in Practice runs (not `two-handed`). Identifying a voicing
  from audio is for later: no audio can be taken from YouTube or Spotify, but a
  mic recording or a clip through an in-browser transcriber (e.g. Basic Pitch)
  could pre-fill a guess to correct — fine on solo piano, rough in a band.
  The map (`components/ProgressMap.tsx`) is the progress view, **one chart per
  voicing type** (the owner: "separate charts for the different rootless
  types"; then "see drop-2 and block at the same time, not a toggle"): tabs
  above it — **Two-hand** (drop-2 and block on one chart, `TWO_HAND`/`chartOf`),
  and the later types as greyed placeholders —
  each with "known/in deck", the pick kept on the device; everything below
  (circle, totals, slowest, grid, and the page's deck bar) is that chart's.
  **Phone first** (the owner: "I can't scroll the map easily on mobile … see
  everything at a glance and easily move across it"): keys down the side (round
  the cycle of fourths, a black key's two names in one row, with its % learned)
  and chords across in groups (the owner: "m7 and iii together, maj7 and 6
  together, all the dominants together, the two diminisheds together"): minor
  m7 · iii | major Δ7 · 6 | dominant 7 · 7♭9 · alt | dim °7 · ø7, with a thin
  spacer column between groups (`GROUP`, `colOf`). A whole chart fits the
  screen's width with no scrolling inside it (a CSS grid, `.pm-board`; the chord
  row sticks under the top bar). **Overview**: each key × chord is a square tile
  of three bars, Play / Spell / Name, each summing all the chord's voicings there
  (`sumCards`). **Zoom** (the owner found the per-inversion tiles "busy": "clicking
  on a group could zoom in to just that group and show more details"): the group
  headings are buttons; a group alone gets bigger tiles with **a column per
  inversion, each with its own Play / Spell / Name bars** (their earlier pick,
  "both: a tiny grid in each tile"), labelled under each chord — 1st, 2nd, …,
  spread, block (a black key's two names share a column; block after a thin
  line). Each inversion is a soft pill, and connected ones (same voicing type)
  are joined by a pinched "liquid" neck (`LiquidNeck`; the owner: "connect the
  inversions with a small liquid type connector"); block stays apart behind its
  line. Chips move between groups or back ("‹ All"); so does the back button
  (`useBackClose`). Bars: not in deck (dashed), new (outlined), learning (amber),
  learned (green, deeper the faster); a red dot for due. A key above the map is
  a sample tile labelled Play / Spell / Name down its side ("all inversions"
  under it, or 1st / 2nd / block when zoomed). Tap a tile for a sheet of its
  voicings (`CellSheet` in `VoicingsPage`: both names of a black key, pairs on
  their rails, + Deck). Above it a circle of fifths shaded by the share of each
  key's deck cards learned (tap a key to light its row), voicings known (all
  three modes learned) of those in the deck, cards learned per mode, the five
  slowest cards (tap one to open its voicing). In map view the
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
the chord, then three boxes — **Bottom** (its chord tone as a number: ♭3, 5,
1 for the root), **Voicing** (Drop-2 / Block, and "rootless" or "has root" on one
line), **Top** (number, and "→ ♭3" for a move). Notes only come with the
answer (the owner: "only show the number … showing the note is giving too
much away"). Review → Settings → "Play and Spell cards
show": Bottom & top (default), Bottom, or Top (`settings.cues`); the voicing type
always shows, and the answer shows both.

**The iii and the root, said loud**: a iii card has a "No 9!" sticker under the
chord — a 9 in a circle struck through, "it's the iii · play the 8", tilted,
dashed, wiggling now and then (the owner: "a big warning sign that says no 9!",
then "make it cuter"), and every card, sheet and
list card says "rootless" or "has root" (`hasRoot` in `lib/practice.ts`; the
m7♭5 spread, the iii's, °7 and block chords have theirs).

**The back button** (the owner: "fix the back button … on Android"):
`useBackClose` (`components/useBackClose.ts`) makes each open thing a history
step — a voicing's sheet, Choose voicings, New voicing, a run, a run's
summary. Back closes the newest one (a card's sheet over the chooser first),
ends a run as END does, and takes a summary back to its set-up; only then does
it leave the page. Closing any other way (×, Done, END) takes its step back off.
history.back() is asynchronous, so pushes and backs go through one queue (a run
ending into its summary). Tested on dev and a production build.

**Little animations** (the owner: "cute jazz or piano animations on any loading
and button clicking"): loading is a small piano playing **The Lick** — D E F
G E C D in eighths, the last D held, a breath, again (the owner: "the loader's
piano should play it"; `THE_LICK` in `TrainerShell`) — with notes floating off it
(`PianoLoader`), shown only if loading lasts past 600 ms (`delay`; it used to
flash on every reload). Loading rarely lasts long enough to see it (the owner noticed),
so the piano also opens every run's summary, playing it twice (`rounds`); a tapped big button (Start run, Done) or a "+ Deck"
sends up a note — ♪ ♫ ♩ ♬ — from the finger (`useTapNotes`; only those: "every
button … is kind of a lot"); the big buttons press down like piano keys. Reduced motion turns them off.

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
it counts as shaky in Review until it's fast alone. The other way round —
fast alone, slow in a ii–V–I — is caught by the set's ii–V–I step and by
Practice runs, which demote it.

---

## Code

- `lib/`: `theory.ts` (spelling, qualities, chart-symbol mapping, `SHAPE_SETS`,
  progressions), `drill.ts` (today's set, the drill, the ii–V–I step, the schedule),
  `srs.ts` (targets, answer stats, the context gap), `practice.ts` (grading,
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
