// Join JioNLP frequencies with the riddleyu chengyu dictionary,
// derive toneless first/last syllables, and emit slim JSON files
// the runtime can load.
//
// Inputs:
//   - longku/data/raw_frequency.txt         (JioNLP: word\tfreq, one per line)
//   - riddleyu/data/idiom.json                (rich dictionary: word, pinyin, explanation, derivation, example)
// Outputs:
//   - longku/data/chengyu.json              (array, sorted by freq desc — single source of truth)
//   - longku/data/by-first-syllable.json    ({ syllable: [index, index, ...] } — ranks within syllable)
//   - longku/data/syllables.json            (array of toneless first syllables, sorted alphabetically)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_SYLLABLES } from "./canonical-syllables.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const repoRoot = join(root, "..");

const freqPath = join(root, "data", "raw_frequency.txt");
const dictPath = join(repoRoot, "riddleyu", "data", "idiom.json");

const toneMap = {
  ā: "a", á: "a", ǎ: "a", à: "a", a: "a",
  ē: "e", é: "e", ě: "e", è: "e", ê: "e", e: "e",
  ī: "i", í: "i", ǐ: "i", ì: "i", i: "i",
  ō: "o", ó: "o", ǒ: "o", ò: "o", o: "o",
  ū: "u", ú: "u", ǔ: "u", ù: "u", u: "u",
  ǖ: "v", ǘ: "v", ǚ: "v", ǜ: "v", ü: "v", v: "v",
  ń: "n", ň: "n", ǹ: "n",
  m̄: "m", ḿ: "m", m̀: "m",
};

function stripTones(syl) {
  let out = "";
  for (const ch of syl) {
    out += toneMap[ch] ?? ch.toLowerCase();
  }
  return out;
}

function tonelessSyllables(pinyin) {
  if (!pinyin) return [];
  // Split on whitespace; JioNLP/riddleyu use space-separated syllables with diacritics.
  return pinyin
    .trim()
    .split(/\s+/)
    .map(stripTones)
    .filter(Boolean);
}

const freqLines = readFileSync(freqPath, "utf8").split("\n");
const freqMap = new Map();
for (const line of freqLines) {
  const [word, freqStr] = line.split("\t");
  if (!word) continue;
  const freq = Number(freqStr) || 0;
  freqMap.set(word, freq);
}

const dict = JSON.parse(readFileSync(dictPath, "utf8"));
const dictMap = new Map();
for (const entry of dict) {
  if (entry?.word) dictMap.set(entry.word, entry);
}

// Universe = union of JioNLP frequency list and riddleyu dictionary, but keep
// only entries with pinyin so we can compute the chain syllables.
const universe = new Set([...freqMap.keys(), ...dictMap.keys()]);

const entries = [];
let droppedNonCanonicalFirst = 0;
for (const word of universe) {
  const dictEntry = dictMap.get(word);
  if (!dictEntry?.pinyin) continue; // need pinyin for jielong

  const syls = tonelessSyllables(dictEntry.pinyin);
  if (syls.length < 2) continue; // not a chainable idiom

  const chars = [...word];
  if (chars.length !== syls.length) {
    // Pinyin / char count mismatch (some entries are odd) — skip.
    continue;
  }

  // Filter: first syllable must be a real Mandarin syllable. Source dictionary
  // has scattered typos (e.g., 苍's pinyin recorded as "āng" instead of "cāng")
  // that produce nonsensical buckets like "i", "fe", "sh", "xua". Drop them.
  if (!CANONICAL_SYLLABLES.has(syls[0])) {
    droppedNonCanonicalFirst++;
    continue;
  }

  entries.push({
    w: word,
    p: dictEntry.pinyin,
    f: freqMap.get(word) ?? 0,
    fs: syls[0],
    ls: syls[syls.length - 1],
    e: dictEntry.explanation || "",
    d: dictEntry.derivation || "",
    x: dictEntry.example && dictEntry.example !== "无" ? dictEntry.example : "",
  });
}

entries.sort((a, b) => b.f - a.f || a.w.localeCompare(b.w));

const bySyll = {};
entries.forEach((e, idx) => {
  (bySyll[e.fs] ??= []).push(idx);
});

const syllables = Object.keys(bySyll).sort();

writeFileSync(join(root, "data", "chengyu.json"), JSON.stringify(entries));
writeFileSync(join(root, "data", "by-first-syllable.json"), JSON.stringify(bySyll));
writeFileSync(join(root, "data", "syllables.json"), JSON.stringify(syllables));

const withFreq = entries.filter((e) => e.f > 0).length;
console.log(`Total chainable chengyus: ${entries.length}`);
console.log(`  Dropped (non-canonical first syllable): ${droppedNonCanonicalFirst}`);
console.log(`  With non-zero freq:      ${withFreq}`);
console.log(`  Unique first syllables:  ${syllables.length}`);
console.log(`  Sample: ${syllables.slice(0, 8).join(", ")} ...`);
console.log(`  Top syllable bucket sizes:`);
const sorted = Object.entries(bySyll).sort((a, b) => b[1].length - a[1].length);
for (const [s, arr] of sorted.slice(0, 5)) console.log(`    ${s}: ${arr.length}`);
