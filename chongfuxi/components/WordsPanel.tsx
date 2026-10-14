"use client";

// The words: every word in the deck, as a wall to browse and open (WordWall).
// How the deck covers the HSK lists is on the Stats page.

import { WordWall } from "./WordWall";
import type { Shell } from "./shared";

export function WordsPanel({ shell, onFindSentences }: { shell: Shell; onFindSentences: (word: string) => void }) {
  return <WordWall canWrite={shell.canWrite} onFindSentences={onFindSentences} />;
}
