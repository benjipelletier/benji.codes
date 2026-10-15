import { NextRequest, NextResponse } from "next/server";
import { searchCorpus } from "@longku/lib/data";

/** Words in the idiom list matching a query, by characters or pinyin. 龙库 holds nothing else. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 40);
  const limit = Math.min(30, Number(url.searchParams.get("limit") ?? 10) || 10);
  if (!q.trim()) return NextResponse.json({ hits: [] });

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

  return NextResponse.json({ hits });
}
