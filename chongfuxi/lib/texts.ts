// Plain Chinese text into sentences: a lesson from a textbook, an article,
// anything with no word breaks and no translation. Pure, so the Import page
// can show what a file holds and the server can add it the same way.
//
// A file's first line is taken as its title when it has no sentence-ending
// punctuation (爱的细节). The rest is cut after 。！？ and …, with any closing
// quote kept on the sentence it closes. Speech that runs over several
// sentences (说："……。……。") is cut too, so a card stays short; a quote mark
// left without its partner is dropped.

/** Ends a sentence. */
const END = new Set(["。", "！", "？", "!", "?", "…"]);
/** Closes a quote or bracket after a sentence's end, and belongs to it. */
const CLOSE = new Set(["”", "’", "」", "』", "）", ")", "》"]);
const PAIRS: Array<[string, string]> = [
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
];

export interface TextFile {
  name: string;
  text: string;
}

export interface TextSentences {
  name: string;
  /** The first line, when it reads as a title rather than a sentence. */
  title: string | null;
  sentences: string[];
}

/** A quote mark with no partner in the piece, at its edge or inside: dropped. */
function unpaired(piece: string): string {
  let s = piece;
  // Straight quotes can't say which way they face: an odd one out goes.
  const straight = [...s].filter((c) => c === '"').length;
  if (straight % 2 === 1) {
    const at = s.endsWith('"') ? s.lastIndexOf('"') : s.indexOf('"');
    s = s.slice(0, at) + s.slice(at + 1);
  }
  for (const [open, close] of PAIRS) {
    const opens = [...s].filter((c) => c === open).length;
    const closes = [...s].filter((c) => c === close).length;
    if (opens > closes) s = s.replace(new RegExp(`${open}(?![^${open}]*${close})`), "");
    else if (closes > opens) s = s.replace(close, "");
  }
  return s.trim();
}

/** One paragraph cut into sentences. */
export function splitSentences(paragraph: string): string[] {
  const chars = [...paragraph.trim()];
  const out: string[] = [];
  let cur = "";
  let straight = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    cur += c;
    if (c === '"') straight++;
    if (!END.has(c)) continue;
    // A run of ends (？！, ……) and the quotes that close after them stay together.
    while (i + 1 < chars.length && (END.has(chars[i + 1]) || CLOSE.has(chars[i + 1]) || (chars[i + 1] === '"' && straight % 2 === 1))) {
      i++;
      cur += chars[i];
      if (chars[i] === '"') straight++;
    }
    out.push(cur);
    cur = "";
    straight = 0;
  }
  if (cur.trim()) out.push(cur);
  return out.map(unpaired).filter((s) => s.length > 0);
}

/** A file's title and sentences. */
export function readText(file: TextFile): TextSentences {
  const lines = file.text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let title: string | null = null;
  if (lines.length > 1 && ![...lines[0]].some((c) => END.has(c)) && [...lines[0]].length <= 24) title = lines.shift()!;
  return { name: file.name, title, sentences: lines.flatMap(splitSentences) };
}
