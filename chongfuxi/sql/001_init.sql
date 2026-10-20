-- 重复习 (chongfuxi) storage.
--
-- The corpus lives here as rows: the words being reviewed, the sentences, the
-- words each sentence is made of, and a card for everything on a schedule.
-- The browser draws what it is sent and reports answers; it builds nothing.
--
-- Two things are facts and are never rewritten: the Pleco files that were
-- imported (kept whole) and the review log (append-only). The rest follows
-- from them. A card's schedule is its seed plus its reviews replayed in order,
-- and which sentences are readable follows from the words and the tokens.
--
-- Single owner: every row carries owner_email and only the owner's session can
-- write (chongfuxi/lib/session.ts). Words, sentences and cards are readable by
-- anyone, as with 龙库 and jazz; the imported files are not served to visitors.
--
-- Every statement is idempotent; re-running the file is safe.

-- ------------------------------------------------------------- imports --

create table if not exists chongfuxi_import (
  owner_email text        not null,
  -- Made on the device, so the upload can be named before it starts.
  id          text        not null,
  at          timestamptz not null,
  file_name   text        not null,
  sha256      text,
  -- 'pqb' and 'xml' are the file as Pleco wrote it: a backup, or a card export.
  -- 'anki' is an Anki collection (the .anki21 inside an .apkg), sentences only.
  format      text        not null default 'pqb',
  -- 'gzip', or 'identity' from a browser without CompressionStream.
  encoding    text        not null default 'gzip',
  -- Size before compression.
  bytes       bigint      not null,
  chunks      integer     not null,
  -- True once every chunk has arrived.
  complete    boolean     not null default false,
  created     timestamptz not null default now(),
  primary key (owner_email, id)
);

-- What each Pleco category was taken to be when the file was turned into rows,
-- by category name, and when that happened. Null until it has been.
alter table chongfuxi_import add column if not exists settings jsonb;
alter table chongfuxi_import add column if not exists ingested timestamptz;

-- The file in pieces small enough for one request each.
create table if not exists chongfuxi_import_chunk (
  owner_email text    not null,
  import_id   text    not null,
  idx         integer not null,
  data        bytea   not null,
  primary key (owner_email, import_id, idx),
  foreign key (owner_email, import_id) references chongfuxi_import (owner_email, id) on delete cascade
);

-- --------------------------------------------------------------- words --

create table if not exists chongfuxi_word (
  owner_email text        not null,
  -- Simplified headword.
  word        text        not null,
  -- 'deck'   a word being reviewed here. Every one has a card, and these are
  --          the words that count as known.
  -- 'listed' in one of the Pleco word lists but not learnt yet: a candidate.
  -- 'name'   marked in the app as a name, so it stops blocking sentences.
  status      text        not null check (status in ('deck', 'listed', 'name')),
  -- Numbered pinyin, "@" between syllables, from the word's own card or the
  -- dictionary. Never from a sentence deck, where it is often wrong.
  pinyin      text,
  -- [{ "p": numbered pinyin, "senses": [...], "own": true when it is the
  -- definition typed into the Pleco card }]. Dictionary entries are CC-CEDICT.
  defs        jsonb       not null default '[]'::jsonb,
  -- Every sense, lower-cased, to find other words that mean the same.
  glosses     text[]      not null default '{}',
  -- What Pleco had for it: score, first, last, correct, incorrect, reviewed
  -- and the history string, verbatim. The seed its cards start from.
  pleco       jsonb,
  -- Times it has been read in a sentence here.
  exposures   integer     not null default 0,
  import_id   text,
  added       timestamptz not null default now(),
  primary key (owner_email, word)
);

-- The word lists it is on in Pleco, as paths: "HSK 3.0/Level 2". What the
-- HSK coverage on the Cards screen is counted from.
alter table chongfuxi_word add column if not exists lists text[] not null default '{}';

create index if not exists chongfuxi_word_status on chongfuxi_word (owner_email, status);
create index if not exists chongfuxi_word_glosses on chongfuxi_word using gin (glosses);

-- A meaning split off a word to be scheduled on its own, under the same word.
create table if not exists chongfuxi_meaning (
  owner_email text        not null,
  id          bigint      generated always as identity,
  word        text        not null,
  gloss       text        not null,
  created     timestamptz not null default now(),
  -- Set when it is merged back into the word.
  merged      timestamptz,
  primary key (owner_email, id),
  unique (owner_email, word, gloss)
);

-- ----------------------------------------------------------- sentences --

create table if not exists chongfuxi_sentence (
  owner_email text        not null,
  id          bigint      generated always as identity,
  -- Its Han characters only, simplified: what makes two cards one sentence.
  key         text        not null,
  -- As written, punctuation included.
  zh          text        not null,
  en          text,
  -- Where the word breaks came from: 'pleco' and 'pinyin' are the card's own
  -- pinyin (a Pleco card's, or another deck's tone-marked pinyin); 'dictionary'
  -- is longest-match against known words, when the pinyin didn't fit.
  split       text        not null,
  -- Decks it came from.
  sources     text[]      not null default '{}',
  -- Pleco's score for it, when it was studied there.
  pleco       jsonb,
  -- Derived: the words still standing between the owner and reading it. Empty
  -- means readable. Null means not worked out yet.
  blockers    text[],
  -- When it last became readable, and the word that did it (null for the ones
  -- readable from the first import).
  unlocked_at timestamptz,
  unlocked_by text,
  import_id   text,
  added       timestamptz not null default now(),
  primary key (owner_email, id),
  unique (owner_email, key)
);

alter table chongfuxi_sentence drop constraint if exists chongfuxi_sentence_split_check;
alter table chongfuxi_sentence add constraint chongfuxi_sentence_split_check check (split in ('pleco', 'pinyin', 'dictionary'));

create index if not exists chongfuxi_sentence_blockers on chongfuxi_sentence (owner_email, cardinality(blockers));

-- The words of each sentence, in order.
create table if not exists chongfuxi_token (
  owner_email text    not null,
  sentence_id bigint  not null,
  pos         integer not null,
  word        text    not null,
  primary key (owner_email, sentence_id, pos),
  foreign key (owner_email, sentence_id) references chongfuxi_sentence (owner_email, id) on delete cascade
);

create index if not exists chongfuxi_token_word on chongfuxi_token (owner_email, word, sentence_id);

-- --------------------------------------------------------------- cards --

create table if not exists chongfuxi_card (
  owner_email    text             not null,
  id             bigint           generated always as identity,
  -- 'read'     the word, to recognise
  -- 'produce'  the meaning, to recall the word
  -- 'sentence' a sentence, to read
  kind           text             not null check (kind in ('read', 'produce', 'sentence')),
  word           text,
  -- Set when the card is for one split-off meaning of the word.
  meaning_id     bigint,
  sentence_id    bigint,
  -- The schedule, as ts-fsrs keeps it. state: 0 new, 2 review.
  state          smallint         not null default 0,
  due            timestamptz      not null,
  stability      double precision not null default 0,
  difficulty     double precision not null default 0,
  reps           integer          not null default 0,
  lapses         integer          not null default 0,
  scheduled_days integer          not null default 0,
  last_review    timestamptz,
  -- Answers given here. Zero means the schedule is still the seed from Pleco.
  answered       integer          not null default 0,
  -- "Got it"s given here.
  passed         integer          not null default 0,
  -- Sentences: clean reads so far, the day of the last one, and when the card
  -- retired after enough of them.
  clean_reads    integer          not null default 0,
  last_clean_day date,
  retired        timestamptz,
  -- Not used by the app now: a card could once be flagged out of the queue.
  -- Kept because the queue still checks it.
  flagged        timestamptz,
  flag_note      text,
  -- Out of the queue because what it is about went away: a meaning merged
  -- back, a sentence no longer readable.
  suspended      boolean          not null default false,
  created        timestamptz      not null default now(),
  primary key (owner_email, id)
);

-- The owner's own note on the card, shown on its front every time it comes
-- up: what tells it apart from the one it gets confused with.
alter table chongfuxi_card add column if not exists note text;

create unique index if not exists chongfuxi_card_word
  on chongfuxi_card (owner_email, kind, word, (coalesce(meaning_id, 0)))
  where word is not null;

create unique index if not exists chongfuxi_card_sentence
  on chongfuxi_card (owner_email, sentence_id)
  where kind = 'sentence';

create index if not exists chongfuxi_card_due
  on chongfuxi_card (owner_email, due)
  where retired is null and flagged is null and not suspended;

-- ------------------------------------------------------------- reviews --

-- Every answer. Append-only: rows are never updated or deleted, and each
-- carries the card's schedule before and after, so any card's state can be
-- rebuilt from here.
create table if not exists chongfuxi_review (
  owner_email text        not null,
  -- Made on the device, so an answer sent twice is stored once.
  id          text        not null,
  -- Order of arrival.
  seq         bigint      generated always as identity,
  at          timestamptz not null,
  -- The study day it counted for (days turn over at 04:00 where the owner is).
  day         date        not null,
  session     text,
  card_id     bigint      not null,
  kind        text        not null,
  word        text,
  meaning_id  bigint,
  -- The sentence on screen: the card itself, or the context a word was shown in.
  sentence_id bigint,
  grade       text        not null check (grade in ('forgot', 'good')),
  -- Time to answer, and to reveal, in milliseconds.
  ms          integer,
  reveal_ms   integer,
  -- After forgetting a sentence: the words that were the trouble.
  tapped      text[]      not null default '{}',
  -- 'answer' is a card answered. 'tapped' is a word's card lapsing because the
  -- word was tapped in a forgotten sentence, and parent is that sentence's review.
  cause       text        not null default 'answer' check (cause in ('answer', 'tapped')),
  parent      text,
  -- Which scheduler and settings produced the result.
  scheduler   text        not null,
  before      jsonb       not null,
  after       jsonb       not null,
  -- What else the answer did, to other cards: the Produce card it opened, the
  -- retired sentences it brought back, the words it lapsed. With this a card's
  -- state can be rebuilt from the log even where another card's answer moved it.
  effects     jsonb       not null default '{}'::jsonb,
  received    timestamptz not null default now(),
  primary key (owner_email, id)
);

alter table chongfuxi_review add column if not exists effects jsonb not null default '{}'::jsonb;

-- Where and how the answer was given, for the stats: the device's timezone and
-- its offset from UTC in minutes (so an hour of the day can be worked out),
-- how far into the session the card came, and the kind of device.
alter table chongfuxi_review add column if not exists tz text;
alter table chongfuxi_review add column if not exists utc_offset integer;
alter table chongfuxi_review add column if not exists position integer;
alter table chongfuxi_review add column if not exists device text;

-- After a Forgot: the owner's own words on what went wrong, if any. Kept with
-- the answer so the mistakes can be read back together later.
alter table chongfuxi_review add column if not exists comment text;

create index if not exists chongfuxi_review_day on chongfuxi_review (owner_email, day, word);
create index if not exists chongfuxi_review_card on chongfuxi_review (owner_email, card_id, seq);

-- ------------------------------------------------------------ settings --

create table if not exists chongfuxi_settings (
  owner_email   text        primary key,
  -- Sentences introduced per study day.
  new_sentences integer     not null default 10,
  updated       timestamptz not null default now()
);

-- Anki: AnkiDroid syncs to /api/chongfuxi/anki/, which tells it the server is
-- empty, so every sync uploads the whole collection. Its notes are kept here
-- as they came (cards Pleco sent to AnkiDroid), the newest version winning,
-- and each sync is logged.
create table if not exists chongfuxi_anki_sync (
  id          bigint      generated always as identity primary key,
  owner_email text        not null,
  at          timestamptz not null default now(),
  client      text,
  bytes       integer     not null,
  notes       integer     not null default 0,
  added       integer     not null default 0,
  error       text
);

create table if not exists chongfuxi_anki_note (
  owner_email text        not null,
  -- Anki's note id: its creation time in ms.
  note_id     bigint      not null,
  guid        text        not null,
  notetype    text        not null,
  -- Field name to value, as Anki holds them (HTML and all).
  fields      jsonb       not null,
  tags        text        not null default '',
  modified    timestamptz not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (owner_email, note_id)
);

-- What became of each Anki note: the word read from it, and whether it was
-- added (in which addition), already known, unreadable, or added and undone.
alter table chongfuxi_anki_note add column if not exists word text;
alter table chongfuxi_anki_note add column if not exists handled_at timestamptz;
alter table chongfuxi_anki_note add column if not exists outcome text;
alter table chongfuxi_anki_note add column if not exists addition_id bigint;

-- A batch of words that joined the deck together (from an Anki sync), shown
-- to the owner once and undoable while none of its cards has been answered.
create table if not exists chongfuxi_addition (
  id          bigint      generated always as identity primary key,
  owner_email text        not null,
  at          timestamptz not null default now(),
  source      text        not null,
  -- Each word, and what it was before: null (not in the corpus), 'listed' or 'name'.
  words       jsonb       not null,
  -- The sentences these words made readable.
  unlocked    bigint[]    not null default '{}',
  seen_at     timestamptz,
  undone_at   timestamptz
);

create index if not exists chongfuxi_addition_owner on chongfuxi_addition (owner_email, at desc);

-- What each sync did to the corpus, filled in once its notes are processed:
-- the addition it made (if any), and its notes by outcome.
alter table chongfuxi_anki_sync add column if not exists addition_id bigint;
alter table chongfuxi_anki_sync add column if not exists words_added integer;
alter table chongfuxi_anki_sync add column if not exists known integer;
alter table chongfuxi_anki_sync add column if not exists unreadable integer;
alter table chongfuxi_anki_sync add column if not exists unlocked integer;

-- The sync whose processing handled the note: a sync's page lists its notes.
alter table chongfuxi_anki_note add column if not exists sync_id bigint;

-- When the owner saw the sync's page. Every new sync opens it once.
alter table chongfuxi_anki_sync add column if not exists seen_at timestamptz;

-- A bug the owner filed from the app: what they wrote, a screenshot of the
-- screen it was filed from (base64 JPEG), and what the app knew then (the
-- screen, the card, recent errors). Read by Claude sessions through
-- scripts/bugs.ts. Also created on first use (app/api/chongfuxi/bugs.ts).
create table if not exists chongfuxi_bug (
  id          bigint      generated always as identity primary key,
  owner_email text        not null,
  at          timestamptz not null default now(),
  text        text        not null,
  context     jsonb       not null default '{}',
  image       text,
  image_type  text,
  -- 'open', 'fixed' or 'wontfix', and a line on what was done.
  status      text        not null default 'open',
  note        text,
  closed_at   timestamptz
);

create index if not exists chongfuxi_bug_owner on chongfuxi_bug (owner_email, status, at desc);

-- Learn: a new word is drilled with sentences before it joins the review.
-- A Read card never answered and not yet through Learn waits for it
-- (learned_at null); Learn sets learned_at and makes it due the next study
-- day, still new: nothing Learn does counts as an answer.
alter table chongfuxi_card add column if not exists learned_at timestamptz;

-- What happened in Learn, a row per word: each step with its sentence and
-- how it went. Read back later; never touches a schedule.
create table if not exists chongfuxi_learn (
  id          bigint      generated always as identity primary key,
  owner_email text        not null,
  at          timestamptz not null default now(),
  day         date        not null,
  session     text        not null,
  card_id     bigint      not null,
  word        text        not null,
  misses      integer     not null default 0,
  steps       jsonb       not null default '[]'
);

create index if not exists chongfuxi_learn_owner on chongfuxi_learn (owner_email, at desc);

-- A word's Learn row is written once per session, however often it is sent.
create unique index if not exists chongfuxi_learn_once on chongfuxi_learn (owner_email, session, card_id);

-- Sentences taken out of the corpus, kept here as they were (same id), with
-- why: a review row or the Learn log may still name one. Cut-short cards
-- (lib/corpus.ts, cutShort) are the first; a re-import leaves them out too.
create table if not exists chongfuxi_sentence_left_out (
  owner_email text        not null,
  id          bigint      not null,
  key         text        not null,
  zh          text        not null,
  en          text,
  sources     text[]      not null default '{}',
  reason      text        not null,
  at          timestamptz not null default now(),
  primary key (owner_email, id)
);

-- Where a new word is on Learn's ladder (the next step: meet, context, cloze,
-- word); null before it is met. Saved as each step is taken, so leaving a
-- session loses nothing, and the ladder carries on in the next one.
alter table chongfuxi_card add column if not exists learn_step text;

-- A text analysed against the corpus (Import › Analyse a text): pasted, from
-- a web page, or a YouTube video's captions. Only the text is kept; the
-- analysis is worked out again each time it is opened, against what is known
-- then. `saved_as` is the source name its sentences were added under, if
-- they were.
create table if not exists chongfuxi_text (
  id          bigint      generated always as identity primary key,
  owner_email text        not null,
  at          timestamptz not null default now(),
  kind        text        not null,
  title       text,
  url         text,
  text        text        not null,
  saved_as    text
);

create index if not exists chongfuxi_text_owner on chongfuxi_text (owner_email, at desc);

-- ------------------------------------------------------------- look up --

-- Look up's answers (app/api/chongfuxi/lookup.ts), one per question as typed
-- (lower case, single spaces): a cache, since each costs model calls, and
-- with the owner's verdict the test set that decides what is built next.
-- Also made on first use.
create table if not exists chongfuxi_lookup (
  owner_email text        not null,
  query       text        not null,
  at          timestamptz not null default now(),
  model       text        not null,
  kind        text,
  answer      jsonb       not null,
  verdict     text,
  note        text,
  primary key (owner_email, query)
);

-- --------------------------------------------------------------- songs --

-- Songs added from a Spotify link (app/api/chongfuxi/spotify.ts): the list
-- their words are filed under ("Spotify/<title>"), and what Spotify calls
-- them. The lyrics aren't kept, only the words. Also made on first use.
create table if not exists chongfuxi_song (
  owner_email text        not null,
  list        text        not null,
  track_id    text,
  url         text,
  title       text        not null,
  artist      text,
  lyrics_from text        not null,
  words       integer     not null,
  added       timestamptz not null default now(),
  primary key (owner_email, list)
);

-- A lookup asked from a card (Look up's sheet over a review or Learn card):
-- which card, word, sentence and session or Learn step, each time it is
-- asked, for reading back what had to be looked up while studying a word.
-- Also made on first use (app/api/chongfuxi/lookup.ts).
create table if not exists chongfuxi_lookup_card (
  owner_email text        not null,
  query       text        not null,
  at          timestamptz not null default now(),
  card_id     bigint      not null,
  word        text,
  kind        text        not null,
  via         text        not null,
  sentence_id bigint,
  session     text,
  step        text
);
create index if not exists chongfuxi_lookup_card_card on chongfuxi_lookup_card (owner_email, card_id);
