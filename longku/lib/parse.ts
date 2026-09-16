// Pulls chengyu candidates out of free-form pasted text.
//
// A dump is whatever the user has lying around: a numbered list, a
// comma-separated line, Anki exports, notes with pinyin and glosses mixed in.
// Rather than guess at the surrounding format, we keep only runs of Han
// characters and let the corpus decide which runs are real chengyus.

/** Han ideographs, including the common extension blocks Chinese text uses. */
const HAN_RUN = /[㐀-䶿一-鿿豈-﫿]+/g;

/** Longest run we'll consider — beyond this it's prose, not an idiom list. */
const MAX_RUN = 16;

/**
 * Extract candidate Han runs from pasted text, in first-seen order.
 * Runs are returned unsegmented; the server splits them against the corpus,
 * since that's where the word list lives.
 */
export function extractRuns(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(HAN_RUN)) {
    const run = m[0];
    if (run.length < 2 || run.length > MAX_RUN) continue;
    if (seen.has(run)) continue;
    seen.add(run);
    out.push(run);
  }
  return out;
}
