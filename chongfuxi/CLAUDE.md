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

- Navigation is a bottom tab bar (thumb reach): Review, Cards, Look up (the
  owner's only), Stats, Settings (Import until the owner renamed it; an old
  `tab=import` address still opens it).
  The header holds the title and one quiet line (`Glance` in
  `ChongfuxiApp.tsx`): words in the deck, distinct characters across them,
  and the sentences unlocked (readable), with "/ all of them" small beside
  it (the owner's choice over the share readable, then the total), each with its Chinese unit (词 字 句) in
  its kind's colour. Figures only: the owner doesn't want progress bars there,
  and found boxed counts and then badges with a bar and key too busy. (Words
  is one per deck word; the old boxes counted word cards, Read plus Recall,
  which is why the figure went from about 4k to 3k.) Signing in sits at the
  right of the title (`components/Account.tsx`): the owner's 笨鸡 (Benji) opens a
  menu with the address and Sign out; anyone else gets Sign in.
- Settings is a menu (`components/SettingsPanel.tsx`; it was Import), since
  stacked as one page it had grown messy: a row per page, title and one line
  under it, each opening the page with "‹ Settings" above to come back
  (`settings=` in the address). In groups: Review (Algorithm), Bring in (Analyse a text, Pleco backup and Texts owner only, Anki
  syncs), Bugs (Bug reports, the open count on its row). About, with the
  CC-CEDICT credit, sits under the menu. Today's "Import a Pleco backup"
  opens the Pleco backup page directly. The owner tried the pages as sides
  like Cards' and didn't want tabs here.
- **Algorithm** (`components/Algorithm.tsx`, route `algorithm`,
  `app/api/chongfuxi/algorithm.ts`): the scheduling and queue algorithm as a
  compact table of its parameters. The owner asked to see "how the cookie is
  made", then for the algorithm only, read-only, then compact with no prose.
  By stage (FSRS, Seeding, Learn, Queue, Sentences): name, value, and name
  in the code; the FSRS weights fold out. Values are the code's constants,
  imported from `lib/` (`RETENTION`, `FUZZ`, `SAME_DAY_STEPS`,
  `FSRS_WEIGHTS`, `SEED_CAP_DAYS`, `SEED_DIFFICULTY`, `RECALL_SEED_FACTOR`,
  `ROLLOVER_HOUR`, `CYCLE`, `DUE_PER_NEW`, the ladder's `GAP`…), so changing
  one changes the page. Queue now: due word cards by recall odds, what
  burying holds back, and the first cards dealt, one line each with `why`
  from `nextCards` itself. **Add a parameter here whenever one is added, and
  change the page whenever a rule it describes changes.**
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
  another (a tab other than Review, Sentences or Lists in Cards, a page
  opened from Settings' menu, Unlock next, each level of
  the list tree, a word's sheet, a sentence's page, a sync's page, a review session, the step
  after Forgot, the note box) puts one history entry on, and back closes the
  top one. A layer closed from the page takes its entry back off quietly.
  From Review with nothing open, back leaves the site. Layers closed together
  (leaving a tab closes its list levels and side) are stepped back in one
  `history.go`, counted as one popstate: stepping back one at a time, each
  counted as its own, swallowed the owner's next back press.
- **A reload comes back to the same page** (`lib/route.ts`): the tab, Cards'
  side, the list open, a word's sheet, a sentence's page, the Settings page,
  Look up's question (asked again on load; a kept answer costs nothing) and a
  review session under way (dealt again from what is still due) are kept in
  the address (`?tab=cards&cards=lists&list=…`). Each screen sets its part
  while it is on screen and clears it when it goes (`useRouteParam`); the
  address is written from that, never pushed (back.ts owns the history), and
  rewritten after every history step, since stepping back brings an older
  entry's address with it. The shell reads the tab once on the client before
  any panel mounts.
- Fast review is never lost to leaving it (`lib/resume.ts`, localStorage,
  one study day): it keeps its loaded cards, the ones marked forgotten and
  the scroll, since its marks are not answers until Done. Closed by back or
  the close button, Today offers "Fast review · 27 marked, carry on"; left
  with the site closed, opening it again goes straight back in. A review
  session keeps nothing, at the owner's request: each answer is sent (or put
  in the outbox) as it is given, so starting again simply deals what is still
  due. (It used to keep its cards in hand, with "Carry on · 12 done".)
- Not yet: opening the app with no connection (there is no service worker).

## Look

Calm and polished, chosen by the owner over a themed "practice sheet" idea he
rejected as too themed. Keep it that way:

- Lots of space, one confident accent (blue), neutral everything else. A
  little more colour comes from one hue per kind of card, used wherever that
  kind is named or counted: Read blue, Recall violet, Sentence green, new
  sentences amber (`--cf-read`, `--cf-recall`, `--cf-sentence`, `--cf-new`).
  A review card says its kind at a glance: an outline in its colour, the
  name on a pill, and the faintest wash of the colour (4%) over the usual
  grey; a new word's Learn steps are amber. The owner found a stronger tint
  too much and the outline alone a little bare.
- Type: Inter for Latin (one of the few UI faces with every pinyin vowel, ǎ ǐ
  ǒ ǔ ǖ ǘ ǚ ǜ; Figtree, DM Sans, Manrope, Geist and most others lack some, so
  a syllable would fall back mid-word) and Noto Sans SC for Chinese, heavy
  and large. Both are web fonts through `next/font` in
  `app/chongfuxi/layout.tsx`, so the phone gets real weights; CSS names them
  as `var(--cf-zh)` and the `.cfx` default. No serif or brush faces, no
  schoolbook or paper motifs.
- The bottom tabs are icons (`components/TabIcon.tsx`), each with one
  character of the tab's Chinese name set over it on a halo, in LXGW WenKai
  (a modern regular script, the one exception to the sans: only 复卡查统入, and
  the card foot's 魚记, are fetched, so a new character must be added to the
  URL in the layout), and the English small beneath; the current tab sits on
  a pill.
- A revealed card's foot is character tiles in the same face, each a
  character on a soft round in its own hue with its name under it: 魚
  (traditional, the owner's pick) for Pleco, 记 (to note down, a verb like
  查; 笔, the brush, was tried) for a note, 停 for Suspend (word cards
  only until sentences could be suspended too), 查 for Look up. The word's
  page (with its Memory kit button; the owner asked for both from a card)
  opens from the headword itself once the answer shows, a faint › hanging
  after it (`onOpen` on `Word`), over the session, back returning to the
  card: a fifth tile, 词, was tried and taken out as clutter. The owner asked for them cuter than the text links
  they replaced. Every "Open in Pleco" in the app is the 魚 tile
  (`PlecoTile` in `shared.tsx`), inline (a smaller round, the name beside
  it) in popups and a word sheet's tags.
- A review session takes the whole screen: the shell hides its header and
  tabs (`shell.setFocus`), leaving a close button, a progress bar and the card.
  Right of the bar, in place of one total, what is left of each kind the
  session takes (Read, Recall, Sentence, New): a little card in the kind's
  colour and its count, thousands as "3.2k" so all four fit, the full
  figure on hover (`cf-session-kinds`; the owner asked for every kind
  there, as icons, not words). A 2×2 grid and a row under the bar (left,
  then right) were tried and taken back: the owner found them ugly. A
  list's review and new sentences keep the one total.
- Motion only answers the owner: the answer rises on reveal, an answered card
  slides right for Got it and left for Forgot. Reduced motion turns it off.
  The one exception is waiting: anything loading shows a little stack of
  three cards (重 复 习, coming to the front in that order, in the Read,
  Recall and Sentence colours and the tab icons' WenKai),
  the top one dealt off and tucked under again and again, with what is being
  done beneath it (`Loading` in `shared.tsx`; `small` beside its words inside
  a sheet or list). Reduced motion holds the stack still and lets the words
  breathe. Buttons keep their own "Adding…" words.
- Small actions (Undo, Bring back, Tick all, Open in Spotify) are soft
  pills in the accent colour (`.cf-link`), never underlined text: the
  owner's call. A link inside a sentence is just the word, in the accent.
- No iOS-style switches. A choice in a list is a row with a tick box that
  fills with the row's colour.
- Light and dark are both designed; tokens are at the top of
  `styles/chongfuxi.css`.

## Status

**Version.** The header shows `v0.1.N`, so the owner can tell production
releases apart: N counts the commits that touch 重复习 (`chongfuxi/`,
`app/chongfuxi/`, `app/api/chongfuxi/`), so it goes up by one with every
release that changes it, with nothing to bump by hand. Counted at build time
in `next.config.ts` (`chongfuxiVersion`), by the first of: the checkout, if
it has the whole history; a clone of the history alone (no file contents)
from GitHub, since Vercel's checkout has only the last few commits (the
repo is public); GitHub's API, each path's commits counted once. The build
log says which ("重复习 v0.1.N, counted by …"). Hovering it shows the
commit. 0.1.67 was the first, with Look up's answer blocks. (0.1.69 showed
as 0.1.68: fetching the rest of Vercel's checkout failed, and the API
fallback then counted `chongfuxi/` alone.)

Built: import (server-side), unlocking, the review session with Read, Recall
(the Produce card) and Sentence cards, meaning splits, card notes, new
sentences with no daily limit, learn-next, the sentence browser and stats.

Review opens on Today: what is due by kind of card, with the Recall and
Sentences rows doubling as the choice to leave them out (remembered on the
device), then Start. All-time figures under each kind's count (mature
cards, sentences retired) were tried and taken out the same day: the
owner found them cluttered; they live on Stats. The choices only filter
the queue; nothing about the schedule changes. Start says about how long the session
would take at the owner's own pace (the owner's ask; `sessionTime` in
`ReviewPanel.tsx`, from `pace` on the summary, `paceOf` in review.ts): the
median gap between consecutive answers in a session for each kind of card
over the last 30 days (`PACE_DAYS`), so receipts, word taps and Learn steps
in between count as they do; gaps over 3 minutes are breaks, Fast review is
left out, and a kind with under 10 answers takes the overall median. It
counts the due word cards (Read and Recall in their proportion), the due
sentences and the new sentences mixed in with them (one per `DUE_PER_NEW`
due), and with New words chosen the Learn steps the new words have left
(`learnSteps` on the summary: four a word, fewer part way up), each at the
Read pace, since the Learn log keeps no times (the owner found new words
left out). Shown bare under Start ("~1h 56m", "~25m"): the owner wanted just the
time. Above them, the days either
side of today as a strip of bars, sliding sideways with today in the middle
(`components/DayStrip.tsx`, route `days`): cards reviewed each day before
(grey), cards falling due each day after (blue), today's done and still to
go. One line beneath: the streak, the cards a day this week and those due in
the next seven; tapping a day puts its number there instead. It is
elastic, at the owner's request: let go, and half a second after it comes to
rest it glides back to today (held, it stays). The owner asked
for it in place of three plain figures (yesterday, came due today,
tomorrow), and then for it quieter: one colour, the date, one line.

Cards has three sides; the third, Lists, is below. Words is the deck against the HSK lists, old six-level and
3.0: the share of each level in the deck, and the missing words of a level a
tap away, each linking to Pleco. It is counted from `chongfuxi_word.lists`,
the Pleco list paths a word is filed under; a word listed at two levels counts
at both. Each level's bar is in its HSK Standard Course cover colour (sampled
from the covers; 7-9 a dark green the owner chose) and is split, palest to
deepest, by where each word's Read card stands: waiting (not answered here
yet), young (under 3 weeks), mature (to 6 months), strong (beyond). The grey
remainder is words not in the deck.

The three sides sit on one slim switch held just under the header as the page
scrolls (`--cf-top-h`, the header's height, set by the shell). They were three
tall boxes with counts; the owner found Sentences in particular unusable and
ugly, and the October 2026 redesign (mockup:
https://claude.ai/artifact/NBV7B4hUEM9JLySzvC5oib) put it right:

- **Sentences** (`components/SentencesPanel.tsx`): a search box with a source
  button beside it, then Readable / One away / Locked as three chips with
  their counts (9.1k), never wrapping; sentences start in the top third of the
  screen. Searching hides the chips and offers "Inside longer words too". A
  source picked (from a sheet) shows as a chip with ×.
- Each row is the sentence, its translation and one quiet line: a dot for its
  card (green in review, amber not started, a ring retired, dashed locked)
  and its sources in grey, cut short. A word keeping it locked is marked in
  the sentence itself, in amber, not in a box below.
- **Unlock next** is no longer a fourth choice: the first few words lead One
  away as a strip ("Learn these to unlock the most", each with +N), and "See
  all" opens the whole page (`UnlockPage` in `components/UnlockPanel.tsx`:
  from your lists, also blocking, names). A word opens a sheet with the
  sentences it alone holds back, "It's a name" and Pleco (`BlockerSheet`).
  There is no separate Unlock tab; the owner didn't want one.
- **A sentence's page** (tap a row; route `sentence`, `sentenceDetail` in
  `app/api/chongfuxi/review.ts`): its words with pinyin over each (a word and
  the punctuation after it never part), learning words underlined in blue and
  blocking ones in amber. A tap on a word gives its meaning and where it
  stands, with Open word (a deck word's own sheet, `WordSheet`) and Pleco.
  Then the translation, its card's history, its sources and its length.

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
- **Look up**, a fifth tab: a dictionary that answers "what do I say here"
  from a phrase, led by the owner's own sentences. A proof of concept is
  built (see Look up below); the test set decides what comes next.
- **An agent** that sense-tags sentences and writes new ones, with an `edits`
  audit table. The Fix button it was meant to answer is gone; rethink its
  trigger before building it.
- Later: auto-import through a self-hosted Anki sync server, "can I read
  this?" for arbitrary text, FSRS parameters fitted to the owner's log, export.

## Look up

Agreed with the owner in October 2026. A fifth tab, 查 Look up, inside
chongfuxi (not its own route), because it ties into the deck. A proof of
concept is built (Proof of concept, below); the rest of this section is the
plan it starts on.

**Why.** Pleco answers "what does this word mean". Looking up "trauma" there
gives ten headwords in a flat list (创伤, 外伤, 损伤, 伤损, 硬伤…) and no way
to tell which one the situation needs. The owner wants "what do I say here":
type "develop depression" and get 得了 / 患上, with why 发展, 有 or 产生
don't fit. English, Chinese, pinyin and mixed input. It must feel like a
dictionary unlike any other, not a chat with a model: "we can use any chat
bot for that".

**Mockup:** https://claude.ai/artifact/P4PseBCDCuYmsHryQNmhmq (hand-written
data, invented counts): the phrase with its gap (`___抑郁症`) filled by
whichever word is tapped, Fits and "Close, but no" lists with wrong/right
pairs, a sense map for "trauma" (the mind 创伤 / 阴影, the body 外伤, medicine
创伤外科), word pages for 抑郁症 and 阴影 listing what each combines with, and
source tags (model vs dictionary, corpus, your deck).

### Kinds of question

Collocations (which word goes with this word) are one kind, not the shape
of every answer. Over-fitting everything into "fill the gap" was the risk
the owner raised. Kinds seen so far:

| Kind | Example | What decides it |
|---|---|---|
| Word pairing | develop depression | the words around it (collocation counts) |
| Which meaning | trauma | context, then pairing within the meaning |
| Near-synonyms | 认识 vs 知道, 以为 vs 认为 | meaning and grammar (以为: you were wrong; 帮忙 takes no object) |
| Tone | result vs consequence | connotation (后果 is always bad) |
| Sentence pattern | the more… the more | a pattern, 越…越… |
| Whole expression | I'm not in the mood | a sentence-level equivalent, 没心情 |
| Reading | 你真行 | meaning in this context |
| Why these characters | 不着痕迹 character breakdown, 畅销 why these characters | each character's sense in the word, put together |

Collocation counts help with the first two, a little with near-synonyms,
and mislead on their own: 有 is common before 抑郁症 but means having it,
not getting it; rare pairs have too few examples; Chinese pairs sit apart
(帮了我一个忙) and the splitter can cut them wrong.

### Design: fixed answer shape, flexible evidence

Not one prompt around the whole thing, and not one rigid pipeline either:

1. **A fixed answer shape.** A set of options, each judged on named points
   (meaning, words it goes with, grammar, register, tone, how common), each
   judgment saying where it came from. The screen draws the points an answer
   uses: the gap-filling phrase for pairing questions, side by side for
   near-synonyms, a pattern with slots for patterns.
   (Now a closed set of typed blocks the model composes: see Answers
   composed from blocks.)
2. **Evidence as tools the model chooses from**, our own functions:
   - the owner's sentences, searched on the Chinese or the English side
     (most of the 39k have translations, so they are already a parallel
     corpus: "develop depression" can find "depress…" in the English and
     return the Chinese)
   - the deck: whether a word is a card, its strength, what it's met in
     (患 from 患者)
   - CC-CEDICT entries and readings (`lib/readings.ts`, `dictEntry`)
   - collocation counts for a word and a grammatical relation (verbs taking
     it as object, words describing it, words it goes with)
   - translated examples from a bigger corpus
3. **A checking step after the model.** Every Chinese word must be a
   CC-CEDICT headword (or flagged); pinyin always comes from our readings
   code, never the model; every "common" claim points to a count; every
   example is a real corpus sentence or labelled as written by the model. A
   claim that fails is dropped or marked, never shown as fact.

The model makes two kinds of call: reading the query (structure, senses,
which part is in question) and judging the options given the evidence.
Both cached per query; lookups are owner only (they cost money).

### Leading with the owner's corpus

Answers rank by where they were found: in the owner's sentences and readable
now; in them but blocked by an unknown word; only in the bigger corpus;
written by the model (labelled). With nothing in the owner's corpus the
bigger sources fill in and the screen says so; a lookup that keeps missing
is a hint about what to import next.

### Which part is the question

"develop depression" could be asking about either word. The model only
labels the parts; the gap is chosen from evidence:

- **Base and collocate.** In a pair the noun (base) translates on its own and
  the verb (collocate) depends on it, so learners get stuck on the
  collocate. The gap goes there by default.
- **Measured ambiguity.** How many words could fill each part, and how
  evenly the corpus splits between them, given the rest of the phrase.
  "develop" fans out to a dozen verbs; "depression" next to it is nearly
  always 抑郁症 (alone it splits into 抑郁症, 抑郁 / 忧郁, 萧条). Both
  ambiguous → both get a gap.
- **The deck.** A strong card for 抑郁症 means it isn't the question.
- **The owner overrides:** typing the known part in Chinese ("develop
  抑郁症", "得了 depression") says which part is asked; tapping a part in the
  "Reading it as" strip makes it the gap. The screen always shows what it
  took as the question.

### Screens

The gap-filling phrase (tap a word to try it; a wrong one struck out in red
with its reason), Fits and "Close, but no" with wrong/right pairs, a sense
map before any list when a word has several meanings, word pages (what a
word combines with, by relation and by sense; every word is a link), an
evidence drawer of real sentences (the owner's first), and **Learn**, which
saves the phrase as a card ("develop (an illness)" → 得了抑郁症), so the
usage is reviewed, not just the word. Later: Android share target (select
text in any app → Share → 重复习), follow-up questions on an answer.

### Proof of concept (October 2026)

Built on the owner's corpus alone, since that is what answers lead with:

- `app/api/chongfuxi/lookup-evidence.ts`: the evidence, as functions over
  the database and CC-CEDICT. `searchSentences` (the owner's sentences by
  English words in the translation, any form, and Chinese words in the
  sentence), `neighbours` (the words just before or after a word, within
  up to 3, by sentences: collocations from `chongfuxi_token`), `together`
  (how often one word is followed by another), `dictionary` (entries, deck
  standing and strength, corpus count) and `englishCandidates` (headwords
  whose senses say the English, `englishToChinese` in `headwords.ts`,
  ranked by corpus count). Each records what it returned (`Seen`).
- `app/api/chongfuxi/lookup.ts`: one call through the SDK's tool runner,
  the evidence as tools the model picks from, the answer as typed blocks
  (`ANSWER_SCHEMA`, handed in through an `answer` tool; see Answers composed
  from blocks). Kept in `chongfuxi_lookup` (made on
  first use): a cache, and with the owner's Right / Wrong and note, the test
  set. Route `lookup` (owner only: GET the history, POST `{ q, fresh? }`,
  `{ q, verdict, note }`, or `{ q, add: word }`).
- `app/api/chongfuxi/lookup-check.ts`: the check, block by block. Pinyin
  from our readings, for every word a block names (the answer's `words`
  map); such a word must be a headword, a pattern of headwords, or split into at
  least one real word (nearly every character is a headword, so two lone
  ones don't count); a cited count must be one a tool returned for that word,
  a pair with it, or part of it (得 for 得了); an example must be a sentence a
  tool returned. Anything else is shown as the model's own or dropped, and
  listed under "What the check changed". `scripts/check-lookup.ts` tests it
  without a database or model.
- `components/LookupPanel.tsx`: the question (one rounded field with a
  small round arrow inside it, grey until something is typed, a spinner
  while it looks: the owner found a plain "Look up" button clumsy). The
  answer is drawn from its blocks (below), one small component each. The
  sense block keeps the dictionary-entry layout, the owner's pick of three
  (mockup: https://claude.ai/artifact/4e5GTiQ9V7yNpKfZ5epxmJ; the first
  version, every point and source spelled out, was too much to read, and the
  barest layout too little). Nothing on it says what the answer is: the
  owner wants it read off the page, not explained (a one-line gist, "Say
  得了, or 患上 in writing. Not 发展.", was taken out, and the model no
  longer writes one). The hint under the field shows only before an answer,
  with History under it: each question on one line, the kind it was read as
  under it, the verdict at the end (it was "Asked before", in large type).
  First those sharing Chinese with what is in the field ("With 表达": one
  run of characters holding the other, so 表达式 finds "表达 vs 表示" too),
  as it is typed or filled from a review card; then Recent, the latest six,
  the rest behind "Show all" (the owner's request; it was every question).
  After the blocks: Right? ✓ ✗ (a note when wrong); how the question was
  read, the model's summary and what the check changed folded away at the
  foot.
- **The deck, from the answer**: every word says where it stands, looked up
  each time the answer is shown (cached or not, `withDeck`): "✓ In deck ·
  strong" (its Read card's stage, as on the Words wall; on words in the
  gap, sense, contrast and scale blocks), or + Add for a
  dictionary word not in the deck (on a Pleco list or not). Add puts it in as
  one addition, source `lookup:<question>` (`addFromLookup`, through
  `addWords`), and turns into "✓ Added · Undo" (the additions route undoes
  it). At the owner's request.
- **From a review card**: once the answer is shown, the card's foot has
  Look up (beside Open in Pleco and Add a note; the owner's only). It opens
  Look up in a sheet over the card, the field filled with the word (or a
  sentence card's sentence) but not asked, since asking costs money and the
  owner may edit it first ("幻觉 vs 幻想"). Back or × returns to the same
  card: a sheet rather than the Look up tab, so a long session keeps its
  place. The owner asked for it. A new word's Learn card has the same 查 tile
  (owner, any step), opening the same sheet on the word.
- **Lookups keep the card they were asked from** (`chongfuxi_lookup_card`,
  made on first use; `linkLookup`): each question asked from a review or
  Learn card's sheet, once answered (a kept answer too), records the card,
  its word and kind, review or Learn, the sentence on it, the session or the
  Learn step, and when. The owner wants it for later: what had to be looked
  up while studying a word is evidence of how well it is known, for a model
  judging that. The Look up tab's own questions have no card and record
  none.
- **Type-ahead of the owner's words, no model** (the owner's request): as
  the question is typed, `words/suggest` (`suggest.ts`, readable like the
  word page) lists up to 12 deck or listed words matching it, as a
  dictionary would: Chinese by containing it, Latin by toneless pinyin
  prefix ("faj", "fa jue"), English of three letters or more by the
  definitions; exact and starts-with first, then deck words. Each row opens
  the word's page; the last row asks the AI about the text. **Enter** opens
  the word page when the text is exactly one of those words, and otherwise
  asks the AI: only a question that is more than a dictionary word spends
  tokens.
- **English is fuzzy** (the owner's ask: "smart and fuzzy, unlike a
  normal dictionary"; the case: "my flight got delayed", a word seen
  before that won't come back when needed). `lib/fuzzy.ts` over the
  words' English keys (Synonyms' `chongfuxi_gloss_key`, indexed in memory
  per server while its stamp holds, `glossKeys`): stop words dropped, each
  word to a stem shared by its forms (delayed, delays, delaying → delay;
  `stem`), a stem not in the index read as the nearest a typo away (one
  edit up to six letters, two beyond, a swap counting one: dleay → delay;
  `stemsFor`); words whose key holds it score (more for the key being just
  that word, an earlier sense, no typo), then one hop through meaning: the
  other words sharing one of a reached word's first keys (delay → 延误,
  whose "hold up" brings 耽误; keys shared by over 25 words lead nowhere);
  scores add across the typed words. The owner's sentences saying it are
  found too (their English has the words in any form, or they hold a word
  found, two signals at least, readable first, up to 6), the found words in
  them marked and opening their pages; words sitting together in those
  sentences are lifted (`TOGETHER_LIFT`: 航班 above 飞行 for "flight
  delayed", from 我的航班延误了). Under the word rows (they were above,
  and the owner wanted the words first); a whole pinyin match still comes
  first among the words (hang → 航班). No model; the AI row stays last. Chosen
  over an AI pass after a pause and over embeddings, for now. Not reached:
  words with no English in common (晚点 for "delayed"). **Pinyin isn't
  English**: "huilü" was read as English too, its ü dropped, "huil" taken
  for a typo of hail and hill, and the owner got 冰雹 and sentences about
  hills. Now when everything typed splits into pinyin syllables (`isPinyin`
  in `lib/pinyin.ts`: the toneless readings CC-CEDICT gives single
  characters, ü as v, tone marks, numbers, spaces and apostrophes allowed),
  the English side takes words only as typed, no typos (`typos` on
  `fuzzyWords` and `stemsFor`); "hang" still finds hang as English. Typed
  and stored pinyin are compared as letters with ü, v and u: all as u and
  no tone marks, so huilü, huilv, hui lv and huìlǜ all find 汇率.
- **Lookups show the words they were about** (the owner asked for the
  history to make it obvious): each history row carries chips of up to four
  corpus words (`lookupWords` in `lookup.ts`: the cards it was asked from,
  then the deck or listed words named in its Chinese, longest match first;
  a lone character only when it is the whole run), and an answer has an
  "About" row of the deck or listed words its question named. Each chip
  opens that word's page, whose Lookups section lists the question back.
- Owner only, at the owner's insistence (it spends their tokens): the route
  goes through `ownerOnly`, so signed out (or a forged cookie) it answers 401
  and signed in as anyone else 403, before any model call; the tab is hidden
  from everyone but the owner too.
- Config: `CHONGFUXI_LOOKUP_MODEL` (default `claude-haiku-5-5`, the
  owner's choice; see The model below),
  `CHONGFUXI_LOOKUP_EFFORT` (default `medium`; **never lower it**, the
  owner's explicit instruction, not even to make lookups faster), and
  `CHONGFUXI_ANTHROPIC_API_KEY` or the site's `ANTHROPIC_API_KEY`. The
  answer's check list ends with its estimated cost. On Claude models that
  offer it, a refusal falls back server-side (`fallbacks: "default"`).
- **Speed** (October 2026; a lookup took up to a minute). Nearly all of
  it is model turns (each a full call; the last writes the whole answer);
  the database queries are indexed and small. So:
  - The first turn's evidence is fetched before the model is called, all
    at once (`evidenceUpFront`: dictionary candidates for each English
    word and the phrase, the dictionary for each Chinese word, the owner's
    sentences whose translation has the English), and sent with the
    question in `<evidence_already_gathered>`; the prompt says to use it
    and to ask for anything more in one turn, several calls at once.
  - When the question names Chinese and its English only asks about it
    ("character breakdown", "why", "mnemonic", "how to use": `ASKING`),
    the English isn't looked up (it once had "character" read as 人物 and
    a breakdown answered as a translation); the word and each of its
    characters are, from the dictionary.
  - Each answer's check list ends with where the time went ("Took 31.2 s:
    evidence up front 0.4 s, 4 model calls 29.8 s, tools 0.6 s, check 0.1
    s"), also logged as `lookup timing` on Vercel. Read it before the next
    change: it is what decides what to speed up.
  - `englishToChinese` searches an index of every sense by English word
    (built once), not every sense each call: about 10 ms, from about 115
    ms, with the same results in the same order.
  - Not done: streaming progress to the screen while it works (the next
    step for how it feels), and lowering the effort (the owner said no).
  - The Look up field takes the focus when the tab or a review card's
    sheet opens, so the phone's keyboard comes up (the owner's request).
- Not yet exercised against the real database or a real model: the session
  that built it had neither. Run a few lookups first and read "What the check
  changed".

### Answers composed from blocks

Agreed with the owner in October 2026 (mockup:
https://claude.ai/artifact/2QUPzy4t1sbe1NwrU9g1yP) and built the same
month. Instead of one fixed layout, the model composes each answer from a
closed set of blocks with typed fields (`LookupBlock` in `lib/api.ts`); the
app draws them, so the model never writes interface. The answer reads off
the blocks' shapes, with no sentence saying what it is.

| Block | Shows | Typical kind |
|---|---|---|
| Gap phrase | the phrase with the best word in it, every candidate under it, near misses struck | pairing |
| Sense | a numbered word: when it's the one, why, an example | which meaning |
| Contrast | 2–3 words side by side on the same rows (means, turned out, sounds, typical) | near-synonyms |
| Scale | words placed on one line between two ends (good ↔ bad, casual ↔ formal) | tone, register |
| Pattern | a template with slots (越 A 越 B) and fillings | patterns |
| Family | the rule behind the answer from the owner's sentences (得 + an illness: 得感冒 · 得了癌症) | any; what makes it more than a dictionary |
| Wrong → right | the likely mistake beside the fix | any |
| Example | one of the owner's sentences by id, or one labelled as the model's | any |
| Parts | a word taken apart: each character, its reading in this word, what it means here, the owner's deck words sharing it; then the literal sense put together | why these characters |

- The model hands the answer in by calling an `answer` tool whose input
  schema is `ANSWER_SCHEMA` (`blocks` an `anyOf` of eight objects, each told
  apart by a `const` `type`); the loop stops at that call. It was first an
  enforced output format (structured output), but the API refused it in
  production: "The compiled grammar is too large". Eight kinds of block with
  nested lists are past its limit (the fixed shape before them was not). A
  tool that isn't `strict` compiles no grammar, so nothing enforces the
  schema: `normaliseAnswer` takes each field only when it has the right type,
  reads a list sent as JSON text, and drops blocks of no known type, before
  the check. An answer written as text instead is taken if it parses. The
  model cites sentences by id (-1 for one it wrote) and gives counts as -1
  when no tool returned one.
- The check runs per block (`checkAnswer`): our pinyin and the dictionary
  test for every word a block names; a sense's examples only if a tool
  returned them; a pattern filling or example block shown as stored when
  its id was returned, else as the model's (`mine: false`, labelled
  "written by the model"); a family member's count nulled unless a search
  returned it; scale points clamped to the line and sorted; a gap phrase
  without `___` dropped; a contrast cut to three words.
- Code keeps the order stable (`orderBlocks`: gap, contrast, scale and
  pattern first, then senses, family, wrong → right, examples last), so the
  same kind of question looks the same each time.
- Answers kept in the first shape (options, frame, written) are turned into
  blocks when read back (`fromV1`), so the cache and test set stay usable.
- On screen (`LookupPanel.tsx`): first a line saying how the question was
  read (its kind, the query with the asked part in bold: the owner asked for
  it back). `GapBlock` (tapping a chip tries it and shows it under the chips
  as a dictionary line, `WordLine`: pinyin, meaning, deck mark or + Add,
  unless a sense below already does; a sense's word tries it too). The
  answer word as a large headword above the phrase was tried and taken out:
  the owner found it too big and obtrusive. A wrong → right block that only repeats a struck chip
  (登记酒店 → 入住酒店, 登记 already struck) is folded into it, its reason shown
  when the chip is tapped (`foldIntoGap`, when drawn, so kept answers too;
  the owner found it redundant); one the owner's sentences contradict stays. `SenseItem` (numbered through the whole answer),
  `ContrastBlock` (the words side by side, each with a compact deck mark, "✓ strong" or "✓ Added / Undo", wrapping inside its column (the full one ran out of it; the scale uses it too), each row's label across the full width with its cells under it, since a narrow label column broke words mid-word on the phone; ✓/✗ cells), `ScaleBlock` (dots on a gradient
  line, kept clear of the edges), `PatternBlock` (`{A}` slots drawn dashed,
  the slot words marked in each filling), `FamilyBlock` (a tap on a member shows its words, each with pinyin
  and + Add: members and the headwords they split into are in the answer's
  words map, `parts`), `WrongRightBlock` (marked as a proofreader would, at the owner's request after two coloured sentences and a reason were too busy: the right sentence in white, the right word in green, the wrong word struck in red over it as ruby, widened to a whole word the answer knows, 幻觉 under 幻想, not 觉 under 想; one the owner's sentences contradict shows one of them, the part in green, and the count),
  `ExampleBlock`, `PartsBlock` (a row per character; its reading comes from the word's own reading, so 着 is zhuó in 不着痕迹, and the deck words sharing it are looked up each time it is shown, `withParts`; added at the owner's request after a breakdown came back as a translation).
- A chip whose word is in the deck has a small ✓ in its corner, so what is
  known shows at a glance (the owner couldn't tell from the first real
  answer, which had no sense block to carry the deck marks).
- A sense's examples say how its card would see them: "in 县城" when the
  word is only part of a longer one there (from the sentence's words,
  fetched with it), "locked" when it isn't readable yet. A card wouldn't
  show either; without the note the two screens seemed to disagree.
- **Warnings are tested against the owner's sentences** (`withUsage` in
  `lookup.ts`, each time an answer is shown, so kept answers get it too; a
  database search, no model call). Haiku told the owner 哪个站 "is not a set
  phrase", which is false. For each wrong → right block, `mistakeKey` takes
  where the wrong version differs from the right one, with a character
  either side (哪个站 / 哪个车站: 个站), and if the owner's sentences have it,
  the block shows as in doubt: one of their sentences with the part in
  green, and how many have it, instead of the correction. The prompt also tells the model to search before warning. Not
  yet tested: a gap's near misses (a key like 在站 would also match 在站台).
- Known gap: 得了 in a gap is 得 + 了 (got), but the dictionary line shows the
  headword 得了 ("all right!; that's enough!"), and + Add would add that.
- Cost on Haiku: about $0.005 a lookup, against $0.004 for the fixed shape.
- Not yet run against a real model: the session that built it had no key
  or database. Ask a few questions of each kind and see which blocks the
  model picks.
- Still open from the same review: answering in the owner's own sentence
  (and checking an attempt), keeping the phrase rather than the bare word
  (a card's note as the bridge until phrase cards), and showing something
  at once while the model works.

A **note** (block `note`): the one thing worth knowing that the other
blocks don't show, of any kind: a structure in the question that isn't what
is asked (是…的 around 围绕X转), a cultural point, why something sounds
stiff. At most one: `label` names the kind ("Grammar in your question",
"Culture"), `title` the Chinese it is about or "", `shape` (a structure only)
the question's words with its inside in braces ("是{围绕X转}的") or "", and
`text` a sentence or two. `NoteBlock` draws it as a card after the answer
and its rule: the label, the title large, the shape with the structure's
characters in Recall's colour and its inside boxed with a dashed line, then
the text with its Chinese in the Chinese face. The check keeps the first
with text, a title only if Chinese, a shape only if well formed, a label
under 40 characters or "Worth knowing". The owner asked for it after liking
a 是…的 explanation folded away in the summary, then had it opened up from
grammar to any kind of point; the summary is now for the evidence only.
Answers kept from before have none until asked again.

### Open questions

- **The bigger corpus.** Looked at in October 2026 (from search results;
  the sites themselves couldn't be reached from the cloud session):
  - *Tatoeba*: about 89k Mandarin sentences (89,134 in an October 2026
    parse), short and everyday, most with English. CC BY 2.0 FR, some CC0;
    per-language and pair exports on tatoeba.org. The cmn–eng pair count
    needs the export. Clearest licence and has translations: first choice.
  - *Leipzig Corpora Collection*: news and web sentences by language and
    size; downloads are CC BY by its terms page (other uses CC BY-NC). No
    translations. Good for collocation counts in written Chinese.
  - *OPUS OpenSubtitles v2024*: spoken, zh_CN–en, about 22M pairs (a
    third-party figure); no licence stated, OPUS disclaims owning the text,
    attribution to opensubtitles.org asked. Counts only, never shown, if at
    all.
  - *Chinese Wikipedia*: CC BY-SA 4.0, written and formal, no translations;
    large dumps to process offline.
  - Also seen: BCC (BLCU, 15 billion characters, online search, frequency
    lists with unclear terms), Chinese Gigaword (LDC, paid), zhTenTen
    word sketches (Sketch Engine, paid; exactly collocations by grammatical
    relation, the gold standard if ever worth paying for).
  A cloud session needs these hosts allowed in its environment's network
  settings to fetch them.
- **Phrase cards** from Learn: a new card kind, or Recall cards with a
  phrase prompt. It only matters once Learn is built: a new kind touches the
  schema, dealing, the session screens, Stats and `check-review.ts`; a Recall
  card per phrase reuses all of that but is keyed by word, and one word can
  have several phrases. Not needed for the proof of concept.
- **The model.** Decided: Claude Haiku 5.5, chosen by the owner in October
  2026 for cost. Claude Haiku 5.5 ($0.10 / $0.50 per
  million tokens) is as cheap as the cheap Chinese-first models (DeepSeek V4
  Flash, Qwen Flash, Gemini Flash-Lite, all roughly $0.10–0.30 in and
  $0.40–1.20 out by October 2026 aggregators), so price is no reason to
  switch; the tool runner, structured output and fallbacks are already
  wired. A lookup is several calls (about 30k tokens in, 2–3k out): roughly
  $0.15 on Opus 5.5, $0.08 on Sonnet 5.5, under a cent on Haiku 5.5. If
  Haiku's verdicts in the test set disappoint, raise
  `CHONGFUXI_LOOKUP_EFFORT` first, then run the same lookups with
  `CHONGFUXI_LOOKUP_MODEL` set to Sonnet or Opus and compare. Haiku has no
  server-side fallback on a refusal; the screen says the model declined. A Chinese-first
  model would mean a second SDK; worth it only if Claude misses on
  collocation nuance the evidence can't fix.
  Looked at again in October 2026 at the owner's request, and not taken
  up for now: Meta's Muse Spark ($1.25 / $4.25, about ten times Haiku a
  lookup) and Muse Wonder ($4 / $20, about Opus's), with no independent
  Mandarin results; and Chinese-first models, of which Qwen 3.8 Flash
  ($0.15 / $0.47, top of C-Eval and SuperCLUE among them, an international
  region, no training on API data without consent) is the one to try
  first. DeepSeek stores API data in mainland China and trains on it by
  default. All of these offer an Anthropic-format endpoint, so a trial is
  a base URL, a key and a model name. Decide on the test set, not
  leaderboards. The owner said no to Qwen for now.
- **The test set.** Over about a month the owner is collecting what they'd
  type, each with the situation (the sentence meant) and what was used in
  the end, ideally tagged with a kind from the table. Every entry gets run
  through the design and marked: right part in question, right meaning,
  right word. The misses decide what is built first.

## Definitions the model writes

A word CC-CEDICT lacks whose Pleco card brought no definition (扬眉吐气)
shows "No definition on file". For the owner it also shows "Write one with
AI", on the Read card's back and on the word's sheet (`DefineButton` in
`components/shared.tsx`). It asks Look up's model, at Look up's effort
(`app/api/chongfuxi/define.ts`, route `define`, owner only), for one to four
CC-CEDICT-style senses, given the word's reading and up to six of the
owner's sentences that use it, through a small enforced JSON format. The
result is the word's `defs`, one entry marked `ai: true` (and its
`glosses`), and every card and sheet of the word shows an **AI** tag beside
龙库's (`AiTag`), in Look up's colour. The model's pinyin is used only when
the word has none, and only when each syllable is one CC-CEDICT gives that
character. Refused for a word that has a definition. An import that brings
none for the word keeps it; one that brings one replaces it.

Wherever a definition is shown (the card's back and Recall prompt, the word
sheet, Look up, a word tapped in a sentence, Learn, lists, new words, Fast
review, Unlock next), one the model wrote has a small **AI** pill beside it,
on every one of its senses (`AiPill`). Which words those are comes from one shared fetch (`lib/aidefs.ts`,
GET `define`, public), not from each API. Tapped, the pill says "Written by
AI" and, for the owner, offers Undo (POST `define` with `undo`): the word has
no definition again (nor its reading, if the model gave that too, marked
`aiPinyin`), and can be written afresh. Inside something already tappable
(a list row, Fast review's cards, a tooltip) the pill is only a label.

## Stuck words

Asked for by the owner in October 2026: a section on Today for words got
wrong again and again, with an AI rescue "to get the word out of forgotten
land" (`app/api/chongfuxi/rescue.ts`, route `rescue`,
`components/Rescue.tsx`). Choices the owner made: a rescue sheet (first
with a quiz, since replaced by a memory kit and a speed round: "the quiz
doesn't add much, I rly like the mnemonic"); the kit's hook shows on the
word's cards and the schedule stays FSRS's; card misses and sentence
trips both count.

- **Memory kits** (the owner reframed Words to revive: "would be useful
  for new words too"): Today's one button is "Memory kits", with how many
  new and stuck words (`StuckWords`), opening one screen with two sections:
  **New words**, the `IN_PLAY` words the Learn ladder takes next (part way
  up first, then the next to meet; `newWords`, sent as `fresh` with the
  list), each with whether it has a kit; then **Stuck words** by category
  as below. The speed round and the story take both (`kitWords`: the stuck
  ones, then the new). A word never answered gets a kit aimed at a first
  impression rather than a rescue. **Any word, on demand**: a word's page
  has a "Memory kit" button opening its kit over the page (`cf-kit-over`,
  back closing it), made for the owner on opening; that works for a word
  on a list, a name, or one only in sentences or the dictionary (the kit
  reads back with the dictionary's reading and meaning when there is no
  word row). Its hook only shows on cards, so a word not in the deck just
  keeps the kit.
- **Words to revive**, by category (`lib/revive.ts`, the owner's idea:
  "3 fails in a row is different from getting a word right a ton then
  failing it, which is different from failing it in context or on a
  recall"). A deck word, not suspended, whose latest result was wrong is
  placed by its last 15 results (its Read and Recall review rows with cause
  `answer`, a Forgot, or `tapped`, a lapse from being tapped in a forgotten
  sentence; each row's `before` strength), in the first that fits:
  **Mixed up** (2 of the last 6 wrong, and a partner word: a lookup naming
  just the two, 2 votes, unless both are parts of one longer word in it
  (`inOneWord`: three lookups about 不着痕迹 had 不 filed as mixed up with
  着), or each sentence forgotten with both tapped, 1;
  2 votes needed), **Can't produce** (Recall wrong 2 of its last 3, Read
  mostly right), **Breaks in context** (2+ trips in 30 days, Read mostly
  right), **Slipping** (2 of the last 3 wrong after 4 right in a row, or
  at 30+ days strength), **Won't stick** (3 wrong in a row), **Leech** (6+
  wrong in all). A word wrong once with none of these isn't listed: FSRS
  handles a single lapse. The thresholds are `REVIVE`, on Settings ›
  Algorithm. Today shows one "Words to revive" button with the count and
  the counts by category (the owner found the list there clutter); it opens
  the list, full screen (`StuckList`), by category, each word with the
  reason that placed it and its rescue's state (Rescue, Ready, Done, Missed
  again once a miss comes after the rescue was made); a word opens its
  rescue over the list, back returning to it.
- **The rescue** is aimed at the word's category (`FOCUS` in rescue.ts):
  Mixed up is all about telling it from its partner, whose meanings come
  with it; Can't produce is all production; Breaks in context works from
  the sentences it tripped; Slipping is a short refresher; Won't stick
  builds it from the ground up; a Leech gets a new angle (its characters,
  its origin) and may be called not worth it for now. The category and
  partner are kept with it. It is made when a word is opened, by the owner only (it
  costs money), once, then kept (`chongfuxi_rescue`); a miss after it was
  made marks it stale, and "Make it again" asks anew. One structured-output
  call at Look up's `MODEL` and `EFFORT` (never lower), given everything
  `wordPage()` knows: meanings, every answer, what was written after each
  Forgot, card notes, the sentences it tripped (with what was written),
  other words tapped in those sentences, its lookups (with each stored
  answer's summary, verdict and note), same-meaning and containing deck
  words, an earlier rescue's hook, each character's CC-CEDICT entries and
  traditional forms and the deck words sharing it, and up to 12 readable
  sentences with their ids. It gives a memory kit in the owner's order:
  1. **Hook**: how the characters add up to the meaning, each character
     in brackets after the English it stands for ("Put your mind down (下)
     and fix it (定), cut off (决) the wavering of the heart (心): you make
     up your mind for good."), true to what they mean here, no sound puns.
     It was a mnemonic; the owner found, of the whole kit, only the line
     saying how the characters make the meaning useful, and asked for it
     here.
  2. **Characters** as an upside-down tree (the owner's design;
     `CharTree`, `checkTree`): each character with its pinyin on top, its
     meaning here under it, then layers joining neighbouring runs into
     more natural phrases, grouped as the word groups in Chinese (下定 +
     决心), down to one plain English sentence for the whole word, with a
     bracket under each join. Positions count the word's characters; the
     check keeps a first layer of one node per character, drops a later
     layer that doesn't split the word into fewer runs each joining runs
     above, keeps at most `TREE_LAYERS` (4), and ends on the word's gloss
     when the model's last layer isn't one sentence. It replaced each
     character's formation, components and origin (Shuowen and so on),
     which the owner found of no use; each character's dictionary entries
     and traditional forms still go to the model, to keep the meanings true.
  3. **Sentences**: up to 3 of the owner's, by id only (their text comes
     from the store), and 2 new plain ones that must hold the word, each
     with a note.
  4. **Contrast**: 1 to 3 words it is mixed up with or could be, each with
     the difference and a pair of near-identical sentences, one with each
     word (dropped if either lacks its word).
  5. **Write your own** (the owner asked for it as its own section): a box
     for a sentence with the word, graded by the model at Look up's model
     and effort (`checkOwnSentence`, `POST {word, own}`; `checkAttempt`):
     ✓ Correct, ≈ Almost (understandable, a small error or unnatural) or
     ✗ Wrong, the fixed sentence when it differs, why (what exactly is
     wrong, or what makes the word fit) and the English. Every try is
     kept, newest first, up to 20 (`attempts`); a kit's single checked
     sentence from before reads back as its first try.
  `checkRescue(raw, facts)` refuses a kit missing any character or with no
  sentence holding the word. `RESCUE_VERSION` (5) is stored with it; an
  older one reads as `outdated` and stale, and is made again when the owner
  opens it.
- **Once made** (`done_at` is set with it), the hook shows on the word's
  Read and Recall card backs (`hook` on `SessionCard`, from `rescueHooks` in
  `dress`) until `RESCUE_CLEAR` (2) Goods in a row after it. Nothing here
  changes a schedule.
- **Speed round** (the owner's idea: "flipping through the cards really
  fast while saying it"), a button at the top of the list: every stuck word
  flipped full screen (`SpeedRound`, fed by `rescue?speed=1`, `speedWords`,
  with each hook). The word shows alone; after 2 s
  (`SPEED_REVEAL_MS`), or a tap, its reading, meaning and hook show and it
  is said aloud (the browser's zh-CN voice; "Hear it again"). Missed / Had
  it by button, swipe or arrow keys: a miss comes back 3 cards later
  (`SPEED_BACK`), a word is done at 2 right in a row (`SPEED_DONE`). It
  ends with the flips and minutes taken, and touches no schedule.
- **Today's story** (the owner's idea, first written by the app's model
  on demand; then one the owner's agent wrote each morning, `daily.ts`;
  now no screen of its own, a story being something Muse may put on its
  page as a passage): it was at the top of the Memory kits list, two short paragraphs
  using the day's words, each in a sentence that shows its meaning, the rest
  simple, with a Chinese title and an English translation under each
  paragraph shown on a tap. The words are marked and open their word pages;
  any it left out are named. Kept a story a day (`chongfuxi_daily_story`,
  made on first use); the latest is shown, dated, "by Muse", with a line
  when today's isn't written yet. `rescue?story=1` reads it.
- **Muse reviews** (the owner reframed the screen around Muse): Today's
  button and the screen are called that (they were Memory kits). **Muse's
  page** comes first ("Today's page", or "Latest page" until today's is laid
  out; its title and how many of its blocks were done; see Muse's daily
  page), then **Watch** (see Getting ready to watch a drama), then one
  grouped list (`cf-muse-tools`): Earlier pages, the speed round and Your
  notes; then New words and the stuck words' categories with no "Stuck
  words" heading over them (the owner had it taken out). Today's review,
  the story, Read and the weekly debrief had their own rows until the
  owner found too many Muse things made and too few used (on Oct 27, 2026
  that day's 39 cards had none answered, the day before's went ungraded,
  and one reading had been read but never retold); they are now things
  Muse may put on its page.
- **New from Muse** (the owner asked for a little badge): a "New" pill
  (`NewBadge`) after the title of whatever Muse added or changed since it
  was last opened on this device: the latest page (by its `at`, key
  `page:<at>`), Your notes (an answer newer than the last opening, from
  `lastAnswer` on the notes route), an episode (its `updatedAt`: new
  subtitles, a prep or line notes, `notes_at`). Today's Muse reviews
  button has the pill when anything inside is new. What was opened is kept
  per device in localStorage (`lib/museSeen.ts`, key `cfx-muse-seen`),
  marked as each is opened; with no storage everything reads as new.
- Settings › Algorithm has the Rescue group.

## Synonyms: words with the same English

Asked for by the owner in October 2026: every word tied to the others that
share an English entry (经历, 经验, 阅历 by "experience"), and a page to
explore how they differ. The owner chose groups of their own words with the
dictionary's shown greyed after them, a dedicated AI comparison, and a place in Cards.

- **English keys** (`lib/synonyms.ts`, `senseKeys`): each CC-CEDICT sense
  (the owner's own Pleco definition left out) is cut on ; , / into keys,
  with "to", articles, sb/sth, parentheticals, CL: notes and a trailing
  preposition dropped and a light plural stem ("to experience for oneself"
  → experience; "to become aware of" → become aware). Pointer senses (see,
  variant of, used in, classifier for, surname) and keys of more than three
  words or too common (be, thing, kind) give none. Each key keeps how early
  its sense comes in the word's entry. Kept in `chongfuxi_gloss_key` for
  the deck and list words, made again (`ensureKeys`) when a digest of those
  words and their definitions, or `KEY_VERSION`, changes
  (`chongfuxi_gloss_meta`).
- **A group** is a key shared by two or more deck words with it among the
  first three senses of their entries, and by no more than `MAX_GROUP` (40)
  words in all; keys with exactly the same words are one group, named by
  the nearest the top ("become aware · detect"). Cards › Synonyms lists
  them, those that trip the owner most first: Forgots on their words in 90
  days, plus 3 for each sentence forgotten with two of them tapped; found by
  English (a key starting with it) or by a word in them. A search also
  looks in the dictionary (the owner asked to search beyond their words):
  a Chinese word, theirs or not, gives the groups of its dictionary keys,
  and English the group of its key, each with the owner's words for it and
  the dictionary's (greyed), labelled "dictionary" when fewer than two of
  its words are in the deck; such a group's page shows the dictionary's
  words (the AI comparison still needs two of the owner's).
- **A group's page** (`SynonymPageHost`, over everything like a word page,
  `syn=` in the address; a word page opened from it lies on top, and one
  opened before is closed first): what the owner has mixed up between them,
  then each word side by side: pinyin, HSK, the shared sense marked and its
  others, what each character brings, the words right before and after it
  in the owner's sentences, one readable sentence, and the owner's record
  (strength, Forgots, sentences it is in). After them, always (the owner
  wanted them shown, not behind a toggle) and greyed, the dictionary's other
  words for the key, up to 30 (whole words, not single characters; from an
  index of every CC-CEDICT entry made on first use).
- **How they differ** (owner only, it costs money; `compareGroup`): one
  structured call at Look up's model and effort, given each word's senses,
  neighbours and record, the sentences forgotten with two of them tapped,
  and up to four readable sentences each. It gives a summary, a table of 2
  to 5 dimensions, each word's core, when to use it and an example,
  pitfalls, and a "which one fits" quiz. `checkCompare` keeps table cells
  and words only for the group's words, examples only when they use their
  word, and quiz items only on given sentences holding the answer with all
  options from the group (the app blanks the sentence). Kept per key
  (`chongfuxi_synonym_compare`), stale once the group's words change.
- **A word's page** lists its keys that make groups ("Same English"), each
  opening its group.
- **On a word card's back** (Read and Recall), once its group has been
  compared: "Not to mix up", the word's core and those of up to two
  group-mates, the ones it was mixed up with first, with Compare › opening
  the group over the session (`contrast` on `SessionCard`, from
  `contrastsFor`). The owner chose this of the ideas for using the groups.

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

- **Queue**: due word cards, due sentence cards and new sentences, mixed
  two words to a sentence with a new sentence every fourth card. Most
  overdue first. New sentences have no daily limit (there was one, 10 a day,
  until the owner asked for the whole pool): they come one for every three
  cards due, none once nothing is due. Then the end of the session offers
  "Keep going with new sentences", and from there they are all new ones
  (`more` on `session`); on a day with nothing due, Today's button starts
  there ("Read new sentences"). Today counts only what is due.
- **Same word never twice in a day**: a word answered today, or lapsed today,
  holds back its other cards until tomorrow.
- **Read**: the word with one readable sentence under it, rotating each review
  through twelve of its sentences of five characters or more: those several
  decks share first, then those nearest nine characters, labelled proverbs
  (【谚】) last. Shorter ones (我哥哥。) are used only when the word has nothing
  longer. After those, sentences where the word is only part of a longer
  CC-CEDICT headword around it (手 in 住手, 日 in 周日), since they show the
  compound, not the word (`contextFit`; the decks' word breaks often split
  compounds, so tokens alone can't say). A word with no readable sentence of its own at all
  (县, only ever met in 县城 and 县长) is shown in one where it is part of a
  longer word, the word marked in it, rather than alone: the owner found
  sentences for it in Look up while its card showed none. Back: pinyin, every
  definition, and the translation right under the sentence (the owner
  wanted it closer than the foot of the back). A word with no saved pinyin shows its
  dictionary entry's (`shownPinyin`).
- **Tapping a word in a sentence**, on any card once the answer is shown,
  opens a small popup with its pinyin and a short meaning (`SentenceText` in
  `components/shared.tsx`); a tap anywhere else closes it. Never on the
  front, where it would be a free hint, and never shown unasked: the owner
  tried pinyin over every word and preferred it on demand. Words looked up
  on a sentence card's back come already ticked in "which words tripped
  you" after Forgot. Readings (`lib/readings.ts`, sent as `looks` with the sentence):
  the decks' pinyin is never used. A particle takes its reading in running
  text (了 le, 得 de, 着 zhe, 还 hái, 都 dōu: `RUNNING_READINGS`), then the
  word's own row, then CC-CEDICT (`dictEntry` in
  `app/api/chongfuxi/headwords.ts`; a lone character takes the reading most
  of its compounds use, since the dictionary lists 跑 páo before pǎo), then
  the pieces a word splits into (孩子们).
- **Which meaning is shown** where one has room (a Recall prompt, a tile's
  gloss, a word tapped in a sentence, Learn; `lib/senses.ts`): a character
  often has several CC-CEDICT entries, one per reading or traditional form,
  in no useful order. The entry shown is the one read as the word is read
  (几 jǐ "how many", not jī "small table"), not a name's, sharing a meaning
  with the owner's own Pleco definition (咸 "salty", not "all"), not
  marginal (an onomatopoeia, classical, old, a variant, "used in"); where
  that still ties, the one the word's sentences are about, by their
  translations, if the vote is clear (只 zhī "classifier for birds", not
  "grain that has begun to ripen"). The vote is stored as the order of
  `chongfuxi_word.defs` (`app/api/chongfuxi/defs.ts`, on adding words, after
  an import, and `scripts/order-defs.ts` for all). Within the entry, senses
  the card's sentence shares a word with come first (米 "meter" under
  跑完了1000米, 本 "classifier for books" under 那本书), then those the
  owner's own definition does. Reported by the owner as bugs #2–#6 and #8.
- **Recall** (kind `produce`): appears after the first Got it on Read. The
  definition, and the sentence with the word blanked; a sentence that writes
  one of the word's characters again (月 in 下个月是二月) gives the blank away
  and comes after all the rest. Back lists other deck
  words with the same meaning. Starts a step lower: half the stability. When the
  meaning it asks with is the wrong one (the owner's ask, in place of
  splitting meanings), "Wrong meaning?" on its back opens every sense of the
  word as chips, by entry with each other reading named, those it asks with
  filled (`PromptPicker`); a tap adds or takes one away, saved at once
  (route `prompt`, `setPrompt`: only the word's own senses, in its order, at
  most 6; none goes back to the automatic ones, Reset). Kept per card in
  `chongfuxi_card_prompt` (made on first use) and sent as `prompt` on the
  card; its back then shows the chosen meaning's reading (调 asked as "to
  adjust" is tiáo), and the same-meaning words follow the chosen senses.
- **Meanings** (taken out): a meaning on the back of a Read card could be
  tapped to give it its own card under the same word, and merged back
  later. The owner wasn't using it, so the card back lists meanings as
  plain text again, and every meaning split before was folded back as Merge
  would (`foldSplits`, from `getSummary` once per server start: its cards
  suspended, history kept, `chongfuxi_meaning.merged` set). The tables,
  routes and the meaning card's drawing stay, unused.
- **Sentence**: its back has each word's reading over it (the owner's ask;
  `pinyin` on `SentenceText`, from the sentence's `looks`; the front never),
  each word still tappable for its meaning. 停 on its back suspends that
  sentence card at once, no question (`suspendSentence` in `suspended.ts`,
  `sentence` POST `{id, action}`), with Bring back under the next card and on
  the sentence's page. The mark is kept in `chongfuxi_sentence_suspended`
  (made on first use), since a sentence card is also suspended while locked
  and woken as it unlocks: `recomputeUnlocks` leaves marked ones asleep.
  Retires after two clean reads on different days. Forgot → tap
  the words that tripped you → those words' Read cards lapse. **Fix the words** (the owner met 乱翻 cut into 乱 +
  翻 and couldn't tap the word that tripped them): under those chips, and
  on a sentence's page, the owner can split the sentence anew
  (`SplitEditor`): the words as pieces, + between two joins them, a tap on
  one of two or more characters cuts it into its characters; Save sends
  the new split (`sentence` POST `{id, action: "split", words}`,
  `resplitSentence` in `resplit.ts`: the same characters in the same order,
  each word 1 to 12 characters), which replaces the sentence's tokens (an
  import writes them once and never again, so the edit stays), is logged
  with the split before it (`chongfuxi_split_edit`, made on first use), and
  is followed by `recomputeUnlocks`. A joined word that isn't known locks
  the sentence as any unknown word does, and the editor says so with the
  word linking to its page (where it can be added). The tripped chips and
  the readings on the card follow the new split at once. A tapped compound
  not in the deck (孩子们) passes the lapse to the deck words inside it.
- **Forgetting a word** brings back the sentence it was shown in, if retired,
  and one other retired sentence that has it.
- **Passing a sentence** counts an exposure for its words and moves no word's
  schedule.
- **New sentences**: those a word just unlocked first, newest first. Then
  the ones that test the words that need it, at the owner's request ("choose
  the ones that test the right words but have the whole pool available"):
  each sentence goes by the deck word that most needs it (one due today or
  just forgotten, relearning, first; a word still waiting for Learn last),
  then the weakest (a Read card new here and unscored in Pleco first, then
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
  words, words read in context, sentences brought back, Got its in a row. The
  chips wrap onto as many lines as they need, all in view (the owner's
  choice over a sideways scroll that hid the last ones). `submitReview` returns the
  detail; nothing reads it back later.
- **One screen**: Today and a session never scroll the page on a phone. Today
  closes up below 940px of height; a session is exactly `100dvh` and a card
  with more on it than fits scrolls inside itself. The word on a card is always
  one line, sized to its length.
- **Undo**: the receipt has Undo for the last answer. It puts back every card
  the answer moved (each answer stores them as they were, in
  `effects.prior`), removes a Recall card it opened, takes back the reading it
  counted, and deletes the answer and its lapse rows: the one place a review
  row is removed. Only the latest answer; older ones are refused. The
  card comes back as it was left, answer showing, to be answered again
  (the owner asked; it used to come back face down). A Learn step dealt
  right after that answer is put away untaken (`ladder.setAside`) and dealt
  again once the card is answered (bug #16: it covered the card, so Undo
  seemed to do nothing).
- **Looking back**: once a session has answers, a button by the progress bar
  (a card with a tick and the count), and Look back on the done screen, open
  the session's answers, newest first (`components/Reviewed.tsx`): each a
  row (got it or forgot as the bubbles draw them, the kind, when it is back),
  opening to the card face up (word, reading, meaning with its AI pill, the
  sentence) and the answer given. Only the newest has "Undo and answer
  again", the same Undo as the receipt's. Changing an older answer was built
  and taken out at the owner's choice: it meant taking back and replaying
  every later answer that touched the same cards. Fast review's answers
  aren't in the list.
- **Recap on leaving** (the owner asked): leaving a session that answered
  anything or took a Learn step, by the close button, back or the end
  screen, opens a sheet over Today (`components/Recap.tsx`): cards and
  new-word steps and the minutes taken; got it %, the best run of Got its
  and seconds a card as tiles; got it by kind with a bar in the kind's
  colour; how many were new and how many sentences retired; the new words
  practised; and "To look at again", the word cards forgotten and the words
  lapsed by being tapped in a forgotten sentence, each opening its word
  page. Made on the device from the session's answers (`SessionReport`,
  handed up as the session goes); nothing is fetched. Not for Fast review or
  a list's review.
- **Why it was forgotten**: a tap on Forgot answers at once and moves on
  (the owner's ask); on a sentence it first asks which words tripped you,
  since that is what lapses them. Swiping Forgot up (`FORGOT_SWIPE`, 40 px;
  a chevron on its top edge and "1d · swipe up for why" say it can be) opens
  the step with an optional line, "what tripped you up?", focused with the
  keyboard up, saved as `chongfuxi_review.comment` beside the tapped words,
  for reading the mistakes back later. While swiping the button rises a
  little (`FORGOT_LIFT`, so it never covers the card) and reads "let go to
  type why". It replaced a hold, which the owner found too hidden. The step
  is mounted with `flushSync` and focused inside the release, since phones
  raise the keyboard only within a gesture; the pointer is captured so a
  swipe ending off the button counts, and the release's click is kept off
  Done (its own key, and ignored), which would otherwise answer at once.
  The button needs `touch-action: none` above `.cfx button`'s
  `manipulation`: with that, Android Chrome took the swipe as a scroll and
  cancelled the pointer, so the swipe did nothing on the owner's phone
  (mouse tests passed; touch tests now go through CDP touch events).
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
- **Suspend**: a word too hard for now leaves review without losing
  anything (the owner's request). 停 (as in 暂停) on a revealed word card
  asks first, in place of the tiles: "Suspend 发觉? Its cards stop coming
  up, their history kept, and 12 readable sentences that need it lock until
  you bring it back", Keep it / Suspend. Bring back is under the next card
  ("发觉 suspended · 12 sentences locked") and on the word's sheet.
  `suspendWord` in `words.ts` (route `word`, `{ action: "suspend" |
  "resume" }`) suspends the word's Read and Recall cards (and live split
  meanings), history and schedule kept, then re-checks sentences. No new
  column: the word's main Read card being suspended is the mark
  (`SUSPENDED_WORD` in `suspended.ts`), since the only other suspended
  cards are a merged meaning's and a locked sentence's, and Bring back
  wakes only cards whose meaning isn't merged. A suspended word doesn't
  count as known (`wordStanding`, used wherever the known set is built:
  `recomputeUnlocks`, `ingest`, `ingestSentences`, `analyse`), so its
  sentences lock until it comes back; the owner chose that over keeping
  them readable. The word stays 'deck', so a Pleco re-import, a list, an
  Anki sync or 龙库 never brings it back by itself. It leaves the header's
  词 and 字, and on the Words tab it is in its own first group, "Suspended",
  faded, out of the stage bar and due count.
- **Words tab**: every deck word as a tile, shaded by its Read card's stage
  (waiting, young, mature, strong, as on the HSK bars), grouped by when due,
  strength or trouble (Forgot here, or FSRS difficulty 7+); grouping by HSK
  level was taken out as redundant with Stats and Cards › Lists,
  and found by characters, toneless pinyin or meaning. HSK coverage lives
  on the Stats page.
- **A word's page** (`WordSheet` in `components/WordWall.tsx`, route
  `word/page`, `app/api/chongfuxi/wordpage.ts`; in the address as `word=`)
  opens from anywhere a word is (the owner asked that every word popup lead
  there): one page for the whole app (`lib/wordpage.ts`, `openWordPage`,
  drawn once by `WordPageHost` in the shell, over sheets and sessions, back
  closing it). Ways in: a Words tile; "Word page ›" in the popup over a word
  tapped in any sentence (review backs, Learn, a sentence's page), on Look
  up's word lines for corpus words, on the text analyser's picked word, on
  Unlock next's sheet for a listed word, on a word card in the session's
  look-back list; a list's word row (Pleco is a tile on the page). A word in
  no deck, list or sentence says so. **A word not in the deck** (on a list,
  a name, or only in the dictionary) has "Add to deck" at the top of its
  page (the owner's request; `word` POST `{action: "add"}`, `addFromPage`:
  one addition, source "page", a new Read card), then "Added… Undo", which
  undoes the addition; Remove from deck shows only for deck words. The page
  sits under the app's header, which stays in view (the owner asked), and
  covers the screen only while a review hides the header. Removing or bringing back a word on it
  tells the screens showing it (`onChange`); "Open them under Sentences"
  shows while Cards is there to take it. the owner asked for a full dictionary page
  explaining how the word lives in the corpus, in place of the small sheet.
  Over everything, scrolling on its own: every meaning (the main entry
  first, the owner's Pleco definition, AI pills); its cards (due, strength,
  recall odds, difficulty, answers, history, note) under a chart of how
  often each was got (for every answer, Got it among the last ten; Read in
  Read's blue and Recall in Recall's violet, a dot per answer filled or
  ringed, each line named at its end, a title on each dot; Pleco's undated
  record and split meanings left off it), and Pleco's record; where it
  tripped him (what he wrote after a Forgot on its cards, and the sentence
  cards forgotten with it tapped as the trouble); lookups (asked from its
  cards, with review or Learn and the step, or naming it, with the verdict);
  every sentence it is in, in three panels (Readable, One away, Locked,
  each with its count, the owner's request: tap one to see those), each
  sentence with what keeps it locked, its card's reads and its decks; five
  shown at first and ten more a tap (the owner found forty too many), loaded
  forty at a time, a panel loaded when first opened; the sentences it
  tripped, three at first;
  and how it lives in the corpus: how it came in (the additions that brought
  it, else the Pleco backup), its lists, its Learn, the sentences it
  unlocked and those it alone holds back, deck words with it inside and
  deck words sharing a meaning, each opening its own page. Remove, Suspend's
  Bring back and Write one with AI are on it as on the sheet before.
- **On the card**: a word's HSK levels (old and 3.0) or "not HSK"; a
  sentence's decks. Chinese punctuation in sentences is set half-width, and
  decks' ASCII ", " / "? " between Chinese is shown as "，" / "？".
- **Order of word cards**: least likely to be remembered first, by the time
  since the last review over stability (the FSRS recall odds fall as that
  grows), never-answered first; ties shuffled by a hash of the card and the
  study day. Seeded cards all fell due at one instant, so this puts the
  weakest Pleco words first. Cards missed last time (latest answer a Forgot, a
  tapped lapse too) restart with stability under a day but wait a day, so
  their odds are the lowest and they all came first, a wall of them; the
  owner chose to spread them instead: at most one in every `MISS_EVERY` (3)
  word cards is one (`spreadMisses`, per batch's pool), so they still come
  early, with other cards between. Read and Recall take turns
  (`takeTurns`), each kind in its own order, while both have cards due:
  in one order Recall always came first, since it starts at half the
  stability and so has the lower odds, and with 3,208 Recall due against
  164 Read no Read card came up (the owner: "not seeing Read cards").
  Within a kind, cards never answered (no odds, which used to rank first
  of all) are at most one in every `UNANSWERED_EVERY` (2) (`spreadEvery`);
  the misses are spread after that. **The Recall backlog is spread out** (the owner,
  facing about 3,200 Recall cards due at once from the Pleco seeding: "300
  a day"): Recall cards never answered here (`answered = 0`) come into
  review at most `RECALL_BACKLOG_PER_DAY` (300) a study day, less those
  first answered that day (`recallRoom`), the least likely remembered
  first; the rest wait for the days after. Nothing stored changes: it is
  applied when cards are dealt (`nextCards` lets in only those ids) and
  counted (`getSummary`'s `dueRecall` and `dueWords` leave the held ones
  out, `recallWaiting` says how many wait, under Recall on Today), and the
  day strip's forecast puts them on the days after, 300 a day. A list's
  own review isn't held to it. New Recall cards opened by a first Got it on
  Read count against it too. Fast review goes the other way: best known
  first (highest stability, then Pleco's score, which separates the many
  cards seeded at the cap, then lowest difficulty), so the easy ones can be
  swept through; recall odds can't say that, since a word forgotten
  yesterday scores high just for being fresh.
- **Learn**: a new word (a Read card never answered, from Pleco
  unscored, an Anki sync, a list or 龙库) stays out of the review and its
  counts until it has been through Learn (`WAITING_TO_LEARN` in
  `app/api/chongfuxi/review.ts`). Its steps are folded into the review
  session, at the owner's request (so they are spaced out): one every fifth
  card (`LEARN_EVERY`), five words on the ladder at a time (`IN_PLAY`), and
  one after another once nothing is left to review. Today lists "New words"
  among the kinds, to leave out like the others. A list's drill (Learn,
  beside Review on the list, ten of its words, one step after another) is
  the other way in. Each word climbs four steps (`lib/learn.ts`): meet it
  (pinyin, meaning, two sentences with their translations; not a test), read
  it in a sentence (what does it mean here?), fill it into a gap from the
  English, the word alone. A word without sentences skips reading in context
  and fills the gap from its meaning; one with no meaning either (关起来, a
  phrase CC-CEDICT lacks) skips the gap too, since the owner met it as an
  empty "Which word goes with this meaning?". A word with no definition
  offers "Write one with AI" (the owner's) on its meet step and on the word
  alone once revealed, and its later steps show what was written. A word comes back after others, the
  gap growing as it climbs (2, 4, 7 of its turns: in a session about 10, 20,
  35 cards); a miss puts it back a step and brings it back in two, and every
  step takes a sentence it hasn't been shown with while there is one.
  **Each step is saved as it is taken** (`chongfuxi_card.learn_step`, the
  next step; `recordSteps`): the owner lost his place leaving the first
  version, which kept it on the screen. Words part way up come first next
  time. Steps go one request at a time, in order, and a failed one is sent
  with the next. Sentences (`app/api/chongfuxi/learn.ts`): every word known
  first, then those with one word not known yet, which is shown with its
  reading and meaning; with a translation first; about nine characters;
  where the word is part of a longer word (手 in 住手) last. A gap is not
  offered where a character of the word is written again in the sentence.
  **Nothing in Learn counts**, at the owner's request (he answers minutes
  after being taught, which says little): the last step marks the card
  learned (`learned_at`) and makes it due the next study day, still new, so
  its first real answer, Read and then Recall as usual, comes a day later.
  How each step went is kept in `chongfuxi_learn` (a row per session and
  word, each step once by its id) for reading back, and touches no schedule.
  A word already known needn't climb: the card's 会 "Know it" tile (owner,
  any step) takes it off the ladder at once, saved as a step graded "known"
  that marks it learned like the last step does, so it joins the review from
  the next study day and its first real answer says whether it was.
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
means readable. Except a CC-CEDICT headword of two or more characters that
isn't see-through: it must be known itself and is blamed whole (黄金, 大厦,
挣脱 came up from known characters, bugs #14, #23, #24). See-through
(`seeThrough`): a character from `SEE_THROUGH` (measure words, negation,
aspect, function words, common complements: 这个, 不是, 看完), a number
(二十), a repeat (看看, 高高兴兴), or a known word with something added
(准备好了). Measured on the owner's 17,183 readable sentences before the
change: a blanket rule would have locked about 6,900, mostly 这个/一个/不是;
this one about 2,000 at most (a rough segmentation), on words like 争吵,
外套, 合同, 行李. Relocked sentences' cards are suspended, as for any
relock, and come back when the word is learned. `recomputeUnlocks` runs after an import or a name change, never
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
| `chongfuxi_settings` | owner: new sentences per day. No longer read: there is no daily limit. |
| `chongfuxi_sentence_left_out` | sentence taken out of the corpus (cut short), as it was, same id, with why |
| `chongfuxi_learn` | word through Learn in a session: misses, and each step with its sentence and how it went. Never touches a schedule. `chongfuxi_card.learned_at` marks a new Read card as through Learn. |

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

## Analysing a text

Settings › Analyse a text (`components/TextAnalyser.tsx`, route `analyse`,
`app/api/chongfuxi/analyse.ts`): how much of a text the owner can read, and
which words would open up the most of it. The owner asked for something like
Chinese Text Analyser, but measured against this corpus.

- In: pasted text (anyone; a visitor's isn't kept), a web page by its link
  (`fetchtext.ts`: fetched on the server, charset honoured, the lines of its
  article or body with four or more Han characters kept), or a YouTube
  video's Chinese captions (`youtube.ts`: the player asked for as YouTube's
  Android app, then its iOS app, asks for it, since the web player's caption
  links now need a browser token; hand-made captions before automatic,
  simplified before traditional; each caption line a line of the text). Links
  are the owner's only. YouTube may refuse a server it takes for a bot; then
  the message says to paste the transcript instead.
- Words as the Texts import splits them (dictionary matching, four
  characters at most) and known as unlocking counts them (`lib/unlock.ts`):
  known, or made of known words. A deck word whose Read card is new or under
  three weeks strong is "still being learnt".
- Shows: the share of its word occurrences known (large), distinct words
  known, sentences readable and one word away; its distinct words by HSK 3.0
  level; the text with words marked (not known highlighted, still being
  learnt underlined), a tap giving reading and meaning; and the words to
  learn, ranked by how often each stands in the way plus four for each
  sentence it alone holds back.
- Does: tick words and add them (one addition, source `text:<title>`, Keep
  or Undo as from Lists), and add its sentences to the corpus under a name
  (`ingestSentences`, as the Texts import does).
- Kept: the owner's texts, as text only (`chongfuxi_text`), listed under the
  box; reopening one analyses it again against what is known then.
- Not yet: traditional-character texts split poorly (the dictionary
  matching is simplified).

## Texts

Plain Chinese text (a textbook's 课文, an article) joins the corpus as
sentences from Settings › Texts (`components/TextImport.tsx`,
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

Every sentence keeps the sources it came from (`chongfuxi_sentence.sources`:
the Pleco and Anki deck names, or the name typed for a text upload). Cards ›
Sentences filters by one (the source button beside the search), the
Readable / One away / Locked counts following it (`listSources`, route
`sources`; `source` on `sentences`). Unlock next still counts every source.

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
  log on Settings › Anki syncs, where every sync's page opens. Two or more such
  syncs in a row fold into one line there ("±0 ×5"), opened with a tap. Undo puts each word back as it
  was, removes its unanswered cards and those of the sentences it unlocked,
  and re-locks them; the notes stay marked, so the next sync doesn't add them
  back. Refused once any of its words has been answered.
- Deleting a note in AnkiDroid does nothing here: the owner's choice. A word
  is taken out of the deck from its sheet on the Words tab (`removeWord`):
  its Read and Recall cards go with their answers, it goes back on its list
  if it has one (out of the corpus otherwise), the sentences that needed it
  lock again, and an Anki note for it is marked `removed`, so the next sync
  doesn't bring it back. A Pleco re-import would. To take a word out of
  review without losing it, suspend it instead (Review rules).
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
shows its words, those missing ticked (Untick all / Tick all beside them,
asked for by the owner: Untick all leaves out every missing word, those not
loaded yet too, and sends the ticked ones as `only`); "Add N words" adds the ticked ones as
one addition (`addList`, source `list:<path>`), which opens at once with
Keep and Undo, as a sync's do. NPCR and 成语 are left off the screen
(`LISTS_HIDDEN`): the owner doesn't study from them. At most 500 at once (`LIST_ADD_MAX`), so a
whole scheme is refused and a lesson or level isn't. Routes: `lists` (GET
the tree, or `?list=` its words; POST to add, owner).

Learn, Review and Add show only on a list with none under it (a lesson, a
level, a song), at the owner's request; a book or a scheme is for browsing.
Each list also shows how many of its words are due today (words with a Read
or Recall card a session would deal: due before the day ends, not answered
yet today), and a list with any has Review (the count beneath, beside Learn
and its new words: one line, at the owner's request): a session of only that
list's word cards, Read and Recall whatever Today's choices, no sentences
(`list` on `session`; `onList` in `app/api/chongfuxi/review.ts`, 龙库 by
`longku_bank`). It takes the whole screen like any session and closes back
onto the same list. It isn't kept to carry on from, so it never replaces the
day's own session; its answers go through the outbox as any others.

## Lists from the owner's content: Spotify

Cards › Lists opens on the lists themselves, no title: first the study lists,
in the owner's order (HSK 2012 first, then the course books such as
HSK标准教程, then HSK 3.0; `topRank`), then "From your content": 龙库, Spotify
and Muse, each with a pill in its colour like 龙库's ("linked to 龙库" red,
"from Spotify" green, "by Muse" in the accent blue), lists made from what
the owner reads, listens to, plays or has their agent write. The first such source is Spotify
(`ListNode.source`), with a song per list ("Spotify/<title>"). Planned next,
at the owner's word: websites, YouTube and other sources, each its own
top-level list beside Spotify. Most of the reading exists already, for the
text analyser: `fetchPage` (fetchtext.ts) and `fetchCaptions` (youtube.ts)
give a page's or a video's text, and `songWords`' splitting works on any
text; a new source needs its reader, a `source` value and its add form.

- **Pleco's 歌词 lists are songs**, so they live under Spotify: `songListOf`
  files 歌词/… as Spotify/… on import, and `moveSongLists` moved the rows
  already there (once per server start, from `listTree`; nothing is written
  once done). A re-import keeps every Spotify/… list a word is on and takes
  Pleco's other lists as Pleco has them.
- **Adding a song** (`app/api/chongfuxi/spotify.ts`, route `lists/spotify`,
  owner; the form is on Spotify's page): a track link
  (open.spotify.com/track/…, intl-xx/ or spotify:track:). Its title and
  artist come from the track's public page (the page title "<title> - song
  and lyrics by <artist> | Spotify", else og:title and og:description, else
  oEmbed's title). The lyrics come from [LRCLIB](https://lrclib.net) (open,
  no key; Spotify gives its lyrics to no one), by title and artist, else
  title alone; when none are found the reply asks for them and the form
  takes them pasted. Traditional characters become simplified through
  CC-CEDICT's single-character pairs, leaving any that are simplified
  characters too (著, 乾). Credit lines (作词：…) are skipped, and the lines
  are split into words by the same dictionary matching as a text; every
  dictionary or corpus word is kept, in order, at most 600.
- The words are filed as the Pleco lists' are (`chongfuxi_word.lists`): new
  ones come in as list words with CC-CEDICT's definitions, deck words just
  get the list too, so the song's page browses, adds, learns and reviews
  like any list. A second song with the same title takes " · <artist>".
- Only the words are kept, with the song's title, artist and link
  (`chongfuxi_song`, made on first use): lists are readable by anyone and
  lyrics aren't ours to publish. A song's row shows its singer; its page,
  "Open in Spotify".
- Neither Spotify nor LRCLIB is reachable from the cloud sessions that build
  this (the network policy refuses them), so the fetching was tested against
  stand-ins: the page reading, simplifying and splitting on their own, the
  writes against a local Postgres.

## Lists written by the owner's agent (Muse)

The owner's agent writes word lists through `/api/chongfuxi/agent/lists`
(`app/api/chongfuxi/agent.ts`), at the owner's request. Every method needs
`Authorization: Bearer <CHONGFUXI_AGENT_TOKEN>` (set on Vercel, at least 32
characters, a stray space or newline around it trimmed; compared in constant
time; unset or short, nothing gets in and the answer is 503 "agent token not
set on the server", so it can be told from a wrong token's 401):
a bearer secret over HTTPS, since Vercel offers no client certificates for
this. The owner's login is never involved, so the token is the agent's only.

- **POST** `{ lists: [{ path, words, replace? }] }`, up to 50 lists of 500
  words. `path` nests with "/" ("Travel/Airport" or `["Travel",
  "Airport"]`) and always lives under the top-level **Muse** list
  (`MUSE_LIST`; a leading "Muse" is taken as that), so the agent can never
  touch the Pleco, textbook or Spotify lists; at most 6 levels, 60
  characters a level, "/" inside a name made "／". Each word is filed under
  the list as a Spotify song's are: one not in the corpus comes in as a list
  word with CC-CEDICT's definitions, a deck word just gets the list; a word
  that isn't Chinese, is over 12 characters, or that neither the corpus nor
  the dictionary knows is skipped and named back. `replace: true` writes
  the list whole: what isn't given is taken off it and off its lists below.
  Nothing joins the deck or unlocks. Answers `{ written: [{ list, words,
  fresh, removed, skipped }] }`.
- **GET**: every Muse list with its words, in the deck or not.
- **DELETE** `{ path }`: the list and those below it taken off every word;
  the words stay.
- In the app the Muse lists sit under "From your content" beside Spotify
  (`source: "muse"`), browsed, added, learnt and reviewed like any list.

**Muse's daily page** (`app/api/chongfuxi/musepage.ts`,
`components/MusePage.tsx`; the owner: "give muse very generic, atomic tools
to work with and it can choose how to layout an additional review
everyday… full freedom", not in the main review, and not replacing the
episode analyser). Muse lays out one page a day from blocks and reads what
it needs through small data tools; everything the owner does on a page
comes back to it, so it can make less of what goes unused.

- **Write** (same token): GET `/api/chongfuxi/agent/muse` gives `day`,
  `brief` (every block and tool, and to use what was done), `written`, and
  the last 7 pages with their blocks and every event on them. POST `{
  title, note?, style: scroll | steps, blocks, day?, model? }` keeps that
  day's page (`chongfuxi_muse_page`, made on first use; posting again
  replaces it, its events kept by block id). `checkBlocks` keeps each
  block only in a shape the app can draw and names the rest back in
  `dropped` by place (b9, b8.2 inside a fold): a page with nothing left is
  refused. Ids are Muse's, else by place.
- **Blocks** (`MuseBlock` in `lib/api.ts`, at most 60): heading; text (Muse's
  prose, blank lines between paragraphs, **bold**, `words` linked to their
  pages); callout (a label, info / good / warn); passage (Chinese Muse wrote
  or quoted from the web, `en` lined up by paragraph, a source link, words to
  underline: marked against the deck when opened, as the analyser marks it,
  every word tappable with Word page ›, 🔊 Listen, English a paragraph at a
  tap); cards (up to 40 of the review's card shapes, checked by drill.ts's
  `checkCard`: a row with how far it got, opening the cards full screen,
  "Go over the N missed"); ask (a question in Chinese answered by voice or
  typing, `check: now` graded at once by the app's model at Look up's model
  and effort against the passage it is `about`, or the page; `check: muse`
  kept for Muse to answer on the next page, "Kept for Muse"); words (with
  reading, meaning and standing: Known, Learning, On a list, New; each
  opening its page); figures (up to 8 tiles); link; episode (opens it, the
  page coming back after); fold (folded blocks, one level).
- **Steps or scroll**: `steps` shows one heading's section at a time with
  "Next · <the next heading>" (a `done` event each), `scroll` the whole page.
- **What was done** (`chongfuxi_muse_event`, made on first use; route
  `muse` POST, owner): the page opened, each card answered (`idx`, got or
  missed, what was given), words tapped in a passage, answers (with the
  grade when checked), a fold opened, a link or episode followed, steps done.
- **Data tools** (same token): GET `/api/chongfuxi/agent/muse/data?what=`
  `stuck` (words to revive and the new words on the ladder), `words` (up to
  12 words' whole word pages), `log` (the review log between two days, at
  most 3000 answers), `week` (the weekly figures, `weekFigures`), `lookups`,
  `known` (strong words and the day's targets) and `sentences` (the
  owner's sentences holding words); POST `…/muse/measure` `{ text }` or `{
  url }` (how readable it is, the words not known, and a page's text to
  quote from). The older material routes (drill, notes, reading, episodes,
  week, story) stay as more data.
- **Owner only, reads too** (route `muse`, GET `?list=1` the pages, else a
  day's, the latest by default, filled in): a page may quote the web, and
  the app is otherwise readable by anyone.
- Nothing on it touches a schedule or goes into the main review.
- Tested against a local Postgres (writing, the block check, filling,
  events, answers kept for Muse, the data tools) and in the browser with a
  stand-in page, scroll and steps, light and dark at 360px. Not yet run
  with Muse or with an answer graded by the model.

**The daily story** (`/api/chongfuxi/agent/story`, same token; no screen
of its own since Muse's page, its material still there): GET gives
the day's material (`storyMaterial`): `day` (the owner's study day, by the
UTC offset of their last answer, turning over at `ROLLOVER_HOUR`), `targets`
(the stuck words, up to 8, the new words on the Learn ladder, and up to 6 of
the weakest due, each with pinyin, gloss and `why`), `known` (up to 200 deck
words strong for 30+ days, to write the rest with), `brief` (how to write
it) and `written`. POST `{ title, paragraphs: [{ zh, en }], day?, model? }`
keeps it as that day's story (one already there replaced; up to 3
paragraphs, 600 characters of Chinese each; refused without Chinese), its
targets the material as it stands then.

**Muse's review** (`app/api/chongfuxi/drill.ts`, `/api/chongfuxi/agent/drill`,
same token; the owner's ask: cards made from their "specific problem areas",
with "the freedom to make any type of card"). GET gives the material
(`drillMaterial`): `day`, `brief` (the card shapes and how to write them),
`written`, and the problem areas: `stuck` (the words to revive with their
category, why and partner), `notes` (what was written after a Forgot, 30
days), `trips` (sentences forgotten with the words tapped), `lookups` (with
the owner's verdict and note), `attempts` (their own kit sentences graded
almost or wrong), `last` (the last review, card by card, and how each went,
so Muse can follow up) and `known` (strong words to write the rest with).
POST `{ title?, note?, cards, day?, model? }` keeps up to `DRILL_MAX` (40)
cards as that day's review (one already there replaced, its results with
it); Muse can write once a day or whenever it likes. A card is one of six
shapes (`DrillCard` in `lib/api.ts`, checked by `checkCard`, anything else
dropped and counted back as `dropped`), each with `focus` (its words), `why`
(the problem it aims at) and `explain` (shown after answering):
**flip** (front, back, hint: anything at all), **cloze** (a sentence with
`___`, its English, options or none), **choice** (2–6 options, the index of
the right one), **order** (the pieces in order; the app shuffles them),
**produce** (English to Chinese, said out loud, then "One way to say it"
and `accept` shown and self-graded: typing was taken out, since a sentence
has too many right versions to match and the owner's correct 慢慢地走 was
struck through),
**listen** (read aloud by the phone's zh-CN voice, then shown).

The first review (36 cards) showed what goes wrong, and the brief now
makes Muse check each card against it: exactly one right answer (搭, 坐 and
乘 all fit 她要___火车), distractors that are the real confusion, not filler
(乘客 for 乘坐), nothing giving it away, the actual failure tested, one angle
per word, an explanation of why the near misses are wrong. The owner chose
this over a check by the app's model. `checkCard` also drops what code can
see: duplicate options, an order card of single characters or under 6
characters (来 日 方 长), and a hint whose parts are in the prompt or answer
("theme, subject" on "The theme of this article…").

Its own screen (`DrillView`, "Today's review" heading Muse reviews) was
taken out for Muse's page, whose cards blocks take the same shapes, drawn
by `DrillCardView` in `components/Drill.tsx`; the material route stays as
data for Muse. As it was: each card in its own way. A card that can
tell (cloze or choice picked, order checked, produce typed) marks Got it or
Missed as suggested; the owner still taps one. Each answer is kept, the
latest per card (`chongfuxi_drill_answer`, route `drill`, POST owner only;
GET, anyone, the latest review with its results). It opens on the first
card not yet answered; the end shows the score, the missed with what to take
from each, and "Go over the N missed". Nothing touches a schedule.

**Reading with retelling** (`app/api/chongfuxi/reading.ts`,
`components/Reading.tsx`; the owner's idea: "muse could find native content
to get me to read", with production by retelling, which the owner chose
over typed cards). Muse finds real Chinese written for natives (articles,
posts, YouTube videos with Chinese captions), checks each link with POST
`/api/chongfuxi/agent/reading/check` `{ url }` (`checkLink`: the page or
captions fetched as the text analyser fetches them and measured against
the deck: `known`, the share of word occurrences known, `readable`,
`chars`, `newWords`, and `fits`, inside `READING_TARGET`, 90–98% known),
and hands the picks in with POST `/api/chongfuxi/agent/reading` `{ items:
[{ url, why, questions: [{ zh, en }] }] }` (up to `READINGS_MAX`, 5, a day;
1–4 questions each; a link that can't be fetched or has no Chinese
question is named back in `failed`). GET there gives the material: `brief`,
`target`, `focus` (stuck and new words), `today` and `recent` (two weeks:
opened, finished, the words tapped, each retelling with its grade). Same
token as the lists.

Its screen (`ReadingView`, Read on Muse reviews) was taken out for Muse's
page, where a piece is a passage block and its questions ask blocks; the
answer box (`Question` in `components/Reading.tsx`) stays, for those and
for episodes. As it was: only the link, why, the questions and how it
measured were kept (`chongfuxi_reading`): the text is fetched again when it is opened (kept
half an hour in the server's memory, `FETCH_KEEP_MS`, so reading then
retelling fetch once), and opening one (route `reading?id=`) is owner only,
since the app is readable by anyone and the pieces aren't ours to serve.
The list of links is public. On the Muse reviews screen they come first,
under **Read** (the latest day's), each with its site, % known, length,
Muse's why and its state (New, Started, Read, N/M retold, Retold); Today's
Muse reviews button counts those not yet read ("2 to read"). A piece opens
full screen with every word marked as the analyser marks it (not known,
still learning), a tap giving reading and meaning with Word page ›; the
words tapped that aren't known go back (`tapped`), and "Done reading ·
retell it" marks it finished and scrolls to the questions. Each question
(its English on a tap) takes an answer in Chinese, said through the
phone's speech recognition (zh-CN, `webkitSpeechRecognition`, "🎙 Say it")
or typed, and Check grades it at Look up's model and effort
(`gradeRetell`, never lower): correct / almost / wrong, whether it fits
what the piece says (`understood`), how a native would say what was meant,
and why; every try is kept (`chongfuxi_retell`) and shown under the
question, newest first. Speech recognition slips are to be ignored by the
grader, real word mistakes not. Tested with a stand-in page and model
reply: the cloud session can't reach the web.

**Notes, answered** (`app/api/chongfuxi/notes.ts`, `components/Notes.tsx`;
the owner: "I will mark a card wrong and explain which word I thought it
was… I'm basically asking an ai but we don't ever use those notes"). A
note written after a Forgot (`chongfuxi_review.comment`) is a question
Muse now answers. GET `/api/chongfuxi/agent/notes` (same token) gives the
unanswered ones, oldest first, up to 60 (`?all=1` for every note), each
with the card's word (pinyin, gloss), the sentence, the words tapped, the
note and the words it names with their meanings, plus `brief` and `left`.
POST `{ answers: [{ id, partner, difference, pair: { mine, theirs } }] }`
keeps them (`chongfuxi_note_answer`, made on first use): every answer is
kept, several to a note if Muse answers again; the partner must be Chinese
and not the word itself, each pair sentence must hold its word (else the
pair is dropped), and an unknown id or empty difference is named back in
`failed`.

- **Named words, no AI** (`namedIn`): each run of Chinese in a note, whole
  if it is a corpus word or a CC-CEDICT headword, else the longest words
  inside it, the card's own word left out ("thought it was 发现" → 发现).
  With Muse's partners, they vote for Words to revive's Mixed up partner
  at 2 votes a note, as strong as a lookup (`notePartners` in
  `stuckWords`), so a note alone files the word under Mixed up.
- **On the card** (`cardAnswers`, `answered` on `SessionCard`): Read and
  Recall backs show the answers to notes on the word's cards or naming it
  as the partner, newest first, two at most: "You thought 发现" (or "Taken
  for this on 发觉" on the partner's card), the difference and the pair,
  in Recall's colour, until the word is got right `RESCUE_CLEAR` (2) times
  in a row after the answer, like a kit's hook.
- **On the word page**: "Your notes" (`noteEntries`, `notesForWord`):
  notes on its cards, on sentence cards where it was marked as the
  trouble, naming it, or answered with it as the partner, each with every
  answer, newest first. "Where it tripped you" keeps the sentences.
- **The list**: "Your notes" on Muse reviews ("N of M answered by Muse"),
  full screen (`NotesView`, route `notes`, readable by anyone, 50 at a
  time): every note newest first, its kind, word (opening its page), the
  sentence, what was written, and every answer, or "Muse hasn't answered
  this yet".
- Muse's review material carries `answered` (the latest answer to recent
  notes) so it can test those pairs.

**The weekly debrief** (`app/api/chongfuxi/week.ts`, `components/Week.tsx`;
the owner picked it from Muse's next steps): the app counts the week and
Muse says what it means, so the figures are always true. GET
`/api/chongfuxi/agent/week` (same token; `?to=YYYY-MM-DD`, the week's last
study day, today's by default) gives `brief`, `written` and `figures`
(`weekFigures`): for the seven study days ending `to`, beside the seven
before, the days studied, minutes (the gaps between answers in a session,
those over 3 minutes left out as breaks, as for the pace), answers by kind
and got; then words through Learn (`learned_at`), word cards that passed 21
days' stability (`MATURE_DAYS`), words forgotten twice or more, the words to
revive now, lookups, notes, Muse's review answers, and each episode's share
of words known at the start and end of the week (the last measure before it,
else the first in it). POST `{ to?, title, sections: [{ kind: better | stuck
| looked | focus | note, title, text, words }], focus, model? }` keeps it as
that week's (`chongfuxi_week`, made on first use, one a week, a second
replacing it) with the figures as they stand then; up to 8 sections, text
900 characters, words only Chinese; refused with no section with text. In
the app (route `week`, the latest, readable like the rest of the log) it is
a row at the top of Muse reviews' list, "Weekly debrief" with its dates and
the New badge (`week:<at>`), opening full screen: Muse's title, four tiles
(cards answered, got it %, minutes, days studied), each up or down on last
week, a line of the rest, Muse's sections with their words opening word
pages, the words it will aim at, and the week's words folded away
(forgotten most, matured, learnt, episodes). That screen (`Week.tsx`) was
taken out a day later for Muse's page: the figures are the `week` data
tool, and a debrief is something Muse may lay out on a page.

**Getting ready to watch a drama** (`app/api/chongfuxi/episodes.ts`,
`components/Watch.tsx`; the owner: "pre study a script or subtitles, using
my corpus as a backbone and muse analysis helping", e.g. 隐秘的角落 episode
1). Choices the owner made: Muse finds the subtitles; the lines stay out of
sentence cards for now; spoilers are fine; and scenes to scrub through "like
YouTube chapter feature".

- **In** (same token): POST `/api/chongfuxi/agent/episodes` `{ show,
  episode, subtitles, english?, title?, source?, video? }`, SRT asked for (timed,
  the commonest; plain lines have no times for the chapter bar).
  `parseSubtitles` reads SRT, VTT, ASS or plain lines: tags and `\N`
  dropped, traditional made simplified (`simplified`), a bilingual line's
  English kept as its `en`, the Chinese deduplicated, up to `LINES_MAX`
  (3000). `english`, an English file of the same release (the owner wanted
  the translation at hand), is put onto the lines by time (`addEnglish`):
  each English cue to the line it overlaps most, or the nearest within a
  second (`NEAR_MS`), after any English the line has; the material's
  `english` counts the lines that got one, so Muse can tell a file timed to
  another release. One row per show and episode
  (`chongfuxi_episode`, made on first use); sending it again replaces the
  lines and clears the prep. Refused without Chinese.
- **Material**: GET there lists them; `?id=` gives `brief`, every line (index,
  time, Chinese) and up to 400 words not known, each with its count and up to
  4 lines it is in (`episodeMaterial`). Measured as the text analyser
  measures (`analyse`, one paragraph a line), names counting as known.
- **Prep**: POST `/api/chongfuxi/agent/episodes/prep` `{ id, words: [{ word,
  tier: must | nice | skip, keep?, note }], names, scenes: [{ start, title, summary,
  summaryEn, notes, question? }], questions: [{ zh, en }], model? }` (`writePrep`).
  Scenes are sorted by `start`, the first forced to 0, out-of-range ones
  dropped, at most 40; questions at most 8. A scene's `title` is a short
  Chinese title and `titleEn` its English (the owner wanted the chapters
  named in full and in Chinese; episodes prepped before have English in
  `title`). Any of words, names, scenes and questions left out of a post
  keeps what was there, so the scenes can be sent again alone. The must-know words are written
  whole to the Muse list `Muse/<show>/<episode>` (`writeList`, `replace`), so
  they learn and review like any list. Until it is prepped, scenes are cut
  at pauses of 8 s or more with at least 8 lines between (`autoScenes`).
- **Line notes, like Genius** (the owner wanted it to work like Genius
  does for lyrics, with Muse writing from what it knows they have trouble
  with): POST `/api/chongfuxi/agent/episodes/lines` `{ id, lines: [{ i,
  quote?, kind, text, words? }], replace? }` (`writeLineNotes`, in as many
  posts as Muse likes; a note replaces the one on its line, `replace` drops
  the rest; kept as `chongfuxi_episode.notes`, up to 1500). `kind` is
  trouble, slang, grammar, culture, meaning or listening (else meaning);
  `quote` must be a run of the line as written, else the note is on the
  whole line. The material gives Muse `trouble` (`troubleIn`: the episode's
  words that are stuck words, with their category and why, else forgotten
  in 30 days, else written about after a Forgot in 90, each with the lines
  it is said in), each line's count of new words, and the lines already
  annotated; the brief has it annotate the trouble lines first, then slang,
  grammar, culture, meaning and listening.
- **Must-knows count as new** in the episode while they aren't in the deck
  (`mustNew`, `standingIn`), even when they read through their parts: the
  owner saw 福利院 marked Known, read as 福利 + 院 by the unlock rule for a
  known word with something added (准备好了), though Muse had picked it as
  a word to learn. Elsewhere a word known only through its parts says so
  in the line panel: "From its parts", and "Not in your deck: read as 福利
  + 院" (`parts` on `LineWordInfo`, the deck words it splits into, longest
  first).
- **Grading a line** by its words (no model): **Clear** (every word known),
  **Learning** (known, some still being learnt), **1 new**, **2+ new**
  (`gradeOf` in `Watch.tsx`), shown as a bar down each line's left in the
  Sentence green, Read blue, amber and red, as a stacked bar on each
  chapter's chip, and as the episode's share of each on the Words tab.
- **On screen** (owner only, since subtitles aren't ours to serve; the list
  of episodes is public): "Watch" rows on Muse reviews (show, episode,
  length, lines, % known, Prepped or Waiting for Muse); Today's Muse reviews
  button shows for them too. An episode (`EpisodeView`) is one screen like
  an app, not a page that scrolls (the owner's ask): a bar on top (close,
  the show and episode, "% known" opening Words), then three tabs:
  - **Script**: the chapters fixed under the tabs (`ChapterStrip`): the
    scrub bar (as before, its time and title showing only while scrubbing)
    and a chip per chapter (start, the whole title on up to two lines,
    its English under it while English is on, its lines' grades; the tip while scrubbing shows it whole too), scrolled
    sideways, the chapter in view lit and brought to the middle. Under it
    the whole script scrolls on its own: a key (the grades, ✦ for Muse,
    the English switch), then each chapter's heading (time, % known, title,
    what happens folded to two lines, a tap opening it with the English and
    Muse's notes) and its lines: time, ✦ when Muse has a note, the words
    marked as the analyser marks them, must-knows stronger, the owner's
    trouble words with a red wavy underline, the run Muse's note quotes on
    a grey wash, the English under it (blurred until tapped with English
    off). A chip scrolls the script to its chapter (the chapters it glides
    past aren't lit one by one); scrolling lights the chapter in view.
  - **Scrubbing** (`ChapterBar`; the owner found the first version didn't
    work well): dragging along the bar moves the script with the finger,
    line by line, to the line said at that time (`lineAt`), with no
    animation to fight it; the tip shows the time, the chapter and that
    line. A tap jumps there. A playhead on the bar shows where the script
    is (the first line at its top) as it is read or scrolled. The first
    version only jumped on letting go, to the chapter's start, by a smooth
    scroll that lit every chapter on the way; and every jump (a chip, a
    line, the bar) read row positions with `offsetTop`, which
    `content-visibility: auto` on each chapter makes relative to the
    chapter, so jumps landed in the wrong place. Positions are now read
    from the screen (`topIn`).
  - **Watching with the video** (the owner: "line up the subtitles with
    the YouTube video embedded in our app"). An episode has a YouTube video
    (`chongfuxi_episode.video`; Muse gives `video` with the subtitles or
    POSTs `{ id, video }` to agent/episodes, the owner pastes a link from
    "▶ Add the YouTube video" (POST `episodes` `{ id, video }`), and a
    source that is a YouTube link counts; `setEpisodeVideo`), and an
    `offset` (`offset_ms`: video time minus subtitle time, for subtitles
    timed to another release). With one, the Script tab has the video
    over the chapters (`VideoBar`, YouTube's IFrame player API loaded once,
    `loadYouTube`), played inline, and its clock (every `VIDEO_TICK`, 250
    ms, less the offset) lights the line being said (`is-saying`) and,
    while following, keeps it a third of the way down the script. Scrolling
    the script by hand stops following; "↓ Follow" brings it back. A line's
    time plays from there, a chip from its chapter, the scrub bar from where
    it is let go (the video's clock doesn't move the script while
    scrubbing). Opening a line pauses it. Sync nudges the offset half a
    second at a time (`NUDGE`), kept for the episode; Hide takes the
    picture away and keeps it playing. Tested with a stand-in player: the
    cloud session can't reach YouTube.
  - A tap on a line (or a word in it) opens it at the foot of the screen
    (`LinePanel`, back closing it): ‹ › a line before or after, ✦ Next
    note, the line large with 🔊, its English, Muse's note (its kind,
    the quote, the text), then its words as they live in the corpus
    (`lineWords`, GET `episodes?id=&line=`, kept per line while open):
    trouble words first, then must-knows, new, learning; each with
    pinyin, gloss and where it stands (the trouble category, New, On a
    list, Learning, Known), opening to its Read and Recall cards (how
    strong, when due, lapses), its kit's hook, the owner's notes on it
    with Muse's answer, its lookups, how many of the owner's sentences
    have it (and readable) with one, how often it is said in the episode,
    and Word page ›. Known words with nothing to say fold into one line.
  - **Practice opens chapter by chapter** (`ChapterRound`; the owner: "more
    bite size… watching this episode chapter by chapter so it's more
    digestible"; they chose all four steps): a short loop per chapter, from
    the first not done, ‹ › to any other, steps Prep · Watch · Check · Done
    across the top (each a tap away). **Prep**: what happens (Chinese,
    English on a tap) and its key words (`plan.chapters[c].words`: ranked
    as the whole plan is but within the chapter, at most `CHAPTER_WORDS`
    (5), worth keeping or for the show as there) through the same drill
    (`PrepDrill`, its end "Watch the chapter ›"). **Watch**
    (`ChapterWatch`): the chapter's stretch of the video (YouTube's `start`
    and `end`, so it stops at the chapter's end; "↺ From the start"), its
    lines below lit as they are said (a tap jumps there), a Subtitles
    switch blurring them; with no video, its lines to read, each said
    aloud on a tap. **Check** (`ChapterCheck`): up to `CHAPTER_LISTEN` (3)
    of its lines heard first (those with its key words, Muse's notes, then
    the most new words; 5 to 30 characters; Again sends one to the end),
    then retold in Chinese by Muse's question for the chapter (a scene's
    `question` in the prep) or "这一段发生了什么？", graded at Look up's
    model and effort against the chapter's lines (POST `episodes` `{ id,
    chapter, answer }`, `chapterStep`; kept in
    `chongfuxi_episode_chapter_retell`). **Done**: Finish marks it (`{ id,
    chapter, done }`, `chongfuxi_episode_chapter`), its chip in the script
    gets a ✓; then the next chapter, or "Rewatch without subtitles". Under
    it, "Whole episode" opens the round below.
  - **Practice** (the whole episode) is a round of prep that moves readiness (the owner found
    the listening practice below couldn't: readiness counts only words
    known, and it taught none; and "I don't need to be 100%… I'm worried
    about having words in my deck that I'll never see again after the
    show"). The server's plan (`planOf`, sent as `plan`): the words not
    known, Muse's skips left out, ranked by what each does for the episode
    (three for each line it alone keeps unreadable, plus how often it is
    said, plus eight for a must-know), at most `PREP_MAX` (15, the owner's
    cap), each **worth keeping** (on an HSK list, in `KEEP_SENTENCES` (5)
    or more of the owner's sentences, or Muse's `keep: true`; Muse's
    `keep: false` overrules) or **just for this show**; the rest listed to
    skip, with readiness now and once the plan is learnt ("86% → 92%",
    lines readable too). The tab counts the plan's words. "Learn these N"
    runs a drill (`PrepDrill`) from the episode's own lines (each word's
    easiest, as for the deck below): meet it (reading, meaning, Muse's
    note, a line with it marked and its English), what it means in a line,
    then which word fills the gap in a line (its English or meaning
    shown); a miss comes back `PREP_BACK` (3) cards later at that step,
    Stop leaves keeping what is done. A word done is sent at once (POST
    `episodes` `{ id, learnt, keep, day }`, `learnEpisodeWord`): worth
    keeping, into the deck (one addition, source `episode:<show>
    <episode>`) and marked through Learn, due the next study day like a
    word finished on the ladder; for the show, kept in
    `chongfuxi_episode_prepped` (made on first use), never in the deck or
    scheduled. A prepped word counts in the episode as still being learnt
    (`standingIn`, before a must-know's forced new), so readiness rises;
    `coverage.prepped` is the share it carries, kept with each day's
    measure and shown in the graph's legend ("of which prepped for the
    show"). After a round the episode is measured again: "Learnt 4 · 2
    into your deck · 2 for the show. Readiness 86% → 90%", then the next
    plan. "Prepped for this show" lists those words. Under it, **Listen
    through the trouble lines** opens the listening practice (the owner:
    "a lot of sentences to get through… only do
    the tough ones"; they chose the best line per word, heard then read):
    the lines the server picks (`pickDeck`, sent as `deck`): for each
    must-know not in the deck and each trouble word, its easiest line (the
    fewest other words not known, then nearest twelve characters, then one
    with English), a second, away from the first, for a word said three
    times or more (`SECOND_LINE_AT`), and every line Muse annotated; a line
    serving several is one card, in story order. A card plays the line
    with the phone's voice ("Listen. What did they say?", 🔊 again); Show
    gives the Chinese with its words marked (a tap opens the word page),
    the English, the words it was picked for with pinyin, gloss and trouble,
    Muse's note, and why it was picked; Again brings it back
    `AGAIN_AFTER` (3) cards later, Got it moves on. Each answer is kept,
    the latest per line with the tries (`chongfuxi_episode_card`, POST
    `episodes` `{ id, card, result }`); the tab counts the lines not yet
    got, the home shows got / again / not tried, Carry on, and after a
    round "Go over the N again". Nothing touches a schedule. Muse's
    material lists the lines last marked Again (`again`).
  - **Words**: readiness and its graph, how the lines read, the
    must-knows and their list, the names, the other words not known.
  - **After watching**: Muse's questions, graded as before.
- **Readiness over time** (the owner wanted to see it go up): each measure
  is kept, one row per study day, the latest that day winning
  (`chongfuxi_episode_progress`: words known, known with the must-knows,
  lines readable, must-knows left; `record`). An episode is measured when
  opened, and reading the episode list measures up to `MEASURE_ON_LIST` (3)
  not yet measured today (`measureStale`), so the graph grows on days it
  isn't opened. Nothing is filled in for days before the first measure.
  Under the readiness figures, a line chart (`ProgressChart`): the three
  shares by date, words known blue, with must-knows amber and dashed, lines
  readable green, from a round step under the lowest to 100%; a tap or drag
  picks the nearest day, its values in the legend and the must-knows left
  under it.
- Tested against a local Postgres (parsing, prep, the list, coverage) and in
  the browser with stand-in data: the cloud session can't fetch subtitles.

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
(made on first use), listed on Settings › Bug reports with Mark fixed / Won't fix.

**To work on them from a Claude session:**

    npx tsx chongfuxi/scripts/bugs.ts          # open ones → .bugs/<id>.md + .jpg
    npx tsx chongfuxi/scripts/bugs.ts --all
    npx tsx chongfuxi/scripts/bugs.ts --close 12 fixed "what was done"

Read each `.bugs/<id>.md` and look at its `.jpg`, fix, then close it (that
needs `CHONGFUXI_BUGS_TOKEN` in the session's environment, the same value as
on Vercel; otherwise say which to mark fixed in the app). A cloud session
needs `benji.codes` in its environment's allowed domains. `.bugs/` is
ignored by git. Reports are readable by anyone, like the rest of the log.

## 龙库 is backed by this app

龙库 (/longku, the chengyu chain game) keeps its tables (`longku_bank`,
`longku_review`, `longku_sweep`, `longku_excluded`) in this database
(`app/api/longku/db.ts` reads `CHONGFUXI_DATABASE_URL`; its old store is no
longer read). Its words are deck words here; the two keep separate schedules,
by the owner's choice: `longku_bank` holds 龙库's own game state.

- `app/api/chongfuxi/longku.ts`: `reconcileLongku` runs after anything that
  changes the deck (`addWords`, `removeWord`, `undoAddition`, a Pleco
  import): every deck word in 龙库's idiom list (`longku/data/chengyu.json`)
  is linked into 龙库 unless the owner removed it there (`longku_excluded`),
  and a 龙库 word that has left the deck leaves 龙库.
- Adding in 龙库 (`longkuAdd`, from its bank route's `add`) puts the word in
  the deck too: one addition, source `longku`, a new Read card each.
  Removing in 龙库 (`longkuRemove`) only unlinks it and remembers that; the
  deck word and its cards stay. Removing from the deck here unlinks it.
- Shown here as a 龙库 tag (card header, word sheet, new-word screens) and as
  the 龙库 list, first in Cards > Lists, marked "linked to 龙库".
- The move (Oct 2026): `longku/scripts/migrate.mjs` made the tables,
  `longku/scripts/move-to-chongfuxi.mjs` copied 89 words, 447 reviews and the
  sweep (re-runnable; newer rows win), `chongfuxi/scripts/link-longku.ts` put
  the 67 not yet in the deck into it with Read cards seeded from 龙库's record
  (`seedFromLongku`: 龙库's interval for the word's strength as stability)
  and linked 18 deck chengyu into 龙库: 107 in all.
- `scripts/check-longku.ts` checks the link against a throwaway owner.

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
- Cut short: a sentence card whose pinyin runs two or more syllables past
  its characters lost its end in the deck (参加了训练课程就有资格成为, its
  pinyin going on to 当驾驶教练, cut at a "/"; bug #9) or isn't the sentence
  its pinyin reads. `cutShort` in `lib/corpus.ts` leaves it out at import
  (97 cards in the owner's backup, nearly all in 18k HSK Sentences).
  `scripts/leave-out-cut.ts` took out the 73 an earlier import had stored
  (`leaveOutSentences` in `app/api/chongfuxi/corpus.ts`): each is kept in
  `chongfuxi_sentence_left_out` with its id and why, since review rows may
  name it; a sentence card never answered goes, one answered is retired
  with its answers kept. A sentence another deck has too, as the same
  characters, stays.

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
- `learn.ts` — Learn's drill: the next word, each step's sentence, what a
  pass or a miss does.
- `senses.ts` — which dictionary entry, and which of its senses, to show.
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
- `defs.ts` — `orderStoredDefs`: a word's tied dictionary entries ordered by
  its sentences.
- `learn.ts` — `wordsToLearn` (the words, where each is on the ladder, and
  their teaching sentences), `recordSteps`. Route `learn` (GET the words,
  `?list=`; POST the steps taken, owner).
- `spotify.ts` — songs as word lists: `addSong`, `moveSongLists`, `songListOf`, `songsOf`. Route `lists/spotify` (owner).
- Routes: `summary`, `session`, `sentences`, `sentence`, `blockers`, `levels`, `stats` (public); `review`,
  `meaning`, `note`, `names`, `settings`, `imports`, `imports/[id]/[idx]`,
  `imports/[id]/ingest`, `lookup`, `define` (owner).
- `next.config.ts` keeps `sql.js` external and traces its wasm and the
  dictionary into the ingest route.

Screens, in `components/`: `ChongfuxiApp` (shell), `ReviewPanel` (Today and
the session), `Learn` (the ladder: `useLadder` for the session, and a list's
drill), `CardsPanel` (`WordsPanel`, `SentencesPanel` with its sentence
page and `UnlockPanel`'s Unlock next page and blocker sheet, `ListsPanel`),
`LookupPanel` (Look up), `StatsPanel`, `SettingsPanel` (with `Algorithm`). `Sheet` in `shared.tsx` is the sheet over the
page (back, Escape, a tap outside close it). It has a grab handle and,
in dark mode, a lit top edge over a darker backdrop (`--cf-scrim`,
`--cf-sheet-edge`): the owner found the recap hard to tell from the page
behind it, the sheet and the page sharing a background.

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
- `order-defs.ts [--dry-run]` — order every word's tied dictionary entries
  by its sentences.
- `check-senses.ts` (no database) — which meaning is shown, on the cases
  the owner reported.
- `ingest-anki.ts <deck.apkg | collection.anki21> [--dry-run]` — add an Anki
  deck's sentences.
- `check-import.ts <file>` — read and sort a Pleco file, write nothing.
- `check-lookup.ts` (no database) — Look up's check, on a made-up answer.
- `bugs.ts [--all] [--close <id> <status> <note>]` — pull the bugs filed from
  the app into `.bugs/` (see Bug reports).
- `build-dict.ts <cedict.txt>` — rebuild `data/cedict.txt`.

A Pleco backup contains third-party sentence decks, and a card export contains
licensed dictionary content; never commit either. Sentences are served
read-only from the database.
