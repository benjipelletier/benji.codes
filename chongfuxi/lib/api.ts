// What /api/chongfuxi sends and takes, shared by the routes and the screens.

import type { Definition } from "./dict";
import type { CardKind, Grade } from "./schedule";

export interface Viewer {
  /** The deployment has a database and an owner. */
  configured: boolean;
  /** Signed in as the owner. Everyone else reads and changes nothing. */
  isOwner: boolean;
  email: string | null;
}

export interface Summary {
  viewer: Viewer;
  /** Words in the deck: the ones with cards, which are the ones that count as known. */
  words: number;
  /** Distinct Chinese characters across the deck's words. */
  characters: number;
  /** Cards about words: a Read card for each, and a Recall card for those that have opened one. */
  wordCards: number;
  recallCards: number;
  names: number;
  sentences: number;
  /** Unlocked sentences. Each has a sentence card. */
  readable: number;
  /** Locked sentences one word short, and those further off. Together: every locked sentence. */
  oneAway: number;
  locked: number;
  /** Words with a card due before the study day ends, not counting a word already seen today. */
  dueWords: number;
  /** The same, by kind of card. A word with both due is in both, and shown once. */
  dueRead: number;
  dueRecall: number;
  dueSentences: number;
  /** Readable sentences not yet seen here: the pool new sentences come from, with no daily limit. */
  newSentences: number;
  retired: number;
  flagged: number;
  answeredToday: number;
  /** Answers given on the study day before this one. */
  answeredYesterday: number;
  /** Cards whose due date fell inside today, as opposed to being carried over from before. */
  cameDueToday: number;
  /**
   * Cards that join the queue tomorrow: those falling due then, and those held
   * back today because another card of the same word was answered.
   */
  dueTomorrow: number;
  /** New words waiting for Learn before they join the review. */
  toLearn: number;
}

export interface WordInfo {
  word: string;
  /** Numbered pinyin, "@" between syllables; null when nothing reliable is known. */
  pinyin: string | null;
  defs: Definition[];
  /** Meanings split off to be scheduled on their own. */
  split: Array<{ id: number; gloss: string }>;
  /** Its HSK levels, old and 3.0 ("5", "7-9"); null where it isn't in that one. */
  hsk: { old: string | null; v3: string | null };
  /** It is one of the chengyu 龙库 plays (app/api/chongfuxi/longku.ts). */
  longku: boolean;
}

export interface SentenceInfo {
  id: number;
  zh: string;
  en: string | null;
  /** Its words in order. */
  words: string[];
  /**
   * Each word's reading (numbered, "@" between syllables) and a short
   * meaning, for when it is tapped; null where there is none
   * (lib/readings.ts). Sent with a review card's sentence only.
   */
  looks?: Array<{ p: string; gloss: string | null } | null>;
  /** The decks it came from. */
  sources: string[];
}

/** How a word in an analysed text stands: read with ease, still being learnt, or not known. */
export type WordStanding = "known" | "learning" | "unknown";

/** A piece of an analysed sentence: a word (with how it stands), or what lies between words. */
export interface TextToken {
  t: string;
  /** Set on a word. */
  k?: WordStanding;
}

/** A word in an analysed text not known yet, and what learning it would do for the text. */
export interface TextUnknown {
  word: string;
  pinyin: string | null;
  gloss: string | null;
  hsk: WordInfo["hsk"];
  /** Times it stands in the way in the text. */
  count: number;
  /** Sentences it is the only thing missing from. */
  unlocks: number;
  /** In a Pleco word list (not learnt); else only in the dictionary, or neither. */
  listed: boolean;
  /** A dictionary headword or a word with a row: something the deck can take. */
  addable: boolean;
}

/** A text analysed against the corpus (app/api/chongfuxi/analyse.ts). */
export interface TextAnalysis {
  /** In the history, when kept (the owner's); null for a visitor's. */
  id: number | null;
  kind: "paste" | "web" | "youtube";
  title: string | null;
  url: string | null;
  at: number;
  /** The source name its sentences were added under, if they were. */
  savedAs: string | null;
  /** Word occurrences (Han words), and distinct words; how many of each are known. */
  words: { total: number; known: number; unique: number; uniqueKnown: number; learning: number };
  sentences: { total: number; readable: number; oneAway: number };
  /** The text in order: paragraphs of sentences of tokens. */
  paragraphs: TextToken[][][];
  /** Most useful first: how often it stands in the way, and what it alone would unlock. */
  unknown: TextUnknown[];
  /** Distinct words by HSK 3.0 level ("1" … "7-9", "none"), and how many are known. */
  hsk: Array<{ level: string; words: number; known: number }>;
  /** Each word's reading and short meaning, for a tap. */
  looks: Record<string, { p: string; gloss: string | null } | null>;
}

/** A text in the history. */
export interface TextListed {
  id: number;
  kind: TextAnalysis["kind"];
  title: string | null;
  url: string | null;
  at: number;
  chars: number;
  savedAs: string | null;
}

/** One day on Today's strip: cards reviewed (before today) or falling due (after), by kind; Learn steps taken. */
export interface DayBar {
  /** The study day, YYYY-MM-DD. */
  day: string;
  read: number;
  recall: number;
  sentence: number;
  learn: number;
}

/** The days either side of today (app/api/chongfuxi/days.ts). */
export interface Days {
  /** Reviewed, oldest first, ending yesterday. */
  past: DayBar[];
  /** Reviewed so far today. */
  today: DayBar;
  /** Falling due, from tomorrow. */
  ahead: DayBar[];
  /** Days in a row with an answer, today counted once it has one. */
  streak: number;
  /** Cards answered a day, over the last seven. */
  weekAverage: number;
}

/** A new word to learn, with the sentences that teach it (app/api/chongfuxi/learn.ts). */
export interface LearnWord {
  /** Its Read card. */
  card: number;
  word: string;
  /** Where it is on the ladder: the next step to take; null before it is met. */
  step: LearnStep | null;
  pinyin: string | null;
  /** The first few senses of its main definition. */
  senses: string[];
  hsk: WordInfo["hsk"];
  longku: boolean;
  /** Sentences to teach it with, best first. */
  sentences: LearnSentence[];
}

export interface LearnSentence extends SentenceInfo {
  /** With the word blanked, where a gap doesn't give it away: for the cloze. */
  blanked: string | null;
  /** The one word in it not known yet, shown with its meaning; null when every word is known. */
  unknown: string | null;
}

/** The steps of Learn, in order: meet the word, read it in context, fill the gap, the word alone. */
export type LearnStep = "meet" | "context" | "cloze" | "word";

/** A step taken in Learn: saved as it is taken, never counted as an answer. */
export interface LearnStepDone {
  /** Made on the device: a step sent twice is logged once. */
  id: string;
  card: number;
  word: string;
  step: LearnStep;
  sentence: number | null;
  /** "known": the owner already knows it, and took it off the ladder (Learn's 会 tile). */
  grade: Grade | "seen" | "known";
  /** The step it goes on to; null when this one learned it. */
  next: LearnStep | null;
}

/** How a card has gone so far: in Pleco before it came here, then here. Oldest first. */
export interface CardHistory {
  /** Pleco's own record, which has the order of the answers but not their dates. */
  pleco: Grade[];
  here: Grade[];
  /** When it was last answered, in ms, and where. Null if never. */
  lastAt: number | null;
  lastIn: "pleco" | "here" | null;
}

export interface SessionCard {
  id: number;
  kind: CardKind;
  history: CardHistory;
  /** The owner's note on this card, shown on its front. */
  note: string | null;
  /** Word cards. */
  word?: WordInfo;
  /** When the card is for one split-off meaning rather than the word as a whole. */
  meaning?: { id: number; gloss: string } | null;
  /** The sentence itself, or the one a word is shown in; null when there is none to show. */
  sentence: SentenceInfo | null;
  /** Produce: other deck words with the same meaning, to grade yourself fairly. */
  alternatives?: string[];
  /** Days until it would come back for each answer. */
  intervals: Record<Grade, number>;
  /** Never answered here or in Pleco. */
  isNew: boolean;
  /** Sentences: clean reads so far, and whether a clean read now would retire it. */
  cleanReads?: number;
  wouldRetire?: boolean;
  /** Why the queue dealt it, for Settings › Algorithm. */
  why?: QueueWhy;
}

/** Settings › Algorithm: the queue's output right now. */
export interface QueueNow {
  /** The cards a session started now would deal first, in order, each with why. */
  next: SessionCard[];
  /** Word cards due today held back because another card of the same word was answered today. */
  heldBack: number;
  /** Due word cards by the odds they'd be remembered now: the line they wait in, weakest first. */
  odds: Array<{ label: string; count: number }>;
}

/** Which of the queue's three lines a card came from, and what put it where it was in that line. */
export type QueueWhy =
  /** A due word card: the odds it would be remembered now (null: never answered), lowest first. */
  | { line: "word"; odds: number | null; overdueDays: number }
  /** A due sentence card: oldest due first. */
  | { line: "sentence"; overdueDays: number; cleanReads: number }
  /**
   * A new sentence: one a word just unlocked, else the one for the deck word
   * that most needs it ("due" today or just forgotten, else "weak", "learn"
   * still waiting for Learn).
   */
  | { line: "new"; unlockedBy: string | null; forWord: string | null; need: "due" | "weak" | "learn" | null };

/** One deck word on the Words wall: just enough to place it, colour it and find it. */
export interface WordTile {
  word: string;
  /** Numbered pinyin, "@" between syllables. */
  pinyin: string | null;
  /** The first sense, cut short, for finding a word by meaning. */
  gloss: string | null;
  /** Its Read card: FSRS stability in days, when it is due (ms), answers and Forgots here, difficulty. */
  stability: number;
  due: number;
  answered: number;
  forgotHere: number;
  difficulty: number;
  /** Its Recall card has opened. */
  recall: boolean;
  hsk: { old: string | null; v3: string | null };
  /** In 龙库. */
  longku: boolean;
  /** Suspended: still in the deck, its cards kept but not dealt, its sentences locked (app/api/chongfuxi/suspended.ts). */
  suspended: boolean;
}

/** Everything about one word, for its sheet on the Words page. */
export interface WordDetail {
  word: string;
  pinyin: string | null;
  defs: Definition[];
  hsk: { old: string | null; v3: string | null };
  /** In 龙库. */
  longku: boolean;
  /** Suspended: its cards kept but not dealt, its sentences locked, until brought back. */
  suspended: boolean;
  /** Its cards: Read, Recall, and any split-off meanings. */
  cards: Array<{
    kind: CardKind;
    meaning: string | null;
    note: string | null;
    isNew: boolean;
    due: number;
    stability: number;
    difficulty: number;
    /** The odds it would be remembered now, 0 to 1; null if never answered. */
    odds: number | null;
    /** Answers here, and how many of them were Forgot (Pleco's misses aren't counted). */
    answered: number;
    forgotHere: number;
    history: CardHistory;
  }>;
  /** Pleco's record of the word, from before it came here. */
  pleco: { score: number; correct: number; incorrect: number; first: number | null; last: number | null } | null;
  /** Times it has been read in a sentence here. */
  exposures: number;
  sentences: {
    readable: number;
    oneAway: number;
    locked: number;
    /** The best few readable ones, as a word card would choose them. */
    best: SentenceInfo[];
  };
}

/** A sentence a word is in, on its page: where it stands and what its card has done. */
export interface WordPageSentence extends SentenceInfo {
  status: "readable" | "oneAway" | "locked";
  /** The words keeping it locked. */
  blockers: string[];
  /** Its sentence card, once it has one. */
  card: { answered: number; cleanReads: number; retired: boolean } | null;
}

/**
 * A word's page: everything about how it lives in the owner's corpus, on top
 * of its sheet (WordDetail): every answer for the chart, every sentence it is
 * in, where it tripped a sentence, what was looked up about it, how it came
 * in, its Learn steps, and the words around it.
 */
export interface WordPage extends WordDetail {
  /** In the deck, on a list only (a candidate), or a name; the page offers to add any but a deck word. */
  status: "deck" | "listed" | "name";
  lists: string[];
  /** How it came into the deck: each addition that brought it (a sync, a list, Look up, 龙库). */
  origin: Array<{ source: string; at: number; undone: boolean }>;
  /** Every answer on its word cards, oldest first: the chart's points. */
  answers: Array<{ kind: CardKind; meaning: string | null; at: number; grade: Grade }>;
  /** What was written after a Forgot on its cards ("what tripped you up?"). */
  notes: Array<{ kind: CardKind; at: number; comment: string }>;
  /** Its sentences, a panel at a time: the first panel with any, and its first rows; more with `word/page?status=&sentences=<offset>`. */
  sentencesAll: { total: number; status: WordPageSentence["status"]; rows: WordPageSentence[] };
  /** Sentence cards forgotten with this word tapped as the trouble. */
  tripped: Array<{ id: number; zh: string; en: string | null; at: number; comment: string | null }>;
  /** Lookups about it: asked from its cards, or naming it. */
  lookups: Array<{ query: string; kind: string | null; at: number; via: "review" | "learn" | null; step: string | null; verdict: string | null }>;
  /** Its Learn: when it was through, and each session's steps and misses. */
  learn: { learnedAt: number | null; sessions: Array<{ at: number; steps: number; misses: number; known: boolean }> };
  /** Sentences that became readable when it joined, and those it alone keeps locked. */
  unlocked: { count: number; examples: Array<{ zh: string; en: string | null }> };
  holdsBack: number;
  /** Deck words with it inside (老师 for 师), and deck words sharing a meaning. */
  compounds: string[];
  sameMeaning: string[];
}

/** A batch of words that joined the deck together, as the new-words screen shows it. */
export interface Addition {
  id: number;
  at: number;
  /** Where they came from: "anki". */
  source: string;
  seen: boolean;
  undone: boolean;
  words: Array<{
    word: string;
    pinyin: string | null;
    gloss: string | null;
    hsk: { old: string | null; v3: string | null };
    /** In 龙库. */
    longku: boolean;
    /** What it was before: not in the corpus, on a list, or a name. */
    was: "listed" | "name" | null;
    /** Readable sentences it is in, now. */
    readable: number;
  }>;
  /** Sentences these words made readable, and a few of them. */
  unlocked: number;
  examples: Array<{ zh: string; en: string | null; by: string | null }>;
  /** Words in the deck now. */
  deck: number;
  /** Words whose cards have been answered since: while there are any, it can't be undone. */
  answered: string[];
}

/** One Anki sync, for the log on the Import page: what came, and what it did to the corpus. */
export interface AnkiSync {
  id: number;
  at: number;
  /** The client's own version string: "26.05,e64c6b1a,android". */
  client: string | null;
  bytes: number;
  /** Notes in the collection, and how many the server hadn't had before. */
  notes: number;
  newNotes: number;
  error: string | null;
  /** The addition it made, if it brought words not in the deck; whether that was undone. */
  additionId: number | null;
  undone: boolean;
  /** Its new notes have been turned into words (just after the sync). */
  processed: boolean;
  wordsAdded: number;
  known: number;
  unreadable: number;
  unlocked: number;
  /** The owner has seen its page; a new sync's page opens by itself once. */
  seen: boolean;
}

/** One sync in full, for its page: the sync, each note it handled, and the addition it made. */
export interface AnkiSyncDetail {
  sync: AnkiSync;
  /** Notes this sync's processing looked at, with what became of each. */
  notes: Array<{ word: string | null; outcome: "added" | "known" | "unreadable" | "undone" | "removed"; text: string }>;
  addition: Addition | null;
}

/** A Read card as Fast review shows it: the word alone, and what each answer would do. */
export interface FastCard {
  id: number;
  word: string;
  pinyin: string | null;
  /** The first sense or two, to show once it is marked forgotten. */
  gloss: string | null;
  /** Days it would wait after each answer, and has been waiting; null for a new card. */
  intervals: Record<Grade, number>;
  was: number | null;
  /** Got it would open its Recall card. */
  opensRecall: boolean;
}

export interface ReviewInput {
  /** Made on the device; sending it twice records it once. */
  id: string;
  cardId: number;
  grade: Grade;
  at: number;
  day: string;
  cutoff: number;
  session: string;
  ms?: number;
  revealMs?: number;
  /** The sentence that was on screen. */
  sentenceId?: number | null;
  /** After forgetting a sentence: the words that were the trouble. */
  tapped?: string[];
  /** After a Forgot: what went wrong, in the owner's words. */
  comment?: string;
  /** For the stats: the device's timezone, its offset from UTC in minutes, and what kind of device. */
  tz?: string;
  utcOffset?: number;
  device?: string;
  /** How far into the session the card came, from 1. */
  position?: number;
  /**
   * When it was sent, by the device's clock, set as it leaves. With `at` it
   * says how long the answer waited on the device (offline, say), whatever
   * that clock is set to.
   */
  sentAt?: number;
}

/** What a session takes in. All on is everything due. */
export interface SessionKinds {
  /** Read cards: the word, to recognise. */
  read: boolean;
  /** Recall cards: the meaning, to produce the word. */
  recall: boolean;
  /** Sentence cards, new ones included. */
  sentences: boolean;
  /** New words' Learn steps, one every fifth card. */
  learn: boolean;
}

export interface DayStats {
  /** YYYY-MM-DD, the study day. */
  day: string;
  good: number;
  forgot: number;
  /** Time spent answering, in ms. */
  ms: number;
  words: number;
  sentences: number;
}

export interface Maturity {
  /** Never answered anywhere. */
  fresh: number;
  /** Stability under three weeks. */
  young: number;
  mature: number;
  /** Sentences only: done with. */
  retired: number;
}

export interface Stats {
  /** Study days with reviews, oldest first, a year back. */
  days: DayStats[];
  /** Every study day that had a review, ever, for streaks. */
  studied: string[];
  totalReviews: number;
  /** Cards coming due on each of the next days: index 0 is tomorrow. */
  forecast: Array<{ words: number; sentences: number }>;
  /** Due now, overdue included. */
  dueNow: { words: number; sentences: number };
  retention: Array<{ kind: CardKind; recent: { good: number; total: number }; all: { good: number; total: number } }>;
  maturity: Record<CardKind, Maturity>;
  /** Word cards by how long they would be remembered: upper bounds in days, and how many fall under each. */
  stability: Array<{ upTo: number | null; label: string; cards: number }>;
  /** Answers by local hour of the day, 0 to 23. */
  hours: Array<{ hour: number; good: number; total: number }>;
  /** Words forgotten most here. */
  hardest: Array<{ word: string; forgot: number; total: number }>;
  /**
   * What is known of the reviewing done in Pleco. Pleco keeps only the first
   * and last date each card was reviewed, so a day's count is the cards first
   * or last reviewed that day: a floor, not the true number.
   */
  pleco: { days: Array<{ day: string; n: number }>; reviews: number; cards: number };
}

export interface ReviewResult {
  /** It had already been recorded; nothing changed this time. */
  duplicate: boolean;
  /** Days until the card comes back; null if it retired. */
  days: number | null;
  retired: boolean;
  /** A Produce card for the word now exists. */
  produceOpened: boolean;
  /** Words whose cards lapsed because they were tapped. */
  lapsed: string[];
  /** Retired sentences brought back. */
  revived: number;
  /** The rest is the receipt: the same changes, in enough detail to read back. */
  /** Days the card had been set to wait before this answer; null for a new card. */
  was: number | null;
  /** The odds it would be remembered, 0 to 1, at the moment it was answered; null for a new card. */
  odds: number | null;
  /** FSRS difficulty, 1 easy to 10 hard, before (null for a new card) and after. */
  difficulty: { before: number | null; after: number };
  /** A sentence card's clean reads before and after, and how many retire it. */
  cleanReads: { before: number; now: number; need: number } | null;
  /** Deck words counted as read in a sentence once more, and those for which it was the first time. */
  exposed: string[];
  firstSeen: string[];
  /** Each lapsed word's card: what it had been set to, and when it is back. */
  lapses: Array<{ word: string; was: number | null; days: number }>;
  /** The sentences brought back, as written. */
  revivedSentences: string[];
  /** If a Recall card opened: days until it is due, 0 for at once. */
  recallIn: number | null;
}

export interface SentenceRow {
  id: number;
  zh: string;
  en: string | null;
  blockers: string[];
  sources: string[];
  /** Split by dictionary because the deck's pinyin didn't fit. */
  dictionarySplit: boolean;
  /** Where its card stands, if it has one. */
  card: "new" | "reading" | "retired" | null;
}

/** One sentence in full, for its page on Cards › Sentences. */
export interface SentenceDetail {
  /** Its words, with each one's reading and meaning for a tap. */
  sentence: SentenceInfo;
  /** The words still keeping it locked; none when it is readable. */
  blockers: string[];
  dictionarySplit: boolean;
  /** For each of its words, in order: how it stands, and whether it is a deck word (with a sheet of its own). */
  words: Array<{ standing: WordStanding; inDeck: boolean }>;
  /** Its sentence card, once it has one. */
  card: { state: "new" | "reading" | "retired"; history: CardHistory } | null;
}

/** How much of one level of a word list is in the deck. */
export interface LevelCoverage {
  /** The list as Pleco files it: "HSK 3.0/Level 2". */
  list: string;
  /** "Level 2". */
  name: string;
  total: number;
  inDeck: number;
  /**
   * The words in the deck, by where their Read card stands. Waiting: not yet
   * answered here, so still on Pleco's word. Then, once answered here, by how
   * long the card would be remembered: young under three weeks, mature under
   * six months, strong beyond.
   */
  waiting: number;
  young: number;
  mature: number;
  strong: number;
}

export interface Coverage {
  /** One group per HSK scheme, its levels in order. */
  groups: Array<{ label: string; note: string; levels: LevelCoverage[] }>;
  /** Words in the deck, and how many of them are on none of these lists. */
  deck: number;
  unlisted: number;
}

/** A Pleco word list, or a category above lists ("HSK标准教程/HSK标准教程5"): its words counted once each. */
export interface ListNode {
  /** The path, "/" between category names. */
  list: string;
  total: number;
  inDeck: number;
  /** Its words a session would deal today (one card a word). */
  due: number;
  /** Its new words waiting for Learn. */
  toLearn: number;
  /** A list another app keeps: "龙库" is the chengyu 龙库 plays, linked both ways. */
  linked?: "longku";
  /** A list made from the owner's own content ("Spotify" and its songs), not a study list. */
  source?: "spotify";
  /** A song's: what Spotify calls it, who sings it, and its link (none for songs Pleco brought). */
  song?: { title: string; artist: string | null; url: string | null };
}

/**
 * Where a lookup was asked from, when it was a card (查 on a review card or a
 * new word's Learn card): kept beside the question, so what the owner had to
 * look up while studying a word can be read back later, by a model judging
 * how well the word is known among others.
 */
export interface LookupFrom {
  card: number;
  word: string | null;
  kind: "read" | "produce" | "sentence";
  via: "review" | "learn";
  /** The sentence on the card. */
  sentence: number | null;
  /** The review session, or Learn's step. */
  session: string | null;
  step: string | null;
}

/** A word on a list, in the deck or not. */
export interface ListWord {
  word: string;
  pinyin: string | null;
  gloss: string | null;
  inDeck: boolean;
}

/** A source of sentences (a deck, a book's lessons) and where its sentences stand. */
export interface SourceCounts {
  source: string;
  readable: number;
  oneAway: number;
  locked: number;
}

/** A word on a list that isn't in the deck yet. */
export interface MissingWord {
  word: string;
  pinyin: string | null;
  gloss: string | null;
}

export interface Blocker {
  word: string;
  /** Sentences this word alone is blocking. */
  unlocks: number;
  /** In one of the Pleco word lists: something to learn rather than a name. */
  listed: boolean;
  pinyin: string | null;
  gloss: string | null;
}

/** What the app knew when a bug was filed. */
export interface BugContext {
  url: string;
  /** The tab, and whether a review had the screen. */
  screen: string;
  viewport: { width: number; height: number; dpr: number };
  userAgent: string;
  theme: "light" | "dark";
  /** The deployed commit, where Vercel says. */
  build: string | null;
  /** What the screens on show reported about themselves: the card in a session, say. */
  state: Record<string, unknown>;
  /** The last few errors the page saw, newest last. */
  errors: Array<{ at: number; message: string }>;
  /** Answers waiting in the outbox. */
  pending: number;
}

export type BugStatus = "open" | "fixed" | "wontfix";

/** A bug the owner filed from the app. */
export interface BugReport {
  id: number;
  at: number;
  text: string;
  context: BugContext;
  hasImage: boolean;
  status: BugStatus;
  /** What was done about it. */
  note: string | null;
  closedAt: number | null;
}

/** The kinds of question Look up answers (chongfuxi/CLAUDE.md, Look up). */
export type LookupKind = "pairing" | "meaning" | "synonyms" | "tone" | "pattern" | "expression" | "reading" | "breakdown";

/** What an option is judged on. */
export type LookupPoint = "meaning" | "pairing" | "grammar" | "register" | "tone" | "frequency";

/** Where a judgment came from. "model" is the model's own knowledge, shown as such. */
export type LookupSource = "corpus" | "dictionary" | "deck" | "model";

/** One of the owner's sentences, as evidence. */
export interface LookupSentence {
  id: number;
  zh: string;
  en: string | null;
  readable: boolean;
  /**
   * On a sense's example: the longer word the sense's word is only part of
   * here (县 in 县城), so it isn't a sentence of the word as its card counts
   * them. Null when it stands as a word of its own.
   */
  within?: string | null;
}

/** One judgment on a word, and where it came from; checked against the evidence. */
export interface LookupJudgment {
  point: LookupPoint;
  says: string;
  source: LookupSource;
  count: number | null;
  checked: boolean;
}

/**
 * A piece of an answer. The model composes each answer from these (lookup.ts,
 * ANSWER_SCHEMA); the app draws them, and the check has been over each.
 */
export type LookupBlock =
  /** The phrase with ___ for the asked part, and every candidate for it: those that fit with a tag, near misses with why not. */
  | { type: "gap"; frame: string; options: Array<{ zh: string; label: string; fits: boolean; why: string }> }
  /** Numbered words that fit: when each is the one, why, the evidence, the owner's sentences. */
  | {
      type: "sense";
      items: Array<{ zh: string; label: string; why: string; count: number | null; points: LookupJudgment[]; examples: LookupSentence[] }>;
    }
  /** Two or three words side by side on the same rows. A cell may be marked yes or no. */
  | { type: "contrast"; words: string[]; rows: Array<{ aspect: string; cells: Array<{ text: string; mark: "yes" | "no" | "none" }> }> }
  /** Words placed along one line between two ends (good ↔ bad), 0 at the left, 1 at the right. */
  | { type: "scale"; left: string; middle: string; right: string; points: Array<{ zh: string; gloss: string; at: number }> }
  /** A template with {A}-style slots, what each slot takes, and fillings with the slot words marked. */
  | {
      type: "pattern";
      template: string;
      slots: Array<{ name: string; note: string }>;
      fillings: Array<{ zh: string; en: string | null; marks: string[]; mine: boolean }>;
    }
  /** The rule behind the answer: a head word and what it combines with, from the owner's sentences where counted. */
  | { type: "family"; head: string; rule: string; members: Array<{ zh: string; count: number | null }> }
  /** The likely mistake beside the fix. */
  | {
      type: "wrong-right";
      wrong: string;
      right: string;
      why: string;
      /**
       * The owner's sentences that say the "wrong" part after all (`key`, the
       * part that differs and a character either side), when any do: then the
       * model's warning is in doubt and the block shows them, not a strike.
       */
      used?: { key: string; count: number; examples: LookupSentence[] };
    }
  /** One sentence: the owner's (by id, as stored), or labelled as written by the model. */
  | { type: "example"; zh: string; en: string | null; mine: boolean; readable: boolean }
  | {
      /**
       * A word taken apart: each character with its reading in this word
       * (from ours, never the model), what it means here, and words of the
       * owner's deck that share it (filled in when shown); then the
       * characters' literal sense put together.
       */
      type: "parts";
      word: string;
      chars: Array<{ zh: string; pinyin: string | null; gloss: string; also: string[] }>;
      literal: string;
    }
  | {
      /**
       * The one thing worth knowing that the other blocks don't show, of any
       * kind: a structure in the question (是…的 around 围绕X转), a cultural
       * point, why something sounds formal. `label` names the kind ("Grammar
       * in your question"); `title` the Chinese it is about, or ""; `shape`,
       * for a structure, the question's words with its inside in braces
       * ("是{围绕X转}的"), or "". The model's own, at most one.
       */
      type: "note";
      label: string;
      title: string;
      shape: string;
      text: string;
    };

/** What the app knows about a word shown in an answer: our reading and meaning, and where it stands in the deck. */
export interface LookupWord {
  /** From our readings code, never the model. */
  pinyin: string | null;
  gloss: string | null;
  inDictionary: boolean;
  /** For a phrase that isn't a headword (得了心脏病): the headwords it splits into, each in the words map too. */
  parts?: string[];
  /** Looked up each time the answer is shown, not kept with it. */
  deck?: LookupDeck;
}

/** One answer to "what do I say here", after the check: blocks, each fact in them traced to the evidence. */
export interface LookupAnswer {
  query: string;
  /** The model that answered, and when. */
  model: string;
  at: number;
  /** How the query was read: its parts, which of them is the question, and what kind of question it is. */
  reading: { parts: Array<{ text: string; asked: boolean }>; kind: LookupKind; note: string };
  /** In the order drawn: the headline block first, examples last (`orderBlocks`). */
  blocks: LookupBlock[];
  /** Every word a block names as a candidate, an entry or a point on a scale. */
  words: Record<string, LookupWord>;
  /** A sentence or two the blocks don't show; folded away under the answer. */
  summary: string;
  /** What the check took out or marked, and why. */
  checks: string[];
  usage: { input: number; output: number; calls: number };
}

/** The first shape of an answer (options rather than blocks), as kept before October 2026's blocks. Converted on read. */
export interface LookupAnswerV1 {
  query: string;
  model: string;
  at: number;
  reading: LookupAnswer["reading"];
  frame: string;
  senses: Array<{ label: string; words: string[] }>;
  gist?: string;
  options: Array<{
    zh: string;
    label?: string;
    pinyin: string | null;
    gloss: string | null;
    inDictionary: boolean;
    fits: boolean;
    verdict: string;
    points: LookupJudgment[];
    examples: LookupSentence[];
    wrong: string;
    right: string;
  }>;
  written: Array<{ zh: string; en: string }>;
  summary: string;
  checks: string[];
  usage: { input: number; output: number; calls: number };
}

/** Where a word in an answer stands in the deck: in it (and how strong its Read card is), on a Pleco list, a name, or not at all. */
export interface LookupDeck {
  status: "deck" | "listed" | "name" | null;
  /** For a deck word: not yet answered here, under three weeks strong, under six months, or beyond. */
  stage: "new" | "young" | "mature" | "strong" | null;
}

/** A word of the corpus offered as Look up's question is typed (no model): it opens the word's page. */
export interface WordSuggestion {
  word: string;
  pinyin: string | null;
  gloss: string | null;
  /** In the deck, or only on a list. */
  inDeck: boolean;
  /** What it matched: its characters, its pinyin, or its English. */
  by: "chinese" | "pinyin" | "english";
}

/** A lookup in the history, with the owner's verdict on it. */
export interface LookupListed {
  query: string;
  at: number;
  kind: LookupKind | null;
  verdict: "right" | "wrong" | null;
  note: string | null;
  /** The words of the corpus it was about: asked from their cards, or named in it. */
  words: string[];
}
