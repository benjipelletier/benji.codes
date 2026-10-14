// CC-CEDICT's headwords alone, for telling a word from part of a compound
// when picking the sentences a word card is shown in (contextFit in
// chongfuxi/lib/review.ts). Read once per server instance, lazily.

import { readFileSync } from "node:fs";
import { join } from "node:path";

let headwords: Set<string> | null = null;

/** Every simplified headword in chongfuxi/data/cedict.txt; empty if the file can't be read. */
export function loadHeadwords(): Set<string> {
  if (headwords) return headwords;
  const set = new Set<string>();
  try {
    const text = readFileSync(join(process.cwd(), "chongfuxi", "data", "cedict.txt"), "utf8");
    for (const m of text.matchAll(/^([^#\t\n][^\t\n]*)\t/gm)) set.add(m[1]);
  } catch {
    // Without the dictionary every sentence counts as free-standing, as before.
  }
  headwords = set;
  return set;
}
