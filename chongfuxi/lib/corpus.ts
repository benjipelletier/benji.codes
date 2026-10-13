// From a Pleco snapshot to the corpus the app works on: words and texts.
//
// Everything here is a pure function of (snapshot, settings), so it can be
// rebuilt at any point in the event history. What changes with your actions —
// words marked known, names ignored — lives in the state machine on top.
//
// A card is a word or a text by its shape: one word (日本, AA制, 业余爱好者) or
// a sentence or phrase (anything with punctuation, or longer). What it counts
// for comes from the role of its top-level category:
//
//   known      its words count as known (ACTIVE, by default)
//   list       word lists; their words are candidates for "learn next"
//   sentences  sentence pools; its words (lesson vocabulary) count for nothing
//   ignore     not words at all (radicals)
//
// A card filed in several categories takes them all, except that ignore only
// wins when it is the card's only role.

import type { PlecoCard, PlecoCategory, PlecoSnapshot } from "./pleco";
import { cleanHeadword, isHan, toneless } from "./hanzi";
import { segmentByDictionary, segmentByPinyin, type SegmentContext } from "./segment";

export type CategoryRole = "known" | "list" | "sentences" | "ignore";

export interface Settings {
  /** Role per top-level category id. Categories not listed are word lists. */
  roles: Record<number, CategoryRole>;
  /** A word with any score in the scorefile counts as known. */
  knownIfScored: boolean;
  /** Which scorefile to read scores from; null for the first one. */
  scorefile: number | null;
}

export interface Word {
  /** Simplified headword. */
  w: string;
  /** Pleco cards for this headword — one per reading, usually just one. */
  cards: number[];
  /** Numbered pinyin of each card, as Pleco stores it. */
  prons: string[];
  /** Best score across its cards in the chosen scorefile, null if never tested. */
  score: number | null;
  inKnownCategory: boolean;
  inList: boolean;
  /** Known before anything you've done in this app: by category or by score. */
  known: boolean;
}

export interface Text {
  /** The Pleco card it came from. */
  id: number;
  /** As written, punctuation included. */
  zh: string;
  /** Translation — the card's own definition. */
  en: string | null;
  /** Words in order (Han only). */
  words: string[];
  /** Where the word breaks came from; "dictionary" also means its pinyin is unreliable. */
  source: "pleco" | "dictionary";
  /** Top-level categories it is filed under (a deck and a subset of it, say). */
  pools: number[];
  /** Already studied in Pleco: filed under a known category, or scored. */
  studied: boolean;
}

export interface Corpus {
  words: Map<string, Word>;
  texts: Text[];
  /** Every word the corpus knows of, for splitting text. */
  vocab: Set<string>;
  /** Traditional characters with only one simplified form, from the cards' own pairs. */
  simplified: Map<string, string>;
  segment: SegmentContext;
  /** Top-level category of every category id. */
  topOf: Map<number, number>;
  categories: PlecoCategory[];
  stats: {
    cards: number;
    wordCards: number;
    textCards: number;
    duplicateTexts: number;
    dictionarySplit: number;
  };
}

/** Pleco puts top-level categories under a sentinel parent; find it by absence. */
export function topLevelMap(categories: PlecoCategory[]): Map<number, number> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const top = new Map<number, number>();
  const resolve = (id: number): number => {
    const seen = new Set<number>();
    let cur = id;
    while (true) {
      const c = byId.get(cur);
      if (!c || !byId.has(c.parent) || seen.has(c.parent)) return cur;
      seen.add(cur);
      cur = c.parent;
    }
  };
  for (const c of categories) top.set(c.id, resolve(c.id));
  return top;
}

const LATIN = /[A-Za-z0-9\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/;

/**
 * The word a card stands for, or null when it reads as a sentence or phrase.
 * Optional parts that textbook lists put in brackets are kept: 点(钟) is 点钟,
 * (一)点儿 is 一点儿.
 */
export function wordOf(card: PlecoCard): string | null {
  const text = cleanHeadword(card.hw).replace(/[()（）]/g, "");
  const chars = [...text];
  const han = chars.filter(isHan).length;
  if (!han) return null;
  if (han === chars.length) {
    // Dictionary entries run longer than custom words: 业余爱好者, 过了这村没这店.
    return chars.length <= 4 || (card.dict && chars.length <= 8) ? text : null;
  }
  // Words with Latin letters or digits in them (AA制, T恤, 卡拉OK), but no
  // punctuation or spaces, which would make them phrases.
  return han <= 4 && chars.length <= 6 && chars.every((c) => isHan(c) || LATIN.test(c)) ? text : null;
}

export function isWordShaped(card: PlecoCard): boolean {
  return wordOf(card) !== null;
}

/**
 * Roles nobody has chosen yet. ACTIVE is known, radicals are ignored, a
 * category made mostly of sentence-shaped cards is a sentence pool, and the
 * rest are word lists.
 */
export function defaultSettings(snapshot: PlecoSnapshot): Settings {
  const topOf = topLevelMap(snapshot.categories);
  const shapes = new Map<number, { words: number; texts: number }>();
  for (const card of snapshot.cards) {
    const word = isWordShaped(card);
    for (const cat of new Set(card.cats.map((c) => topOf.get(c) ?? c))) {
      const s = shapes.get(cat) ?? { words: 0, texts: 0 };
      if (word) s.words++;
      else s.texts++;
      shapes.set(cat, s);
    }
  }
  const roles: Record<number, CategoryRole> = {};
  for (const c of snapshot.categories) {
    if (topOf.get(c.id) !== c.id) continue;
    const s = shapes.get(c.id) ?? { words: 0, texts: 0 };
    if (/^active$/i.test(c.name.trim())) roles[c.id] = "known";
    else if (/radical/i.test(c.name)) roles[c.id] = "ignore";
    else if (s.texts > 0 && s.texts >= 0.7 * (s.words + s.texts)) roles[c.id] = "sentences";
    else roles[c.id] = "list";
  }
  return { roles, knownIfScored: true, scorefile: null };
}

const ROLE_RANK: Record<CategoryRole, number> = { ignore: 0, list: 1, sentences: 1, known: 2 };

export function buildCorpus(snapshot: PlecoSnapshot, settings: Settings): Corpus {
  const topOf = topLevelMap(snapshot.categories);
  const roleOf = (cat: number): CategoryRole => settings.roles[topOf.get(cat) ?? cat] ?? "list";

  const scorefile =
    snapshot.scorefiles.find((s) => s.id === settings.scorefile) ?? snapshot.scorefiles[0] ?? null;
  const scoreOf = new Map<number, number>();
  for (const s of scorefile?.scores ?? []) scoreOf.set(s.card, s.score);

  // Readings each character has, from word cards whose pinyin lines up one
  // syllable per character. Used to check the sentence decks' pinyin.
  const charReadings = new Map<string, Set<string>>();
  const words = new Map<string, Word>();
  const textCards: Array<{ card: PlecoCard; pools: number[]; studied: boolean }> = [];
  // Traditional → simplified, learnt from word cards that carry both forms.
  const simpChars = new Set<string>();
  const tradPairs = new Map<string, Map<string, number>>();
  let wordCards = 0;

  for (const card of snapshot.cards) {
    const roles = card.cats.length ? card.cats.map(roleOf) : (["list"] as CategoryRole[]);
    const strongest = roles.reduce((a, b) => (ROLE_RANK[b] > ROLE_RANK[a] ? b : a));
    if (strongest === "ignore") continue;
    const inKnown = roles.includes("known");
    const score = scoreOf.get(card.id) ?? null;

    const w = wordOf(card);
    if (w) {
      wordCards++;
      const entry = words.get(w) ?? {
        w,
        cards: [],
        prons: [],
        score: null,
        inKnownCategory: false,
        inList: false,
        known: false,
      };
      entry.cards.push(card.id);
      if (card.pron && !entry.prons.includes(card.pron)) entry.prons.push(card.pron);
      if (score !== null) entry.score = Math.max(entry.score ?? 0, score);
      if (inKnown) entry.inKnownCategory = true;
      if (roles.includes("list") || inKnown) entry.inList = true;
      entry.known = entry.inKnownCategory || (settings.knownIfScored && entry.score !== null);
      words.set(w, entry);

      for (const c of w) simpChars.add(c);
      if (card.alt) {
        const simp = card.hw.split("@");
        const trad = card.alt.split("@");
        if (simp.length === trad.length) {
          trad.forEach((t, i) => {
            if (t === simp[i] || [...t].length !== 1 || [...simp[i]].length !== 1) return;
            const counts = tradPairs.get(t) ?? new Map<string, number>();
            counts.set(simp[i], (counts.get(simp[i]) ?? 0) + 1);
            tradPairs.set(t, counts);
          });
        }
      }

      const chars = card.hw.split("@");
      const syllables = card.pron.split(/[@ ]+/).map(toneless).filter(Boolean);
      if (chars.length === syllables.length && chars.every((c) => [...c].length === 1 && isHan(c))) {
        chars.forEach((c, i) => {
          const set = charReadings.get(c) ?? new Set<string>();
          set.add(syllables[i]);
          charReadings.set(c, set);
        });
      }
    } else {
      const pools = [...new Set(card.cats.map((c) => topOf.get(c) ?? c))];
      textCards.push({ card, pools, studied: inKnown || score !== null });
    }
  }

  // The sentence decks mix in traditional characters (於, 後, 怎麽). A character
  // that never appears in a simplified headword is mapped to its simplified
  // form; one that does (著, 乾) is left alone, since it is a word as written.
  const simplified = new Map<string, string>();
  for (const [trad, counts] of tradPairs) {
    if (simpChars.has(trad)) continue;
    simplified.set(trad, [...counts].sort((a, b) => b[1] - a[1])[0][0]);
  }
  const forSegmenting = (hw: string): string =>
    [...cleanHeadword(hw).replace(/【[^】]*】/g, "")].map((c) => simplified.get(c) ?? c).join("");

  // Two passes over the texts: first the ones whose own pinyin can be used,
  // whose words then join the vocabulary the rest are matched against.
  const vocab = new Set<string>(words.keys());
  const prepared = textCards.map(({ card }) => forSegmenting(card.hw));
  const pass1 = textCards.map(({ card }, i) => segmentByPinyin(prepared[i], card.pron, { charReadings }));
  for (const seg of pass1) if (seg) for (const w of seg.words) vocab.add(w);
  let maxLen = 1;
  for (const w of vocab) maxLen = Math.max(maxLen, [...w].length);
  const segment: SegmentContext = { charReadings, vocab, maxLen: Math.min(maxLen, 8) };

  // The same sentence often appears more than once (a deck and a lesson, or a
  // copy with half-width punctuation). Keep one, preferring one you've studied.
  const texts: Text[] = [];
  const byKey = new Map<string, number>();
  let duplicateTexts = 0;
  let dictionarySplit = 0;
  textCards.forEach(({ card, pools, studied }, i) => {
    const seg = pass1[i] ?? segmentByDictionary(prepared[i], segment);
    if (!seg.words.length) return;
    const zh = cleanHeadword(card.hw);
    const key = [...prepared[i]].filter(isHan).join("");
    const existing = byKey.get(key);
    if (existing !== undefined) {
      duplicateTexts++;
      const kept = texts[existing];
      if (studied) kept.studied = true;
      for (const p of pools) if (!kept.pools.includes(p)) kept.pools.push(p);
      return;
    }
    if (seg.source === "dictionary") dictionarySplit++;
    byKey.set(key, texts.length);
    texts.push({ id: card.id, zh, en: card.defn, words: seg.words, source: seg.source, pools, studied });
  });

  return {
    words,
    texts,
    vocab,
    simplified,
    segment,
    topOf,
    categories: snapshot.categories,
    stats: {
      cards: snapshot.cards.length,
      wordCards,
      textCards: textCards.length,
      duplicateTexts,
      dictionarySplit,
    },
  };
}
