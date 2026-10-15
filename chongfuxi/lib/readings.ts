// The reading and meaning of each word of a sentence, shown when the word is
// tapped on a card.
//
// The decks' own pinyin is not used: their polyphones are often wrong even
// where it fits (every 倒 is dǎo), and many sentences have none. A word
// takes, in order: the reading a particle has in running text (了 le, not
// liǎo; 着 zhe, not zháo), the reading on the word's own row (from the
// owner's Pleco card, or CC-CEDICT when it was added), CC-CEDICT's
// (`loadReadings` in app/api/chongfuxi/headwords.ts), and failing all those
// the readings of the pieces it splits into (孩子们 → 孩子 + 们). The meaning
// comes with the reading it was found under. Pure, so a script can check it.

/**
 * Single characters whose dictionary reading (the one most of their compounds
 * use, `loadReadings`) is not the one they nearly always have as a word on
 * their own in a sentence, and particles whose deck row may hold another.
 */
export const RUNNING_READINGS: Record<string, string> = {
  了: "le5",
  的: "de5",
  地: "de5",
  得: "de5",
  着: "zhe5",
  们: "men5",
  吗: "ma5",
  呢: "ne5",
  吧: "ba5",
  啊: "a5",
  么: "me5",
  呀: "ya5",
  嘛: "ma5",
  还: "hai2",
  都: "dou1",
  为: "wei4",
  教: "jiao1",
  倒: "dao4",
  干: "gan4",
  差: "cha4",
  累: "lei4",
  弹: "tan2",
};

/** A word's reading, numbered with "@" between syllables, and a short meaning. */
export interface Looked {
  p: string;
  gloss: string | null;
}

/**
 * What a word's own row or the dictionary has for it, with the reading
 * `want` when that is one of its readings; undefined for a word in neither.
 */
export type Lookup = (word: string, want?: string) => Looked | undefined;

/** Longest first, from the left, into words that have an entry; null if some part has none. */
function splitLooked(word: string, lookup: Lookup): Looked | null {
  const chars = [...word];
  const parts: Array<{ w: string } & Looked> = [];
  for (let i = 0; i < chars.length; ) {
    let found = false;
    for (let n = Math.min(chars.length - i, 8); n >= 1; n--) {
      const w = chars.slice(i, i + n).join("");
      const e = lookup(w, n === 1 ? RUNNING_READINGS[w] : undefined);
      if (e) {
        parts.push({ w, ...e });
        i += n;
        found = true;
        break;
      }
    }
    if (!found) return null;
  }
  return {
    p: parts.map((x) => x.p).join("@"),
    gloss: parts.map((x) => `${x.w} ${x.gloss ?? "…"}`).join(" + "),
  };
}

/** A word's reading and meaning, or null for one with none anywhere (Latin letters, a character the dictionary lacks). */
export function lookUp(word: string, lookup: Lookup): Looked | null {
  if (!/\p{Script=Han}/u.test(word)) return null;
  const want = RUNNING_READINGS[word];
  const e = lookup(word, want);
  if (e) return { p: want ?? e.p, gloss: e.gloss };
  return splitLooked(word, lookup);
}
