// Reading word breaks out of pinyin written with tone marks and no gaps
// between a word's syllables: "Zhèngfǔ guānyuán shòu rénmín de jiāndū."
//
// The spaces say where the words are. To carry that over to the characters,
// each pinyin word has to be cut into syllables — one per character — and
// pinyin run together is ambiguous ("xian" is 先 or 西安). So every way of
// cutting each word is tried, and the one kept is the one whose syllable
// count fits the characters and whose syllables are readings those
// characters actually have.

const PLAIN: Record<string, string> = {
  ā: "a", á: "a", ǎ: "a", à: "a",
  ē: "e", é: "e", ě: "e", è: "e",
  ī: "i", í: "i", ǐ: "i", ì: "i",
  ō: "o", ó: "o", ǒ: "o", ò: "o",
  ū: "u", ú: "u", ǔ: "u", ù: "u",
  ü: "v", ǖ: "v", ǘ: "v", ǚ: "v", ǜ: "v",
  ń: "n", ň: "n", ǹ: "n", ḿ: "m",
};

/** Pinyin with its tone marks and capitals taken off, ü written v; apostrophes kept as syllable breaks. */
export function plainPinyin(s: string): string {
  return [...s.normalize("NFC").toLowerCase()].map((c) => PLAIN[c] ?? c).join("");
}

/** Every way of cutting a run of letters into syllables, fewest pieces first. */
function cuts(word: string, valid: ReadonlySet<string>): string[][] {
  const out: string[][] = [];
  const walk = (at: number, sofar: string[]) => {
    if (out.length >= 12) return;
    if (at === word.length) {
      out.push(sofar);
      return;
    }
    for (let end = Math.min(word.length, at + 6); end > at; end--) {
      const piece = word.slice(at, end);
      if (valid.has(piece)) walk(end, [...sofar, piece]);
    }
  };
  walk(0, []);
  return out;
}

/**
 * The characters grouped into the words the pinyin marks, or null when the
 * pinyin doesn't fit them: a different number of syllables than characters, or
 * too many syllables the characters can't be read as (pinyin belonging to
 * some other sentence).
 *
 * @param han       the sentence's Chinese characters, in order, nothing else
 * @param pinyin    as written, tone marks and punctuation included
 * @param syllables every syllable there is
 * @param readings  the toneless readings each character has
 */
export function wordsByPinyin(
  han: string[],
  pinyin: string,
  syllables: ReadonlySet<string>,
  readings: ReadonlyMap<string, ReadonlySet<string>>,
): string[] | null {
  const tokens = plainPinyin(pinyin)
    .split(/[^a-zv']+/)
    .filter((t) => /[a-zv]/.test(t));
  if (!tokens.length || !han.length) return null;

  // For each token, the ways it can be cut; an apostrophe forces a cut.
  const options = tokens.map((t) => {
    const parts = t.split("'").filter(Boolean).map((p) => cuts(p, syllables));
    if (parts.some((p) => !p.length)) return [] as string[][];
    return parts.reduce<string[][]>((acc, p) => acc.flatMap((a) => p.slice(0, 4).map((b) => [...a, ...b])), [[]]).slice(0, 8);
  });
  if (options.some((o) => !o.length)) return null;

  // Walk the tokens, keeping for each position in the characters the best way of having got there.
  type Path = { hits: number; lens: number[] };
  let at = new Map<number, Path>([[0, { hits: 0, lens: [] }]]);
  for (const ways of options) {
    const next = new Map<number, Path>();
    for (const [pos, path] of at) {
      for (const way of ways) {
        const end = pos + way.length;
        if (end > han.length) continue;
        let hits = path.hits;
        way.forEach((s, i) => {
          const can = readings.get(han[pos + i]);
          // 儿 written as a bare r on the end of a word.
          if (can?.has(s) || (s === "r" && han[pos + i] === "儿")) hits++;
        });
        const had = next.get(end);
        if (!had || hits > had.hits) next.set(end, { hits, lens: [...path.lens, way.length] });
      }
    }
    at = next;
    if (!at.size) return null;
  }
  const done = at.get(han.length);
  if (!done || done.hits / han.length < 0.8) return null;

  const words: string[] = [];
  let i = 0;
  for (const len of done.lens) {
    words.push(han.slice(i, i + len).join(""));
    i += len;
  }
  return words;
}
