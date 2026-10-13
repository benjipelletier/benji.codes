# 重复习 (chongfuxi)

Spaced repetition built from the owner's Pleco decks. Pleco stays the
dictionary and the place words are added; this app reads Pleco's flashcard
backup, works out which sentences are now fully readable, and (from milestone
2) generates and schedules the cards. Route: `/chongfuxi`.

## Principles

- **Generated, not authored.** No hand-made cards. Cards are derived from
  Pleco data plus review history, and appear as more becomes readable.
- **One state machine.** Every action is an event; state is the events so far
  folded in order (`lib/machine.ts`). The UI shows the state at all times (the
  four counts in the header), previews what any action would change before it
  is taken, logs what each event did, and can show the state after any past
  event. Keep it that way: new features are new events on the same fold.
- **Record facts, derive the rest.** Imports, reviews and edits are facts and
  are never rewritten. Known words, unlock status and schedules are derived and
  can be recomputed — so rules can change later and history is replayed under
  them. Store more detail than is used today (the review log especially).

## Mobile first

The owner practises on an Android phone; the desktop is secondary. Design and
check every screen at 360px wide first.

- Navigation is a bottom tab bar (thumb reach); the header holds only the
  title and the four state counts.
- Tap targets at least 44px (36px for inline word chips); no horizontal
  scrolling; inputs and selects at 16px.
- Pad by the safe-area insets (`viewport-fit=cover` is set) so nothing sits
  under the status bar or the gesture bar.
- Installable: `public/chongfuxi/manifest.webmanifest` opens `/chongfuxi`
  full screen from the home screen. Icons are generated (习 on the accent).
- Anything heavy runs after paint with a visible "working" state; on a phone
  an import takes several seconds and a preview a few hundred milliseconds.
  Move corpus building to a Web Worker if that starts to hurt.

## Milestones

1. **Import and unlock** — done. Read a `.pqb`, choose category roles, see what
   is readable, what is one word away, and what to learn next. Mark words known
   or as names. Event log with effects and time travel. Browser storage only.
2. **Review.** Server storage (owner-only, longku's session pattern) and the
   review log; three card types on `ts-fsrs`; one mixed session.
3. **Fix agent.** Sense-tags sentences, writes notes and new sentences, splits
   meanings, resolves cards flagged with Fix.

Later: auto-import through a self-hosted Anki sync server (Pleco → AnkiDroid
→ our server reads new notes), "can I read this?" for arbitrary text, FSRS
parameters fitted to the owner's log, export.

## Pleco backups

A `.pqb` is SQLite ("Pleco SQL Flashcard Database", format 8). Undocumented;
`lib/pleco.ts` reads only what it needs and keeps it as stored:

- `pleco_flash_cards`: `hw` with `@` between characters, `pron` numbered pinyin
  with `@` between syllables and a space before each new word, `defn` only on
  custom cards, `dictid` -1 for custom cards.
- `pleco_flash_categories` (top level under a sentinel parent, -2 in practice)
  and `pleco_flash_categoryassigns`.
- `pleco_flash_scorefiles` and `pleco_flash_scores_<id>`: score (100–51200),
  correct/incorrect counts, first/last review time, and `history`, one digit per
  review oldest first (6 right, 2 wrong), no per-review dates.

Known quirks of the owner's sentence decks, all handled in `lib/corpus.ts` and
`lib/segment.ts`:

- The pinyin's word breaks are the segmentation — but ~1.4% of cards carry the
  pinyin of a different sentence (shifted rows). Pinyin is only used when it
  has one syllable per character and ≥80% of checkable syllables are readings
  the character has (readings learnt from the word cards); otherwise the text
  is split by forward maximum matching and its pinyin is not to be shown.
- Polyphones are often wrong even when the pinyin fits (every 倒 is dǎo). Take
  readings from word cards or the dictionary, never from the deck.
- Traditional characters mixed in (於, 後, 怎麽): mapped to simplified using
  the cards' own simp/trad pairs, only for characters never seen in a
  simplified headword.
- 【谚】 labels, erhua written as its own word (`@r5`), duplicate sentences
  (merged, keeping every pool they appear in), word cards filed in sentence
  decks, bracketed optional parts (点(钟)), full-width Latin (ＡＡ制).
- Grammar-pattern cards (只有…才…, 越  越) are set aside and counted; they
  are neither words nor sentences.

## Rules (milestone 1)

- **Category roles** (per top-level category, chosen at import, carried over
  to later imports): known / word list / sentences / ignore. Defaults: ACTIVE
  is known, radicals are ignored, a category of mostly sentence-shaped cards is
  sentences, the rest are lists.
- **Known word**: in a known category, or (setting, on by default) any word
  with a score in the scorefile, or marked known / as a name in the app.
- **Readable**: every word known, or splittable into known words (这个, 孩子们),
  trailing 儿 allowed. An unknown word is blamed on the part you'd learn
  (孩子们 → 孩子) when it splits into words from the Pleco data; otherwise
  whole (约翰).
- **Learn next**: words from list or known categories that alone block a text,
  ranked by how many. Everything else blocking a text is listed separately
  (names, rare words) to mark rather than learn.

## Agreed design for milestone 2

- **Word cards**, per word, each with its own FSRS schedule:
  - *Read*: the word large with one readable sentence under it (word
    highlighted); back shows pinyin, meaning, all definitions. Grade: did you
    know what it means here? No sentence available → the word alone, graded on
    its main meaning.
  - *Produce*: the definition, plus the sentence with the word blanked when one
    exists; accepted alternatives on the back. Unlocks after the read card is
    passed.
  - Context sentences rotate every review; prefer ones where every other word
    is known.
- **Meanings**: a word can be split by meaning on demand (tap the meaning you
  didn't know on the back). Each meaning gets its own schedule but stays under
  the word: shared display, sibling burying, Pleco link, merge back.
- **Sentence cards**: read the sentence, reveal the translation. Retire after
  two clean reads on different days. Forgot → tap the word(s) that tripped you;
  those words lapse. Forgetting a word brings back the sentence it was shown
  with plus one other retired sentence containing it (max two). Passing a
  sentence logs an exposure but does not move word schedules.
- **New-sentence queue**: 10 a day to start; sentences with a word never yet
  seen in context, or with the word that just unlocked them, go first.
- **Session**: one queue of everything due; cards of the same word never on
  the same day; buttons Forgot / Got it; Fix flags a card without grading it.
- **Seeding**: Pleco score and last review set the starting FSRS state for
  recognition; production starts a step lower.
- **Storage**: imports (raw file kept), words, meanings, texts, tokens (with
  how they were split), append-only reviews (card, meaning, sentence shown,
  grade, time to answer, session, scheduler version, tapped words), exposures,
  edits (who, before/after, model and prompt version for the agent),
  `pleco_history` verbatim. One-click export.
- **Dictionary**: full CC-CEDICT (the longku build keeps only 3+ characters;
  extend `longku/scripts/build-cedict.py` or add one here).

## Code

- `lib/pleco.ts` — `.pqb` → `PlecoSnapshot`, on anything with sql.js's `exec`.
- `lib/segment.ts` — sentence → words (pinyin first, dictionary fallback).
- `lib/corpus.ts` — snapshot + settings → words and texts. Pure.
- `lib/machine.ts` — events, `apply`, `derive`, `diff`, `preview`, `replay`,
  `suggestions`. Pure; the UI and the Node script share it.
- `lib/store.ts` — IndexedDB (memory fallback): imports and the event log,
  each event saved with the effects it had.
- `lib/sqljs.ts` — loads sql.js from `public/chongfuxi/vendor` (copied from
  `node_modules/sql.js/dist`; keep the versions in step).
- `components/` — shell (`ChongfuxiApp`) and the four panels.
- `scripts/check-import.ts` — run the pipeline on a backup in Node:
  `npx tsx chongfuxi/scripts/check-import.ts path/to/backup.pqb`.

The owner's backup contains copyrighted dictionary content and third-party
sentence decks; never commit one. Sentences live only in the owner's storage.
