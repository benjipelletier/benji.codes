import { NextRequest, NextResponse } from "next/server";
import { lookupWord, type ChengyuEntry } from "@longku/lib/data";

/** Cap per request so a giant paste can't pin the function. */
const MAX_RUNS = 2000;
/** Longest chengyu we'll try to peel off the front of a run. */
const MAX_WORD = 12;

export interface ResolvedWord {
  w: string;
  p: string;
  fs: string;
  ls: string;
  f: number;
}

function slim(e: ChengyuEntry): ResolvedWord {
  return { w: e.w, p: e.p, fs: e.fs, ls: e.ls, f: e.f };
}

/**
 * Split a run of Han characters into corpus words, longest match first.
 * Returns null unless the *entire* run segments cleanly — a partial match
 * usually means the run was prose, and half-parsing it would quietly inject
 * junk into the user's corpus.
 */
function segment(run: string): ChengyuEntry[] | null {
  const out: ChengyuEntry[] = [];
  let i = 0;
  while (i < run.length) {
    let hit: ChengyuEntry | null = null;
    let len = 0;
    for (let n = Math.min(MAX_WORD, run.length - i); n >= 2; n--) {
      const found = lookupWord(run.slice(i, i + n));
      if (found) {
        hit = found;
        len = n;
        break;
      }
    }
    if (!hit) return null;
    out.push(hit);
    i += len;
  }
  return out.length > 0 ? out : null;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const runs = (body as { runs?: unknown })?.runs;
  if (!Array.isArray(runs)) {
    return NextResponse.json({ error: "expected { runs: string[] }" }, { status: 400 });
  }
  if (runs.length > MAX_RUNS) {
    return NextResponse.json(
      { error: `too many runs (${runs.length}); cap is ${MAX_RUNS}` },
      { status: 413 },
    );
  }

  const found: ResolvedWord[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  for (const raw of runs) {
    if (typeof raw !== "string") continue;
    const parts = segment(raw);
    if (!parts) {
      // Not in the idiom list: 龙库 holds nothing else.
      unknown.push(raw);
      continue;
    }
    for (const e of parts) {
      if (seen.has(e.w)) continue;
      seen.add(e.w);
      found.push(slim(e));
    }
  }

  return NextResponse.json({ found, unknown });
}
