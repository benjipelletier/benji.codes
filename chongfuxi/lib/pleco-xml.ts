// Reading a Pleco flashcard export (.xml).
//
// Flashcards → Import/Export → Export Cards writes one <card> per card:
//
//   <card language="chinese">
//     <entry>
//       <headword charset="sc">通过</headword><headword charset="tc">通過</headword>
//       <pron type="hypy" tones="numbers">tong1guo4</pron>
//       <defn>…</defn>
//     </entry>
//     <dictref dictid="PACE" entryid="…"/>
//     <catassign category="HSK 3.0/Level 2"/>
//     <scoreinfo scorefile="Default" score="47266" history="66666" …/>
//   </card>
//
// It differs from a backup (.pqb, see pleco.ts) in ways that matter here:
//
// - It carries a definition for almost every card, dictionary entries
//   included, where a backup only has the ones typed into custom cards.
// - Cards have no ids and no dates. Ids are made from what the card says, so
//   the same card gets the same id in the next export and progress keyed by it
//   carries over.
// - Categories are paths ("HSK 3.0/Level 2") rather than rows with parents.
// - Pinyin runs a word's syllables together and puts a space between words
//   ("ta1 gan3mao4 le5"), where a backup puts "@" between syllables.
//
// The result is the same PlecoSnapshot a backup gives, in the backup's own
// conventions ("@" between characters and between syllables), so the corpus
// reads either without knowing which it was.
//
// The format is flat and machine-written — no nesting inside <defn>, no CDATA,
// no comments — so this reads it with a few patterns rather than a parser,
// which keeps it the same code in the browser and in Node.

import {
  NotAPlecoBackupError,
  type PlecoCard,
  type PlecoCategory,
  type PlecoScore,
  type PlecoScorefile,
  type PlecoSnapshot,
} from "./pleco";

/** Parent of the top-level categories, as in a backup; no category has this id. */
const ROOT = -2;

const CARD = /<card\b[^>]*>([\s\S]*?)<\/card>/g;
const HEADWORD = /<headword\b([^>]*)>([^<]*)<\/headword>/g;
const PRON = /<pron\b[^>]*>([^<]*)<\/pron>/;
const DEFN = /<defn\b[^>]*>([^<]*)<\/defn>/;
const EMPTY_TAG = /<(dictref|catassign|scoreinfo)\b([^>]*?)\/?>/g;
const ATTR = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[name] ?? whole;
  });
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(ATTR)) out[m[1]] = decode(m[2]);
  return out;
}

/** FNV-1a over UTF-16 units, 32 bits, from a chosen start. */
function fnv(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A 53-bit id from text: stable across exports, and safely a JS integer. */
function id53(s: string): number {
  return fnv(s, 0x811c9dc5) * 0x200000 + (fnv(s, 0x9747b28c) >>> 11);
}

/** A positive 31-bit id, for the few things settings refer to by id. */
function id31(s: string): number {
  return (fnv(s, 0x811c9dc5) & 0x7fffffff) || 1;
}

/**
 * Pinyin as a backup writes it: "@" between syllables, a space between words.
 * A syllable ends at its tone number; anything after the last one in a word
 * (a full stop, an ellipsis) stays on the last syllable, as Pleco leaves it.
 * "//" marks where a separable verb splits (shui4//jiao4) and is dropped.
 */
export function pronFromXml(pron: string): string {
  return pron
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const w = word.replace(/\/\//g, "");
      const syllables = w.match(/[^0-9]*[0-9]/g);
      if (!syllables) return w;
      const rest = w.slice(syllables.join("").length);
      if (rest) syllables[syllables.length - 1] += rest;
      return syllables.join("@");
    })
    .join(" ");
}

const num = (v: string | undefined): number => (v === undefined || v === "" ? 0 : Number(v) || 0);
const numOrNull = (v: string | undefined): number | null => (v === undefined || v === "" ? null : Number(v) || null);

export function looksLikePlecoXml(text: string): boolean {
  return /<plecoflash\b/.test(text.slice(0, 2000));
}

export function readPlecoXml(xml: string): PlecoSnapshot {
  const root = xml.slice(0, 2000).match(/<plecoflash\b([^>]*)>/);
  if (!root) throw new NotAPlecoBackupError("no <plecoflash> element");
  const meta = attrs(root[1]);

  const categories: PlecoCategory[] = [];
  const categoryIds = new Map<string, number>();
  const taken = new Set<number>([ROOT]);
  /** The id of a category path, adding it and its ancestors on first sight. */
  const categoryOf = (path: string): number => {
    const known = categoryIds.get(path);
    if (known !== undefined) return known;
    const cut = path.lastIndexOf("/");
    const parent = cut < 0 ? ROOT : categoryOf(path.slice(0, cut));
    let id = id31(path);
    while (taken.has(id)) id = (id % 0x7fffffff) + 1;
    taken.add(id);
    categoryIds.set(path, id);
    categories.push({ id, name: cut < 0 ? path : path.slice(cut + 1), parent });
    return id;
  };

  const cards: PlecoCard[] = [];
  const scores = new Map<string, PlecoScore[]>();
  const seen = new Map<string, number>();

  for (const m of xml.matchAll(CARD)) {
    const body = m[1];
    let sc: string | null = null;
    let tc: string | null = null;
    let plain: string | null = null;
    for (const h of body.matchAll(HEADWORD)) {
      const text = decode(h[2]);
      const charset = attrs(h[1]).charset;
      if (charset === "sc") sc = text;
      else if (charset === "tc") tc = text;
      else plain = text;
    }
    // One headword is the card as typed; a pair is simplified and traditional.
    const text = sc ?? plain ?? tc;
    if (!text) continue;
    const pron = pronFromXml(decode(body.match(PRON)?.[1] ?? ""));
    const defn = decode(body.match(DEFN)?.[1] ?? "").trim();

    // The same card twice in one export still needs two ids.
    const key = `${text}\u0001${pron}`;
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    const id = id53(nth === 1 ? key : `${key}\u0001${nth}`);

    const cats: number[] = [];
    let dict = false;
    for (const t of body.matchAll(EMPTY_TAG)) {
      const a = attrs(t[2]);
      if (t[1] === "dictref") dict = true;
      else if (t[1] === "catassign") {
        if (a.category) cats.push(categoryOf(a.category));
      } else {
        const file = a.scorefile ?? "Default";
        const list = scores.get(file) ?? [];
        list.push({
          card: id,
          score: num(a.score),
          difficulty: numOrNull(a.difficulty),
          history: a.history ?? "",
          correct: num(a.correct),
          incorrect: num(a.incorrect),
          reviewed: num(a.reviewed),
          first: numOrNull(a.firstreviewedtime),
          last: numOrNull(a.lastreviewedtime),
        });
        scores.set(file, list);
      }
    }

    cards.push({
      id,
      hw: [...text].join("@"),
      alt: sc !== null && tc !== null ? [...tc].join("@") : null,
      pron,
      defn: defn || null,
      dict,
      cats,
      created: 0,
      modified: 0,
    });
  }

  if (!cards.length) throw new NotAPlecoBackupError("no cards in it");

  // The scorefile with the most scores first, since "the first one" is what
  // settings mean when they don't name one.
  const scorefiles: PlecoScorefile[] = [...scores]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, list]) => ({ id: id31(`scorefile:${name}`), name, scores: list }));

  return {
    format: {
      name: meta.generator ?? "Pleco XML flashcards",
      version: meta.formatversion ?? "",
      platform: meta.platform ?? "",
      created: meta.created ? Number(meta.created) : null,
    },
    cards,
    categories,
    scorefiles,
  };
}
