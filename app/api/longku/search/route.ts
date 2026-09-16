import { NextRequest, NextResponse } from "next/server";
import { guessFirstSyllable, guessLastSyllable, searchCorpus } from "@longku/lib/data";

const HAS_HAN = /[㐀-䶿一-鿿]/;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 40);
  const limit = Math.min(30, Number(url.searchParams.get("limit") ?? 10) || 10);
  if (!q.trim()) return NextResponse.json({ hits: [], offCorpus: null });

  const hits = searchCorpus(q, limit).map((h) => ({
    w: h.w,
    p: h.p,
    fs: h.fs,
    ls: h.ls,
    f: h.f,
    e: h.e,
    via: h.via,
    variants: h.variants ?? [],
  }));

  // A run of Han the corpus doesn't hold is likelier a gap in the word list
  // than a mistake, so offer it with guessed readings rather than nothing.
  let offCorpus: { w: string; fs: string; ls: string | null; ambiguous: boolean } | null = null;
  const trimmed = q.trim();
  if (
    HAS_HAN.test(trimmed) &&
    trimmed.length >= 3 &&
    trimmed.length <= 9 &&
    !hits.some((h) => h.w === trimmed)
  ) {
    const head = guessFirstSyllable(trimmed);
    const tail = guessLastSyllable(trimmed);
    if (head) {
      offCorpus = { w: trimmed, fs: head.fs, ls: tail ? tail.fs : null, ambiguous: head.ambiguous };
    }
  }

  return NextResponse.json({ hits, offCorpus });
}
