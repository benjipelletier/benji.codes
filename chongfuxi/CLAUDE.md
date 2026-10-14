# 重复习 (chongfuxi)

FSRS review of the owner's Pleco words, with sentences that unlock as words
become known. Pleco stays the dictionary and the place words are added; this
app is where they are reviewed. Route: `/chongfuxi`.

## What it does

- **Words.** Every word the owner knows has cards on its own FSRS schedule.
  One mixed session, two buttons: Forgot / Got it.
- **Sentence unlocking.** A sentence becomes available the moment every word
  in it is known. Unlocked sentences are what word cards are shown in, and
  they come up as cards themselves.
- **Generated, not authored.** No hand-made cards. Cards follow from Pleco
  data and the review history.

## Principles

- **The database holds the corpus.** Words, sentences, the words each sentence
  is made of, and cards are rows. The server decides what is due and what an
  answer does. The browser draws what it is sent and reports answers; it
  builds nothing and keeps no copy.
- **Known means has a card.** The deck is every word the owner filed as their
  own in Pleco plus every word Pleco has a score for. Those are the words that
  count when deciding whether a sentence is readable, so the numbers add up.
- **Pleco's category names stay in Pleco.** The owner's own category there is
  called ACTIVE. It decides what gets imported as a word and appears nowhere
  in the app; sentences from it are labelled "Pleco".
- **Record facts, derive the rest.** The imported files and the review log are
  facts and are never rewritten. Schedules and which sentences are readable
  are derived: a card's state is its seed plus its reviews replayed in order
  (`scripts/check-review.ts` proves it), and blockers are recomputed from words
  and tokens whenever the words change.
- **One owner, everyone else looks on.** Like 龙库 and jazz: anyone can read,
  only the owner's session can write. Signed-in is not owner.
- **Words come from Pleco.** From a backup, from AnkiDroid syncs (what Pleco
  adds while its flashcards are set to Anki), or from Pleco's own word lists
  on the Lists side of Cards. In the app a blocking word can only be marked a
  name.

## Mobile first

The owner practises on an Android phone; the desktop is secondary. Design and
check every screen at 360px wide first.

- Navigation is a bottom tab bar (thumb reach): Review, Cards, Stats, Import.
  The header holds the title and one quiet line (`Glance` in
  `ChongfuxiApp.tsx`): words in the deck, distinct characters across them,
  and the share of sentences readable, each with its Chinese unit (词 字 句) in
  its kind's colour. Figures only: the owner doesn't want progress bars there,
  and found boxed counts and then badges with a bar and key too busy. (Words
  is one per deck word; the old boxes counted word cards, Read plus Recall,
  which is why the figure went from about 4k to 3k.) Signing in sits at the
  right of the title (`components/Account.tsx`): the owner's 笨鸡 (Benji) opens a
  menu with the address and Sign out; anyone else gets Sign in.
- The answer buttons are fixed just above the tab bar.
- Tap targets at least 44px (36px for inline chips); no horizontal scrolling;
  inputs and selects at 16px.
- Pad by the safe-area insets (`viewport-fit=cover` is set).
- Installable: `public/chongfuxi/manifest.webmanifest`. The icon is 重复习
  on a 3D stack of three flashcards, read left to right: 重 at the back on
  the left, 复, then 习 in front on the right, each character in the middle
  of its card (the cards overlap a little, never over a character). Drawn as a real 3D scene (CSS perspective, so far
  cards come out smaller and edges and shadows agree; a flat skew looked
  wrong to the owner), in LXGW WenKai on a blue gradient (#5b7cff to #2142c4). The owner
  asked for every character to stand out; a fan hid the back two. The maskable one keeps the
  mark in the inner 84%.
- Online to load, but no answer is lost to a dropped connection (the owner
  reviews on the subway). Every answer goes into the outbox
  (`lib/outbox.ts`, in localStorage) before it is sent, and leaves only once
  the server has it, so it survives a closed tab. A session answer is sent
  behind the next card, for its receipt; once one fails, the rest queue
  behind it in order, without receipts. Fast review puts all its answers in
  at Done. The outbox is sent, 40 to a request, on opening, on coming back
  online or to the front, every 30 s while it holds anything, and before a
  session deals more cards; cards in it are never dealt again. A line under
  the header says how many wait. The server records an id once, so sending
  twice is harmless. Each answer carries `sentAt` as it leaves: with `at`,
  that says how long it waited, so it is dated when given, whatever the
  phone's clock says (`answeredAt`, up to 30 days).
- The phone's back button moves through the app (`lib/back.ts`,
  `useBackLayer` in `components/shared.tsx`): every layer that opens over
  another (a tab other than Review, Sentences or Lists in Cards, each level of
  the list tree, a word's sheet, a sync's page, a review session, the step
  after Forgot, the note box) puts one history entry on, and back closes the
  top one. A layer closed from the page takes its entry back off quietly.
  From Review with nothing open, back leaves the site.
- A review is never lost to leaving it (`lib/resume.ts`, localStorage, one
  study day). A session keeps its cards in hand, how far in and its streak;
  Fast review keeps its loaded cards, the ones marked forgotten and the
  scroll. Closed by back or the close button, Today offers to carry on
  ("Carry on · 12 done", "Fast review · 27 marked, carry on"); left with the
  site closed, opening it again goes straight back in. A finished session,
  or a sweep sent at Done, is cleared.
- Not yet: opening the app with no connection (there is no service worker).

## Look

Calm and polished, chosen by the owner over a themed "practice sheet" idea he
rejected as too themed. Keep it that way:

- Lots of space, one confident accent (blue), neutral everything else. A
  little more colour comes from one hue per kind of card, used wherever that
  kind is named or counted: Read blue, Recall violet, Sentence green, new
  sentences amber (`--cf-read`, `--cf-recall`, `--cf-sentence`, `--cf-new`).
- Type: Inter for Latin (one of the few UI faces with every pinyin vowel, ǎ ǐ
  ǒ ǔ ǖ ǘ ǚ ǜ; Figtree, DM Sans, Manrope, Geist and most others lack some, so
  a syllable would fall back mid-word) and Noto Sans SC for Chinese, heavy
  and large. Both are web fonts through `next/font` in
  `app/chongfuxi/layout.tsx`, so the phone gets real weights; CSS names them
  as `var(--cf-zh)` and the `.cfx` default. No serif or brush faces, no
  schoolbook or paper motifs.
- The bottom tabs are icons (`components/TabIcon.tsx`), each with one
  character of the tab's Chinese name set over it on a halo, in LXGW WenKai
  (a modern regular script, the one exception to the sans: only 复卡统入 are
  fetched, so a new tab character must be added to the URL in the layout), and the English
  small beneath; the current tab sits on a pill.
- A review session takes the whole screen: the shell hides its header and
  tabs (`shell.setFocus`), leaving a close button, a progress bar and the card.
- Motion only answers the owner: the answer rises on reveal, an answered card
  slides right for Got it and left for Forgot. Reduced motion turns it off.
- No iOS-style switches. A choice in a list is a row with a tick box that
  fills with the row's colour.
- Light and dark are both designed; tokens are at the top of
  `styles/chongfuxi.css`.

## Status

Built: import (server-side), unlocking, the review session with Read, Recall
(the Produce card) and Sentence cards, meaning splits, card notes, the daily
new-sentence limit, learn-next, the sentence browser and stats.

Review opens on Today: what is due by kind of card, with the Recall and
Sentences rows doubling as the choice to leave them out (remembered on the
device), the new-sentences-a-day setting, then Start. The choices only filter
the queue; nothing about the schedule changes. Three figures sit either side
of today: answers given yesterday, cards whose due date fell inside today, and
cards joining the queue tomorrow (those falling due then, plus those held back
today by the same-word rule).

Cards has three sides; the third, Lists, is below. Words is the deck against the HSK lists, old six-level and
3.0: the share of each level in the deck, and the missing words of a level a
tap away, each linking to Pleco. It is counted from `chongfuxi_word.lists`,
the Pleco list paths a word is filed under; a word listed at two levels counts
at both. Each level's bar is in its HSK Standard Course cover colour (sampled
from the covers; 7-9 a dark green the owner chose) and is split, palest to
deepest, by where each word's Read card stands: waiting (not answered here
yet), young (under 3 weeks), mature (to 6 months), strong (beyond). The grey
remainder is words not in the deck. Sentences is the browser by readable / one away / locked, with
"Unlock next" (the words blocking the most, and names) as a fourth choice.
There is no separate Unlock tab; the owner didn't want one.

Every card carries its history at the top: a bubble per answer, oldest first
(filled for got it, a ring for forgot), Pleco's own record first and smaller,
then the answers given here, and when it was last seen. Pleco's record comes
from its `history` string and belongs to the word's Read card and to
sentences; Recall cards and split-off meanings start with none.

The stats heatmap also shows Pleco, in grey. Pleco keeps only the date each
card was first and last reviewed, so a grey day counts the cards first or last
reviewed then: a floor, never the full number, and the screen says so. Earlier
and Later step back through the years.

Stats (`components/StatsPanel.tsx`, `app/api/chongfuxi/stats.ts`) reads the
review log and the cards: a heatmap of study days, the last 30 days by answer,
the next 30 days' forecast, retention by kind of card, cards by stage (new /
young / mature / retired), word cards by stability, answers by hour, and the
words forgotten most. Charts are plain elements; two-series colours were
checked for colour-blind separation on both surfaces. With no reviews yet the
review charts are empty, and only the forecast and the stages have data.

Not yet exercised: anything as the signed-in owner in a real browser (it needs
the owner's Google sign-in). The rules are covered by `scripts/check-review.ts`
through the same functions the routes call.

Next:
- **An agent** that sense-tags sentences and writes new ones, with an `edits`
  audit table. The Fix button it was meant to answer is gone; rethink its
  trigger before building it.
- Later: auto-import through a self-hosted Anki sync server, "can I read
  this?" for arbitrary text, FSRS parameters fitted to the owner's log, export.

## The owner's corpus

From `flashbackup-2610131958.pqb` (35,974 cards), with `hsk1-4 sentences`
ignored (every one of its cards is also in the 18k deck):

- 3,046 deck words: 1,924 the owner's own, 1,122 more that Pleco has a score
  for. 2,999 have a CC-CEDICT definition. 12,246 further words are `listed`
  (in an HSK or textbook list, not learnt).
- 39,284 sentences. From Pleco: 18k HSK Sentences (18,824) and "Pleco", the
  owner's own cards (291). From the Anki deck "Leiming's Ultimate Chinese"
  (20,169 kept, sentences only): Neri (films and shows), Spoonfed, Domino
  Sentences, HSK Sentences, and the example sentences carried by its vocabulary
  and character notes ("HSK examples", "Domino examples", "Ultimate Characters
  examples"). 14,589 readable, 9,101 one word away.
- Left out, at the owner's request: `HSK课文` (textbook passages with no
  translations; role `ignore`), the long entries of word lists (NPCR,
  HSK标准教程, 成语), and 15 unstudied dictionary entries among his own cards.
- Every seeded card is due at once (3,037 word cards, 166 sentences), with no
  daily cap, by the owner's choice: he wants to go through them all.
- 985 deck words appear in no readable sentence yet and are shown alone.

## Review rules

Agreed with the owner unless marked *(reading)*, which are choices made where
the design was silent and are still to be confirmed.

- **Queue**: due word cards, due sentence cards and new sentences up to the
  day's limit (10, adjustable), mixed two words to a sentence with a new
  sentence every fourth card. Most overdue first.
- **Same word never twice in a day**: a word answered today, or lapsed today,
  holds back its other cards until tomorrow.
- **Read**: the word with one readable sentence under it, rotating each review
  through twelve of its sentences of five characters or more: those several
  decks share first, then those nearest nine characters, labelled proverbs
  (【谚】) last. Shorter ones (我哥哥。) are used only when the word has nothing
  longer. After those, sentences where the word is only part of a longer
  CC-CEDICT headword around it (手 in 住手, 日 in 周日), since they show the
  compound, not the word (`contextFit`; the decks' word breaks often split
  compounds, so tokens alone can't say). Back: pinyin, every
  definition, the translation.
- **Recall** (kind `produce`): appears after the first Got it on Read. The
  definition, and the sentence with the word blanked; a sentence that writes
  one of the word's characters again (月 in 下个月是二月) gives the blank away
  and comes after all the rest. Back lists other deck
  words with the same meaning. Starts a step lower: half the stability.
- **Meanings**: tap a meaning on the back of a Read card to give it its own
  card under the same word; merge it back later. A meaning's card is shown
  without a sentence, since nothing says yet which sentences use that sense.
- **Sentence**: retires after two clean reads on different days. Forgot → tap
  the words that tripped you → those words' Read cards lapse. A tapped compound
  not in the deck (孩子们) passes the lapse to the deck words inside it.
- **Forgetting a word** brings back the sentence it was shown in, if retired,
  and one other retired sentence that has it.
- **Passing a sentence** counts an exposure for its words and moves no word's
  schedule.
- **New sentences**: those a word just unlocked first, newest first. Then
  the ones that give a weak word context, at the owner's request ("I'll need
  more context to learn" a new or low-scored word): each sentence goes by its
  weakest deck word (a Read card new here and unscored in Pleco first, then
  the lowest stability, Pleco's score for a card not yet answered here),
  dealt round-robin so each weak word gets one sentence before any gets a
  second. A word never yet read in a sentence breaks ties; past that a fixed
  shuffle (by hash of the sentence), so sources and lengths are mixed.
  Shortest first put every three-character scrap at the front.
- **Receipt**: every answer comes back with what it changed, drawn under the
  next card as figures, not prose: a meter from the wait the card had to the
  one it has now (log scale, full at two years), then a row of chips: how much
  longer or shorter, the odds it was remembered when answered, FSRS difficulty
  and which way it moved, a Recall card opened, clean reads as pips, lapsed
  words, words read in context, sentences brought back, Got its in a row. Two
  fixed rows; more chips than fit scroll sideways. `submitReview` returns the
  detail; nothing reads it back later.
- **One screen**: Today and a session never scroll the page on a phone. Today
  closes up below 940px of height; a session is exactly `100dvh` and a card
  with more on it than fits scrolls inside itself. The word on a card is always
  one line, sized to its length.
- **Undo**: the receipt has Undo for the last answer. It puts back every card
  the answer moved (each answer stores them as they were, in
  `effects.prior`), removes a Recall card it opened, takes back the reading it
  counted, and deletes the answer and its lapse rows: the one place a review
  row is removed. Only the latest answer; older ones are refused.
- **Why it was forgotten**: Forgot opens a step with an optional line, "what
  tripped you up?", saved as `chongfuxi_review.comment` beside the tapped
  words, for reading the mistakes back later.
- **Fast review**: every Read card due, as a grid of words. Cards turn over
  one at a time, left to right: a card counts once the line two thirds down
  the grid has passed its row's foot by its share of a row (a third of a row
  per card on a phone), as Got it unless tapped (Forgot: red); below the
  line, and again if scrolled back down, it is grey. The same against the
  line a third down shows its answer: the word lifts and shrinks and the
  pinyin and meaning slide up into the card, so a guess can be checked
  before it scrolls away (and tapped if wrong). Room above the grid starts
  every card below that line, so each is seen as a word first. Holding a card
  (still, on the same card) shows its answer in a popup and marks it Forgot. Done shows what the answers
  would do (counts, typical wait before and after, when they come back,
  Recall cards opening) and sends them on confirm, 40 to a request, through
  the same answer code as a session. Split-off meanings are left out. Its
  answers carry a `fast:` session id.
- **Words tab**: every deck word as a tile, shaded by its Read card's stage
  (waiting, young, mature, strong, as on the HSK bars), grouped by when due,
  strength, HSK level (old HSK, then 3.0, each level badged in its textbook
  colour) or trouble (Forgot here, or FSRS difficulty 7+),
  and found by characters, toneless pinyin or meaning. A tile opens a sheet:
  definitions, each card's due date, strength, recall odds now, difficulty and
  history, Pleco's record, and the sentences the word is in, with a jump to
  all of them under Sentences. HSK coverage lives on the Stats page.
- **On the card**: a word's HSK levels (old and 3.0) or "not HSK"; a
  sentence's decks. Chinese punctuation in sentences is set half-width, and
  decks' ASCII ", " / "? " between Chinese is shown as "，" / "？".
- **Order of word cards**: least likely to be remembered first, by the time
  since the last review over stability (the FSRS recall odds fall as that
  grows), never-answered first; ties shuffled by a hash of the card and the
  study day. Seeded cards all fell due at one instant, so this puts the
  weakest Pleco words first. Fast review goes the other way: best known
  first (highest stability, then Pleco's score, which separates the many
  cards seeded at the cap, then lowest difficulty), so the easy ones can be
  swept through; recall odds can't say that, since a word forgotten
  yesterday scores high just for being fresh.
- **Notes**: the owner can put a note on any card ("the adverb, not 狠"). It
  shows on the card's front every time, to tell it apart before answering, and
  changes nothing about the schedule. This replaced the Fix button the original
  design had, at the owner's request: he wanted a note to himself, not a way
  to take a card out of the queue. The `flagged` columns remain but nothing
  sets them.
- **Seeding**: Pleco's score is its interval in hundredths of a day, taken as
  FSRS stability but capped at 60 days (`SEED_CAP_DAYS`). Difficulty from the
  error rate. Every seeded card is due the moment it is made and treated as
  exactly due, its last review set one stability back: the owner asked to see
  everything once and earn the schedule here, rather than have years since a
  Pleco review read as a very strong memory. First Got it is then at most
  about six months. Pleco's own dates stay on the word row. Never tested → new.
  `scripts/reseed.ts` re-applies the rule to cards with no answers yet.
- *(reading)* No same-day repeats. ts-fsrs runs in long-term mode: Forgot comes
  back in 1 to 5 days depending on the card, never the same session.
- *(reading)* Forgot on a sentence resets its clean reads to zero; one brought
  back needs one clean read to retire again.
- *(reading)* The study day turns over at 04:00 local (`lib/day.ts`). A card is
  due "today" if it is due before then.
- *(reading)* Sentences already studied in Pleco (272) start from their Pleco
  score rather than as new, and still need two clean reads here.
- *(reading)* Re-importing never removes a word and never touches a card that
  already exists.

## Unlock rules

`lib/unlock.ts`. A word is readable if it is known or splits entirely into
known words (这个, 孩子们), trailing 儿 allowed. An unreadable word is blamed on
the part to learn (孩子们 → 孩子) when it splits into words there are rows for,
otherwise whole (约翰). A sentence's `blockers` are everything blamed; empty
means readable. `recomputeUnlocks` runs after an import or a name change, never
after an answer.

## Storage

`sql/001_init.sql`, applied by `scripts/migrate.mjs`. Every row carries
`owner_email`.

| Table | One row per |
|---|---|
| `chongfuxi_import` (+ `_chunk`) | Pleco file, kept whole, gzipped, in 3 MB chunks. `settings` records the role each category was given. Never served to visitors. |
| `chongfuxi_word` | word: `status` deck / listed / name, pinyin, `defs`, `glosses`, the Pleco seed, `exposures` |
| `chongfuxi_meaning` | meaning split off a word |
| `chongfuxi_sentence` | distinct sentence: `key` (Han only), zh, en, `sources`, `blockers`, `unlocked_at` / `_by` |
| `chongfuxi_token` | word in a sentence, in order |
| `chongfuxi_card` | scheduled card: kind read / produce / sentence, the FSRS state, clean reads, retired, flagged, suspended |
| `chongfuxi_review` | answer, append-only: schedule before and after, the sentence shown, tapped words, `effects` on other cards, time to answer and to reveal, and where it was given (timezone, UTC offset, device, position in the session) |
| `chongfuxi_settings` | owner: new sentences per day |

Database: `CHONGFUXI_DATABASE_URL`, its own Neon store. On Vercel it exists
for Preview and Production only, so `vercel env pull` does not bring it down;
locally it lives in `.env.local`. Owner: `CHONGFUXI_OWNER_EMAIL`, falling back
to `LONGKU_OWNER_EMAIL` then `JAZZ_OWNER_EMAIL`.

## Sentences from other decks

`scripts/ingest-anki.ts` adds the sentences of an Anki deck and nothing else:
no word row is created or changed, so nothing becomes known that wasn't
(`ingestSentences` in `app/api/chongfuxi/corpus.ts`). `lib/anki.ts` takes a
sentence from a note filed under a sentence sub-deck (its main field) or from
the example-sentence fields of a vocabulary note. The collection is stored
whole as an import of format `anki`.

- Word breaks come from the deck's tone-marked pinyin when it has spaces
  between words and fits the characters (`lib/pinyin.ts` tries every way of
  cutting each pinyin word into syllables and keeps the one the characters can
  be read as). Pinyin spaced a syllable at a time, as in the Domino decks, says
  nothing about words; those sentences, and any whose pinyin doesn't fit, are
  split by longest match against CC-CEDICT and the corpus's words (`split`
  is `dictionary`; 4,407 of the 21,288 first imported).
- A sentence of one word, or of fewer than three characters (三天。 老三。 汉克。),
  is left out: 1,119 such were imported at first and removed at the owner's
  request. A sentence already in the corpus (same
  characters) is left as it is and gains the deck's source name.
- Each sentence keeps its sub-deck as its source, so a source can be dropped.
  Importing is by script only: an `.apkg` with audio is hundreds of megabytes.

## Texts

Plain Chinese text (a textbook's 课文, an article) joins the corpus as
sentences from the Import page's Texts section (`components/TextImport.tsx`,
route `texts`): a .zip of .txt files (read in the browser, `lib/zip.ts`) or
the files themselves, under one source name typed there (it is the deck name
on each card). `lib/texts.ts` takes a file's first line as its title when it
has no sentence-ending punctuation, cuts the rest after 。！？… keeping a
closing quote with its sentence, cuts long speech (说："……。……。") too and
drops a quote mark left without its partner. The sentences then go through
`ingestSentences`, as an Anki deck's do: split by dictionary (there is no
pinyin), sentences only, nothing added to the deck; a sentence is readable
once its words are known. Check first shows what it would add (dry run),
then Add. No translations: those cards have no English. The owner's
HSK标准教程5 课文 (37 lessons, about 700 sentences) came in this way, after
earlier leaving Pleco's HSK课文 out for having no translations.

## New words through Anki (in progress)

The way new words are meant to arrive without re-importing a backup: Pleco
adds the card to AnkiDroid (Pleco's flashcard system set to Anki), and
AnkiDroid syncs to `/api/chongfuxi/anki/` as a custom sync server.

- `app/api/chongfuxi/anki.ts` speaks the least of Anki's sync protocol
  (version 11; read from `rslib/src/sync` in ankitects/anki) that this needs.
  `sync/meta` always reports an empty server, which makes the client's next
  step a one-way full upload of the whole collection; AnkiDroid does that
  without asking on a sync started by hand, and skips it on background syncs.
  `sync/upload` keeps the collection's notes in `chongfuxi_anki_note` (newest
  version wins) and logs the sync in `chongfuxi_anki_sync`. Nothing else is
  stored, so there is never anything to download. `msync/*` answers as an
  empty media store and turns media uploads away.
- Requests are zstd; replies are zstd frames of raw blocks (`zstdRaw`), with
  `anki-original-size`. `fzstd` decodes, since Node 20 has no zstd.
- Sign-in is `CHONGFUXI_ANKI_USER` / `CHONGFUXI_ANKI_PASSWORD`; the host key
  is an HMAC of the user under the password. Unset, the endpoint answers 503.
- Limits: a Vercel request tops out at 4.5 MB, so the AnkiDroid collection
  must hold little more than what Pleco sends (no big decks, no media).
  Pointing AnkiDroid here replaces AnkiWeb as its sync target.
- After each upload, notes not seen before become deck words as one
  addition (`additions.ts`): only the headword is taken (from a field named
  like Front or Hanzi, else the first field that is a word; Pleco sends a
  Basic note, Front the word, Back its own dictionary's definition as HTML,
  which is not ours to show). Definitions and pinyin come from CC-CEDICT;
  each word gets a new Read card, and sentences are unlocked. Each note
  records its word and outcome (added, known, unreadable, undone).
- Each sync has a page (`SyncPage`), like a commit: a diffstat (+ words
  added, ~ already known, ! notes with no word, ↑ sentences unlocked, five
  squares in proportion), each note it handled as a diff line, and for an
  addition what it brought (`AdditionDetails`: the words with pinyin, meaning
  and HSK levels, the deck's size, sentences unlocked with examples) with Keep
  or Undo. A new sync that added words opens its page by itself, once, oldest
  first (`chongfuxi_anki_sync.seen_at`); one that changed nothing stays in the
  log on the Import page, where every sync's page opens. Two or more such
  syncs in a row fold into one line there ("±0 ×5"), opened with a tap. Undo puts each word back as it
  was, removes its unanswered cards and those of the sentences it unlocked,
  and re-locks them; the notes stay marked, so the next sync doesn't add them
  back. Refused once any of its words has been answered.
- Deleting a note in AnkiDroid does nothing here: the owner's choice. A word
  is taken out of the deck from its sheet on the Words tab (`removeWord`):
  its Read and Recall cards go with their answers, it goes back on its list
  if it has one (out of the corpus otherwise), the sentences that needed it
  lock again, and an Anki note for it is marked `removed`, so the next sync
  doesn't bring it back. A Pleco re-import would.
- The Sync URL needs its last slash (`…/anki/`): without it Anki's client
  joins `sync/` one level up. `/api/chongfuxi/sync/*` and `msync/*` answer
  too, so either works; the bare address shows instructions.
- `scripts/check-anki.ts` drives sign-in, meta, uploads and media sync
  against a throwaway owner.

## Adding from Pleco's word lists

Once Pleco's flashcards are set to AnkiDroid, Pleco's own flashcard screen,
where the owner took the HSK lists a lesson at a time, is gone. Cards › Lists
(`components/ListsPanel.tsx`) puts it back: the lists the backup brought
(`chongfuxi_word.lists`, full paths such as `HSK标准教程/HSK标准教程5/第24课`)
browsed as Pleco's tree, each with how much is in the deck (a word filed
under two lessons counts once in the book). A list with nothing under it
shows its words, those missing ticked; "Add N words" adds the ticked ones as
one addition (`addList`, source `list:<path>`), which opens at once with
Keep and Undo, as a sync's do. NPCR and 成语 are left off the screen
(`LISTS_HIDDEN`): the owner doesn't study from them. At most 500 at once (`LIST_ADD_MAX`), so a
whole scheme is refused and a lesson or level isn't. Routes: `lists` (GET
the tree, or `?list=` its words; POST to add, owner).

## Bug reports

The owner files bugs from any screen: a slim tab on the right edge (owner
only, above every sheet) opens a sheet at once to describe what went wrong
(the words are required). Behind it the screen is drawn as it was at the
tap, and comes along as a small screenshot unless unticked (`modern-screenshot`, from
the page itself; Android's browser lets a page capture nothing else, and
fixed bars can be misplaced when the page was scrolled). "Use one from the
phone" takes a real screenshot from the gallery instead.
Each report keeps what the app knew (`BugContext`): the screen, what the
screens on show noted about themselves (`note` in `lib/bugs.ts`: the card in
a session, Fast review's progress, the open list, a word's sheet), the
page's last errors, the viewport, the build. Stored in `chongfuxi_bug`
(made on first use), listed on the Import page with Mark fixed / Won't fix.

**To work on them from a Claude session:**

    npx tsx chongfuxi/scripts/bugs.ts          # open ones → .bugs/<id>.md + .jpg
    npx tsx chongfuxi/scripts/bugs.ts --all
    npx tsx chongfuxi/scripts/bugs.ts --close 12 fixed "what was done"

Read each `.bugs/<id>.md` and look at its `.jpg`, fix, then close it (that
needs `CHONGFUXI_BUGS_TOKEN` in the session's environment, the same value as
on Vercel; otherwise say which to mark fixed in the app). A cloud session
needs `benji.codes` in its environment's allowed domains. `.bugs/` is
ignored by git. Reports are readable by anyone, like the rest of the log.

## Pleco files

Two kinds are read, told apart by content (`lib/backup.ts`), and both come out
as the same `PlecoSnapshot`. **Import backups, not exports.**

A **backup** (`.pqb`) is SQLite ("Pleco SQL Flashcard Database", format 8).
Undocumented; `lib/pleco.ts` reads only what it needs and keeps it as stored:

- `pleco_flash_cards`: `hw` with `@` between characters, `pron` numbered pinyin
  with `@` between syllables and a space before each new word, `defn` only on
  custom cards, `dictid` -1 for custom cards.
- `pleco_flash_categories` (top level under a sentinel parent, -2 in practice)
  and `pleco_flash_categoryassigns`.
- `pleco_flash_scorefiles` and `pleco_flash_scores_<id>`: score (100–51200),
  correct/incorrect counts, first/last review time, and `history`, one digit per
  review oldest first (6 right, 2 wrong), no per-review dates.

A **card export** (`.xml`) is read by `lib/pleco-xml.ts`. It has only the cards
of the categories exported, so it lacks the scored words outside the owner's
category and the word lists: 787 readable against 2,237. It also carries
Pleco's dictionary definitions, which are licensed. Ids are hashed from
headword and pinyin; categories are paths; pinyin runs a word's syllables
together and is rewritten into the backup's convention.

What becomes a sentence: a card too long to be a word, filed under a
`sentences` or `words` category or under none. A word list gives words only,
so its long entries are skipped (`lib/corpus.ts`). At import, an unpunctuated
card that is a CC-CEDICT headword and was never studied in Pleco is skipped
too: it is a dictionary entry, not a sentence (`isEntry` in
`app/api/chongfuxi/corpus.ts`). Importing only adds, so a sentence deleted by
hand comes back on the next import unless one of these rules excludes it.

A card's own definition often ends in a tab and a digit, left over from the
word list it was brought into Pleco from; `ownDefinition` strips it.

Category roles (`lib/corpus.ts`, by top-level category): `words` (the owner's
own — ACTIVE by default), `list`, `sentences`, `ignore`. A card takes every
role of its categories, except that `ignore` only wins alone. Roles are kept on
the import row by category name and carried to the next import; there is no
role editor in the app (`scripts/ingest.ts --role "name=role"` changes one).

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
  simplified headword. 於 itself is still unmapped (no card pairs it).
- 【谚】 labels, erhua written as its own word (`@r5`), duplicate sentences
  (merged, keeping every source), word cards filed in sentence decks, bracketed
  optional parts (点(钟)), full-width Latin (ＡＡ制).
- Grammar-pattern cards (只有…才…, 越  越) are set aside and counted; they
  are neither words nor sentences.

## Code

Pure, in `lib/`, shared by routes, screens and scripts:

- `pleco.ts`, `pleco-xml.ts`, `backup.ts` — a Pleco file → `PlecoSnapshot`.
- `segment.ts`, `hanzi.ts`, `corpus.ts` — snapshot + roles → words and texts.
- `anki.ts` — an Anki collection → sentences. `pinyin.ts` — word breaks from
  tone-marked pinyin.
- `texts.ts` — plain text → titles and sentences. `zip.ts` — the text files
  in a .zip, in the browser.
- `dict.ts` — CC-CEDICT lookup, from `data/cedict.txt`. Server-only: the
  definitions are copied onto word rows at import.
- `unlock.ts` — tokens + known words → blockers.
- `schedule.ts` — ts-fsrs: seeding, an answer, the interval on each button.
  Bump `SCHEDULER` whenever the same inputs would give a different result.
- `review.ts` — sentence retirement, which words lapse, blanking, the mix.
- `day.ts` — the study day. `api.ts` — what the routes send and take.
- `client.ts`, `upload.ts`, `auth-client.ts`, `outbox.ts`, `back.ts`,
  `resume.ts`, `bugs.ts` — browser side. `session.ts` —
  who the owner is.

Server, in `app/api/chongfuxi/` (functions take the connection and the owner,
so scripts run the same code as routes):

- `corpus.ts` — `ingest`, `recomputeUnlocks`, `setName`.
- `review.ts` — `getSummary`, `nextCards`, `submitReview`, meanings, flags,
  pace, the sentence and blocker lists.
- `imports.ts` — the stored files. `dictfile.ts` — loads the dictionary and
  sql.js from disk. `guard.ts` — `ownersLog` (reads) and `ownerOnly` (writes).
- `stats.ts` — `getStats`.
- Routes: `summary`, `session`, `sentences`, `blockers`, `levels`, `stats` (public); `review`,
  `meaning`, `note`, `names`, `settings`, `imports`, `imports/[id]/[idx]`,
  `imports/[id]/ingest` (owner).
- `next.config.ts` keeps `sql.js` external and traces its wasm and the
  dictionary into the ingest route.

Screens, in `components/`: `ChongfuxiApp` (shell), `ReviewPanel` (Today and
the session), `CardsPanel` (`WordsPanel`, and `SentencesPanel` with
`UnlockPanel` inside it), `StatsPanel`, `ImportPanel`.

Scripts (`npx tsx --env-file=.env.local chongfuxi/scripts/<name>`):

- `migrate.mjs` (with `node`) — apply `sql/*.sql`; idempotent.
- `ingest.ts [--import id] [--role "name=role"] [--dry-run]` — turn a stored
  file into rows.
- `check-review.ts` — the review rules, end to end against the real database
  under an invented owner that is deleted afterwards. Run it after touching
  `lib/schedule.ts`, `lib/review.ts`, `lib/unlock.ts` or anything in
  `app/api/chongfuxi/`.
- `reseed.ts [--dry-run]` — re-apply the seeding rule to cards not yet
  answered here.
- `ingest-anki.ts <deck.apkg | collection.anki21> [--dry-run]` — add an Anki
  deck's sentences.
- `check-import.ts <file>` — read and sort a Pleco file, write nothing.
- `bugs.ts [--all] [--close <id> <status> <note>]` — pull the bugs filed from
  the app into `.bugs/` (see Bug reports).
- `build-dict.ts <cedict.txt>` — rebuild `data/cedict.txt`.

A Pleco backup contains third-party sentence decks, and a card export contains
licensed dictionary content; never commit either. Sentences are served
read-only from the database.
