// Which words stand between the owner and a sentence.
//
// A word counts as readable if it is known, or if it splits entirely into
// words that are — 这个 is readable when 这 and 个 are, 孩子们 when 孩子 and 们
// are — with a trailing 儿 allowed (一点儿 reads as 一点 does). When a word
// isn't readable, the blame goes to the part that would actually be learnt:
// 孩子们 is blocked by 孩子. A word that doesn't break into words the app has
// heard of (约翰, most names) is blamed whole.
//
// A word the owner marked as a word of its own (`whole`: he met 式样 in a
// sentence and knew 式 and 样 but not it) never reads from its parts: it must
// be known itself, and is blamed whole, also inside a longer token (新式样).
//
// A sentence is readable when nothing in it is blamed.

export interface Unlock {
  /** The words to learn before this sentence can be read; empty when it can. */
  blockersOf(words: string[]): string[];
}

/**
 * @param known     words that count as known: the deck, and marked names
 * @param universe  every word the app has a row for, known or not — what a
 *                  word may be broken into when deciding whom to blame
 */
export function makeUnlock(known: ReadonlySet<string>, universe: ReadonlySet<string>, whole: ReadonlySet<string> = new Set()): Unlock {
  const readableMemo = new Map<string, boolean>();
  const readable = (t: string): boolean => {
    if (known.has(t)) return true;
    if (whole.has(t)) return false;
    const hit = readableMemo.get(t);
    if (hit !== undefined) return hit;
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
    if (universe.has(t) || whole.has(t)) return [t];
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
        if (i - j > 1 && !universe.has(piece) && !known.has(piece) && !whole.has(piece)) continue;
        if (!best[i] || prev.length + 1 < best[i]!.length) best[i] = [...prev, piece];
      }
    }
    const unknown = (best[chars.length] ?? [t]).filter((p) => !readable(p));
    const out = unknown.length && unknown.every((p) => universe.has(p) || whole.has(p)) ? unknown : [t];
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
