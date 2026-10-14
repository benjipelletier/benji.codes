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
  /** Readable sentences not yet introduced, and how many more may be today. */
  newSentences: number;
  newLeftToday: number;
  /** The setting: sentences introduced per day. */
  newPerDay: number;
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
}

export interface SentenceInfo {
  id: number;
  zh: string;
  en: string | null;
  /** Its words in order. */
  words: string[];
  /** The decks it came from. */
  sources: string[];
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
}

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
}

/** Everything about one word, for its sheet on the Words page. */
export interface WordDetail {
  word: string;
  pinyin: string | null;
  defs: Definition[];
  hsk: { old: string | null; v3: string | null };
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
}

/** What a session takes in. All on is everything due. */
export interface SessionKinds {
  /** Read cards: the word, to recognise. */
  read: boolean;
  /** Recall cards: the meaning, to produce the word. */
  recall: boolean;
  /** Sentence cards, new ones included. */
  sentences: boolean;
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
