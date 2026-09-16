import { NextResponse } from "next/server";
import { syllables, bySyllable, entries } from "@longku/lib/data";

export const dynamic = "force-static";

/** Returns the list of syllables along with bucket sizes — small payload for the heatmap. */
export async function GET() {
  const sylls = syllables();
  const buckets = bySyllable();
  const all = entries();
  const result = sylls.map((s) => {
    const ids = buckets[s] ?? [];
    return {
      syllable: s,
      count: ids.length,
      top: ids[0] !== undefined ? all[ids[0]].w : null,
    };
  });
  // Total frequency mass, so the client can compute usage coverage without
  // shipping 30k frequencies to the browser.
  const corpusMass = all.reduce((n, e) => n + e.f, 0);
  return NextResponse.json({ syllables: result, corpusMass, corpusWords: all.length });
}
