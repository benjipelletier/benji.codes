const TONE_MAP: Record<string, string> = {
  ā: "a", á: "a", ǎ: "a", à: "a",
  ē: "e", é: "e", ě: "e", è: "e", ê: "e",
  ī: "i", í: "i", ǐ: "i", ì: "i",
  ō: "o", ó: "o", ǒ: "o", ò: "o",
  ū: "u", ú: "u", ǔ: "u", ù: "u",
  ǖ: "v", ǘ: "v", ǚ: "v", ǜ: "v", ü: "v",
  ń: "n", ň: "n", ǹ: "n",
};

/**
 * A toneless syllable as shown: ü written ü (lü, nüe), as 重复习 writes it.
 * Inside, 龙库 keeps ü as v (lv, nve): the data files, the bank's first and
 * last syllables and links all use it, so only what is shown changes.
 */
export function showSyl(syl: string): string;
export function showSyl(syl: string | null | undefined): string | null | undefined;
export function showSyl(syl: string | null | undefined) {
  return syl ? syl.replace(/^([ln])v/, "$1ü") : syl;
}

export function stripTones(syl: string): string {
  let out = "";
  for (const ch of syl) {
    out += TONE_MAP[ch] ?? ch.toLowerCase();
  }
  return out;
}

export function tonelessSyllables(pinyin: string | undefined): string[] {
  if (!pinyin) return [];
  return pinyin.trim().split(/\s+/).map(stripTones).filter(Boolean);
}
