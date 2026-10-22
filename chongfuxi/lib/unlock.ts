// Which words stand between the owner and a sentence.
//
// A word counts as readable if it is known, or if it splits entirely into
// words that are — 这个 is readable when 这 and 个 are, 孩子们 when 孩子 and 们
// are — with a trailing 儿 allowed (一点儿 reads as 一点 does). When a word
// isn't readable, the blame goes to the part that would actually be learnt:
// 孩子们 is blocked by 孩子. A word that doesn't break into words the app has
// heard of (约翰, most names) is blamed whole.
//
// A sentence is readable when nothing in it is blamed.
//
// Except a dictionary word that is vocabulary of its own: 黄金 is gold, not
// "yellow metal", and 大厦, 挣脱 the same, so knowing their characters isn't
// knowing them (the owner, bugs #14, #23, #24: sentences came up with words
// not in the deck). Such a word must be known itself, and is blamed whole. A
// word is see-through, and still reads by its parts, when one of its
// characters is grammatical or a common function word (这个, 不是, 看完了,
// 孩子们), it is a number (二十), it repeats (看看, 高高兴兴), or it is a word
// already known with something added (准备好了).

/** Characters that make a word read by its parts: measure words, negation, aspect, pronoun-ish and function words, common complements. */
const SEE_THROUGH = new Set(
  "个一不是那这了们的得着过吗呢吧啊么点些种次位每几各很就真太也都还再只有没在到去来下上里好完对要想能会可儿起出回进开见住掉走给让被把从跟和与或而之其所以多少我你他她它您咱",
);
const NUMERAL = /^[零〇一二三四五六七八九十百千万亿两半第几]+$/u;

/** Whether a word reads by its parts even though the dictionary lists it (see above). */
export function seeThrough(word: string, known: ReadonlySet<string>): boolean {
  const c = [...word];
  if (c.some((x) => SEE_THROUGH.has(x)) || NUMERAL.test(word)) return true;
  if (new Set(c).size === 1 || (c.length === 4 && ((c[0] === c[1] && c[2] === c[3]) || (c[0] === c[2] && c[1] === c[3])))) return true;
  for (let k = 2; k < c.length; k++) if (known.has(c.slice(0, k).join("")) || known.has(c.slice(c.length - k).join(""))) return true;
  return false;
}

export interface Unlock {
  /** The words to learn before this sentence can be read; empty when it can. */
  blockersOf(words: string[]): string[];
}

/**
 * @param known     words that count as known: the deck, and marked names
 * @param universe  every word the app has a row for, known or not — what a
 *                  word may be broken into when deciding whom to blame
 * @param headwords the dictionary's headwords: one of two or more characters
 *                  that isn't see-through must be known itself
 */
export function makeUnlock(known: ReadonlySet<string>, universe: ReadonlySet<string>, headwords: ReadonlySet<string> = new Set()): Unlock {
  /** Vocabulary of its own: not read by its parts, and blamed whole. */
  const opaque = (t: string) => [...t].length > 1 && headwords.has(t) && !seeThrough(t, known);
  const readableMemo = new Map<string, boolean>();
  const readable = (t: string): boolean => {
    if (known.has(t)) return true;
    const hit = readableMemo.get(t);
    if (hit !== undefined) return hit;
    if (opaque(t)) {
      readableMemo.set(t, false);
      return false;
    }
    const chars = [...t];
    let ok = chars.length > 1 && chars[chars.length - 1] === "儿" && readable(chars.slice(0, -1).join(""));
    for (let k = 1; k < chars.length && !ok; k++) {
      ok = known.has(chars.slice(0, k).join("")) && readable(chars.slice(k).join(""));
    }
    readableMemo.set(t, ok);
    return ok;
  };

  const blameMemo = new Map<string, string[]>();
  const blame = (t: string): string[] => {
    if (universe.has(t) || opaque(t)) return [t];
    const hit = blameMemo.get(t);
    if (hit) return hit;
    // Fewest pieces drawn from the words there are rows for and the words
    // known; single characters always allowed, so there is always a split.
    const chars = [...t];
    const best: Array<string[] | null> = [[]];
    for (let i = 1; i <= chars.length; i++) {
      best[i] = null;
      for (let j = 0; j < i; j++) {
        const prev = best[j];
        if (!prev) continue;
        const piece = chars.slice(j, i).join("");
        if (i - j > 1 && !universe.has(piece) && !known.has(piece)) continue;
        if (!best[i] || prev.length + 1 < best[i]!.length) best[i] = [...prev, piece];
      }
    }
    const unknown = (best[chars.length] ?? [t]).filter((p) => !readable(p));
    const out = unknown.length && unknown.every((p) => universe.has(p)) ? unknown : [t];
    blameMemo.set(t, out);
    return out;
  };

  return {
    blockersOf(words) {
      const out = new Set<string>();
      for (const w of words) if (!readable(w)) for (const b of blame(w)) out.add(b);
      return [...out];
    },
  };
}
