// Reading sentences out of an Anki collection (.anki21, the SQLite file inside
// an .apkg).
//
// Only sentences are taken, never words. They come from two places in a deck
// built like "Ultimate Chinese": notes filed under a sentence sub-deck, whose
// main field is the sentence, and the example sentence some vocabulary notes
// carry in fields of their own. The vocabulary itself is left behind — words
// come from Pleco and nowhere else.
//
// Works on anything with sql.js's `exec`, like pleco.ts.

import type { SqlLike } from "./pleco";

export interface AnkiSentence {
  zh: string;
  /** Pinyin with tone marks and spaces between words, as the deck has it. May be empty. */
  pinyin: string;
  en: string | null;
  /** Where in the deck it came from, as a short name: "Spoonfed", "HSK examples". */
  source: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " ", "#39": "'" };

/** A field as text: Anki fields are HTML. */
function text(field: string | undefined): string {
  return (field ?? "")
    .replace(/<br\s*\/?>(?=.)/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\[sound:[^\]]*\]/g, "")
    .replace(/&(#?\w+);/g, (whole, name: string) => ENTITIES[name] ?? whole)
    .replace(/\s+/g, " ")
    .trim();
}

/** The last part of a deck's path: "Ultimate Chinese::5. Ultimate Sentences 2::Neri" → "Neri". */
const leaf = (deck: string) => deck.split("::").pop()!.replace(/^\d+\.\s*/, "").trim();

export function readAnkiSentences(db: SqlLike): { sentences: AnkiSentence[]; notes: number; decks: Record<string, number> } {
  const col = db.exec("select models, decks from col")[0]?.values[0];
  if (!col) throw new Error("This doesn't look like an Anki collection.");
  const models = JSON.parse(String(col[0])) as Record<string, { flds: Array<{ name: string }> }>;
  const decks = JSON.parse(String(col[1])) as Record<string, { name: string }>;
  const fieldsOf = new Map(Object.entries(models).map(([id, m]) => [id, m.flds.map((f) => f.name)]));

  // A note belongs to the deck its first card is in.
  const rows =
    db.exec(
      "select n.mid, n.flds, (select c.did from cards c where c.nid = n.id order by c.ord limit 1) from notes n order by n.id",
    )[0]?.values ?? [];

  const sentences: AnkiSentence[] = [];
  const counts: Record<string, number> = {};
  for (const [mid, flds, did] of rows) {
    const names = fieldsOf.get(String(mid)) ?? [];
    const values = String(flds).split("\u001f");
    const f = (name: string) => text(values[names.indexOf(name)]);
    const deck = decks[String(did)]?.name ?? "";
    counts[deck] = (counts[deck] ?? 0) + 1;

    if (/sentence/i.test(deck)) {
      // A sentence deck: the note is the sentence.
      if (f("Hanzi")) sentences.push({ zh: f("Hanzi"), pinyin: f("Pinyin"), en: f("Meaning") || null, source: leaf(deck) });
    } else if (f("SentenceSimplified")) {
      // A word or character note: only its example sentence is wanted.
      sentences.push({
        zh: f("SentenceSimplified"),
        pinyin: f("SentencePinyin.1"),
        en: f("SentenceMeaning") || null,
        source: `${leaf(deck)} examples`,
      });
    }
  }
  return { sentences, notes: rows.length, decks: counts };
}
