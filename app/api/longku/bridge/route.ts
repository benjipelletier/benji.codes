import { NextRequest, NextResponse } from "next/server";
import { findBridge } from "@longku/lib/bridge";

export const dynamic = "force-dynamic";

interface Body {
  /** The syllable the chain is stuck on. */
  from?: string;
  /** Syllables the bank can answer, most wanted first. */
  to?: string[];
  /** Words that may not be used — the bank, and the chain so far. */
  exclude?: string[];
}

/**
 * A run of corpus words from `from` to one of `to`.
 *
 * Public, like the syllable lookups: it reads only the corpus, and spectators
 * play the chain too.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const from = typeof body.from === "string" ? body.from : "";
  const to = Array.isArray(body.to) ? body.to.filter((s) => typeof s === "string") : [];
  if (!from || to.length === 0) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }
  const exclude = new Set(
    (Array.isArray(body.exclude) ? body.exclude : [])
      .slice(0, 20_000)
      .filter((w): w is string => typeof w === "string"),
  );

  const path = findBridge(from, to.slice(0, 2000), exclude);
  return NextResponse.json({ path: path ?? [] });
}
