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
  owner's only), Stats, Import.
  The header holds the title and one quiet line (`Glance` in
  `ChongfuxiApp.tsx`): words in the deck, distinct characters across them,
  and the share of sentences readable, each with its Chinese unit (词 字 句) in
  its kind's colour. Figures only: the owner doesn't want progress bars there,
  and found boxed counts and then badges with a bar and key too busy. (Words
  is one per deck word; the old boxes counted word cards, Read plus Recall,
  which is why the figure went from about 4k to 3k.) Signing in sits at the
  right of the title (`components/Account.tsx`): the owner's 笨鸡 (Benji) opens a
  menu with the address and Sign out; anyone else gets Sign in.
- Import is a menu (`components/ImportPanel.tsx`), since stacked as one
  page it had grown messy: a row per page, title and one line under it, each
  opening the page with "‹ Import" above to come back. Analyse a text, Pleco
  backup and Texts (owner only), Anki syncs, Bug reports (the open count on
  its row). About, with the CC-CEDICT credit, sits under the menu. Today's
  "Import a Pleco backup" opens the Pleco backup page directly. The owner
  tried the pages as sides like Cards' and didn't want tabs here.
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
  opened from Import's menu, Unlock next, each level of
  the list tree, a word's sheet, a sentence's page, a sync's page, a review session, the step
  after Forgot, the note box) puts one history entry on, and back closes the
  top one. A layer closed from the page takes its entry back off quietly.
  From Review with nothing open, back leaves the site.
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
  (a modern regular script, the one exception to the sans: only 复卡查统入 are
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
(the Produce card) and Sentence cards, meaning splits, card notes, new
sentences with no daily limit, learn-next, the sentence browser and stats.

Review opens on Today: what is due by kind of card, with the Recall and
Sentences rows doubling as the choice to leave them out (remembered on the
device), then Start. The choices only filter
the queue; nothing about the schedule changes. Above them, the days either
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
  the evidence as tools the model picks from, the answer in a fixed shape
  (`ANSWER_SCHEMA`, structured output). Kept in `chongfuxi_lookup` (made on
  first use): a cache, and with the owner's Right / Wrong and note, the test
  set. Route `lookup` (owner only: GET the history, POST `{ q, fresh? }`,
  `{ q, verdict, note }`, or `{ q, add: word }`).
- `app/api/chongfuxi/lookup-check.ts`: the check. Pinyin from our readings;
  an option must be a headword, a pattern of headwords, or split into at
  least one real word (nearly every character is a headword, so two lone
  ones don't count); a cited count must be one a tool returned for that word,
  a pair with it, or part of it (得 for 得了); an example must be a sentence a
  tool returned. Anything else is shown as the model's own or dropped, and
  listed under "What the check changed". `scripts/check-lookup.ts` tests it
  without a database or model.
- `components/LookupPanel.tsx`: the question (one rounded field with a
  small round arrow inside it, grey until something is typed, a spinner
  while it looks: the owner found a plain "Look up" button clumsy). The
  answer is laid out as a dictionary entry, the owner's pick of three
  layouts (mockup: https://claude.ai/artifact/4e5GTiQ9V7yNpKfZ5epxmJ; the
  first version, every point and source spelled out, was too much to read,
  and the barest layout too little). Nothing on it says what the answer is:
  the owner wants it read off the page, not explained ("Say 得了, or 患上 in
  writing. Not 发展." was taken out; the model still writes `gist`, unused).
  For a gap, the phrase comes first with the best word in it, in green, and
  every candidate under it as a chip: fitting ones solid with their tag
  ("spoken", "written"), near misses struck through in red; a tap puts one
  in the gap, and a near miss's reason shows under the chips (so they don't
  move). The hint under the field shows only before an answer. Then each
  word that fits as a numbered sense: when it's the one (`label`), the
  word, pinyin, its dictionary meaning, why, how many of the owner's
  sentences have it, one example with its translation, and "Why, and more
  examples" for the points with their sources and the rest. Close, but no:
  struck through, why, a wrong and a right sentence. Sentences the model
  wrote, labelled; Right? ✓ ✗ (a note when wrong); how the question was read,
  the model's summary and what the check changed folded away at the foot.
- **The deck, from the answer**: every word says where it stands, looked up
  each time the answer is shown (cached or not, `withDeck`): "✓ In deck ·
  strong" (its Read card's stage, as on the Words wall), or + Add for a
  dictionary word not in the deck (on a Pleco list or not). Add puts it in as
  one addition, source `lookup:<question>` (`addFromLookup`, through
  `addWords`), and turns into "✓ Added · Undo" (the additions route undoes
  it). At the owner's request.
- Owner only, at the owner's insistence (it spends their tokens): the route
  goes through `ownerOnly`, so signed out (or a forged cookie) it answers 401
  and signed in as anyone else 403, before any model call; the tab is hidden
  from everyone but the owner too.
- Config: `CHONGFUXI_LOOKUP_MODEL` (default `claude-haiku-5-5`, the
  owner's choice; see The model below),
  `CHONGFUXI_LOOKUP_EFFORT` (default `medium`), and
  `CHONGFUXI_ANTHROPIC_API_KEY` or the site's `ANTHROPIC_API_KEY`. The
  answer's check list ends with its estimated cost. On Claude models that
  offer it, a refusal falls back server-side (`fallbacks: "default"`).
- Not yet exercised against the real database or a real model: the session
  that built it had neither. Run a few lookups first and read "What the check
  changed".

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
- **The test set.** Over about a month the owner is collecting what they'd
  type, each with the situation (the sentence meant) and what was used in
  the end, ideally tagged with a kind from the table. Every entry gets run
  through the design and marked: right part in question, right meaning,
  right word. The misses decide what is built first.

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
  compounds, so tokens alone can't say). Back: pinyin, every
  definition, the translation. A word with no saved pinyin shows its
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
  and fills the gap from its meaning. A word comes back after others, the
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

Import › Analyse a text (`components/TextAnalyser.tsx`, route `analyse`,
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
sentences from Import › Texts (`components/TextImport.tsx`,
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
  log on Import › Anki syncs, where every sync's page opens. Two or more such
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

Each list also shows how many of its words are due today (words with a Read
or Recall card a session would deal: due before the day ends, not answered
yet today), and a list with any has Review (the count beneath, beside Learn
and its new words: one line, at the owner's request): a session of only that
list's word cards, Read and Recall whatever Today's choices, no sentences
(`list` on `session`; `onList` in `app/api/chongfuxi/review.ts`, 龙库 by
`longku_bank`). It takes the whole screen like any session and closes back
onto the same list. It isn't kept to carry on from, so it never replaces the
day's own session; its answers go through the outbox as any others.

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
(made on first use), listed on Import › Bug reports with Mark fixed / Won't fix.

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
- Routes: `summary`, `session`, `sentences`, `sentence`, `blockers`, `levels`, `stats` (public); `review`,
  `meaning`, `note`, `names`, `settings`, `imports`, `imports/[id]/[idx]`,
  `imports/[id]/ingest`, `lookup` (owner).
- `next.config.ts` keeps `sql.js` external and traces its wasm and the
  dictionary into the ingest route.

Screens, in `components/`: `ChongfuxiApp` (shell), `ReviewPanel` (Today and
the session), `Learn` (the ladder: `useLadder` for the session, and a list's
drill), `CardsPanel` (`WordsPanel`, `SentencesPanel` with its sentence
page and `UnlockPanel`'s Unlock next page and blocker sheet, `ListsPanel`),
`LookupPanel` (Look up), `StatsPanel`, `ImportPanel`. `Sheet` in `shared.tsx` is the sheet over the
page (back, Escape, a tap outside close it).

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
