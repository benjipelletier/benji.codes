import { NextRequest, NextResponse } from "next/server";
import { entries, bySyllable } from "@longku/lib/data";

/**
 * Candidates worth learning next, ranked by how much they knit the bank together.
 *
 * A bank of 300 words picked at random needs 153 chains averaging two words; the
 * same 300 chosen for connectivity need 60, averaging five. Chain length is a
 * property of which words you know, not how many — so the useful question isn't
 * "what's common" but "what would join what I already have".
 *
 * Scoring all 30k corpus words against the chain metric would be far too slow,
 * but the shape of a helpful word is known analytically. Adding a word is adding
 * an edge from its first syllable to its last, and the chain count falls when
 * that edge drains a syllable you can reach but not leave. So the candidates are
 * exactly:
 *
 *   first syllable  — one of your dead ends (absorbs a chain that stops there)
 *   last syllable   — one you already start from (doesn't open a fresh dead end)
 *
 * The client verifies the shortlist against the real metric; this just avoids
 * handing it thirty thousand words to check.
 */
export const dynamic = "force-dynamic";

const MAX_PER_SYLLABLE = 6;
const MAX_CANDIDATES = 60;

export async function POST(req: NextRequest) {
  let body: { deadEnds?: unknown; starts?: unknown; have?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const deadEnds = Array.isArray(body.deadEnds) ? (body.deadEnds as string[]) : [];
  const starts = new Set(Array.isArray(body.starts) ? (body.starts as string[]) : []);
  const have = new Set(Array.isArray(body.have) ? (body.have as string[]) : []);

  if (deadEnds.length === 0) {
    return NextResponse.json({ candidates: [] });
  }

  const all = entries();
  const buckets = bySyllable();
  const out: Array<{
    w: string;
    p: string;
    fs: string;
    ls: string;
    f: number;
    e: string;
  }> = [];

  for (const syl of deadEnds) {
    // Buckets are ranked by frequency, so the first matches are the ones a
    // learner is most likely to meet again outside the app.
    let taken = 0;
    for (const idx of buckets[syl] ?? []) {
      if (taken >= MAX_PER_SYLLABLE) break;
      const e = all[idx];
      if (have.has(e.w)) continue;
      // Landing somewhere you already leave from is what stops the new word
      // from simply relocating the dead end.
      if (!starts.has(e.ls)) continue;
      out.push({ w: e.w, p: e.p, fs: e.fs, ls: e.ls, f: e.f, e: e.e });
      taken++;
    }
    if (out.length >= MAX_CANDIDATES) break;
  }

  return NextResponse.json({ candidates: out.slice(0, MAX_CANDIDATES) });
}
