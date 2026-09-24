import { NextRequest, NextResponse } from "next/server";
import { lookupWord } from "@longku/lib/data";
import { gloss } from "@longku/lib/gloss";

/**
 * English meanings for a handful of words: `?w=…&w=…`.
 *
 * Meanings only, not pinyin or the entry — this backs the chain game's hint,
 * where anything more gives the answer away. Off-corpus words are left out.
 */
export async function GET(req: NextRequest) {
  const words = req.nextUrl.searchParams.getAll("w").slice(0, 50);
  const glosses: Record<string, string> = {};
  for (const w of words) {
    const e = lookupWord(w);
    // The word's own characters turn up in some definitions ("the yu 竽 mouth
    // organ"), which gives the answer away.
    if (e?.e) glosses[w] = gloss(e.e, 2).replace(new RegExp(`[${w}]`, "g"), "□");
  }
  return NextResponse.json({ glosses });
}
