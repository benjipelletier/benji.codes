const TONE_MAP: Record<string, string> = {
  ā: "a", á: "a", ǎ: "a", à: "a",
  ē: "e", é: "e", ě: "e", è: "e", ê: "e",
  ī: "i", í: "i", ǐ: "i", ì: "i",
  ō: "o", ó: "o", ǒ: "o", ò: "o",
  ū: "u", ú: "u", ǔ: "u", ù: "u",
  ǖ: "v", ǘ: "v", ǚ: "v", ǜ: "v", ü: "v",
  ń: "n", ň: "n", ǹ: "n",
};

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
