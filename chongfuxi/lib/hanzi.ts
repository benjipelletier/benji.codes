// Character-level helpers shared by the reader, the segmenter and the corpus.

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

export function isHan(ch: string): boolean {
  return HAN.test(ch);
}

/** Pleco joins the characters of a headword with "@"; the text is the rest. */
export function cleanHeadword(hw: string | null | undefined): string {
  return (hw ?? "").replace(/@/g, "");
}

/**
 * One numbered-pinyin syllable reduced to a comparable key: lower case, no
 * tone, ü spelt v. Punctuation that Pleco leaves glued to a syllable ("zhi4,"
 * or "ping2'") is dropped. Returns "" for anything with no letters in it.
 */
export function toneless(syllable: string): string {
  const s = syllable
    .toLowerCase()
    .replace(/u:/g, "v")
    .replace(/ü/g, "v")
    .replace(/[^a-zv]/g, "");
  return s;
}

/** Tone number of a numbered syllable, 5 when it carries none. */
export function toneOf(syllable: string): number {
  const m = syllable.match(/[1-5]/);
  return m ? Number(m[0]) : 5;
}

/**
 * Variant forms the sentence decks use for a character the word lists spell
 * differently. Keyed by character, then by the reading that selects the
 * variant — 著 read zhe/zhao/zhuo is the aspect particle 着, while 著 read zhu
 * (显著) is a word in its own right and stays as it is.
 */
const VARIANTS: Record<string, Record<string, string>> = {
  著: { zhe: "着", zhao: "着", zhuo: "着" },
};

/** The form a word should be looked up under, given the reading of each character. */
export function normaliseWord(word: string, readings: string[] | null): string {
  if (!readings) return word;
  let out = "";
  let i = 0;
  for (const ch of word) {
    const v = VARIANTS[ch]?.[readings[i] ?? ""];
    out += v ?? ch;
    i++;
  }
  return out;
}

const MARKS: Record<string, string> = {
  a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", v: "ǖǘǚǜ",
};

/** One numbered syllable with its tone mark: "lu:3" → "lǚ", "ma5" → "ma". */
function markSyllable(syl: string): string {
  const m = syl.match(/^([a-zA-Zü:]+)([1-5])?$/);
  if (!m) return syl;
  const base = m[1].replace(/u:/gi, "v").replace(/ü/g, "v");
  const tone = Number(m[2] ?? 5);
  const show = (s: string) => s.replace(/v/g, "ü").replace(/V/g, "Ü");
  if (tone === 5) return show(base);
  const lower = base.toLowerCase();
  // a and e always take the mark, o takes it in "ou", otherwise the last vowel.
  let at = lower.indexOf("a");
  if (at < 0) at = lower.indexOf("e");
  if (at < 0 && lower.includes("ou")) at = lower.indexOf("o");
  if (at < 0) {
    for (let i = lower.length - 1; i >= 0; i--) {
      if ("iouv".includes(lower[i])) {
        at = i;
        break;
      }
    }
  }
  if (at < 0) return show(base);
  const marked = MARKS[lower[at]][tone - 1];
  return show(base.slice(0, at)) + marked + show(base.slice(at + 1));
}

/** Pleco's numbered pinyin, readable: "lü3@guan3" → "lǚguǎn", words kept apart. */
export function displayPinyin(pron: string): string {
  return pron
    .split(" ")
    .map((word) =>
      word
        .split("@")
        .filter(Boolean)
        .map((s) => {
          const lead = s.match(/^[^a-zA-Zü]*/)?.[0] ?? "";
          const tail = s.match(/[^a-zA-Zü:0-9]*$/)?.[0] ?? "";
          return lead + markSyllable(s.slice(lead.length, s.length - tail.length)) + tail;
        })
        // A syllable opening on a, e or o inside a word is set off: nǚ'ér.
        .reduce((acc, syl) => (acc && /^[aeoāáǎàēéěèōóǒò]/i.test(syl) && !acc.endsWith("'") ? `${acc}'${syl}` : acc + syl), ""),
    )
    .filter(Boolean)
    .join(" ");
}
