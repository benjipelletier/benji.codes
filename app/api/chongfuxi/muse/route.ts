import { NextRequest, NextResponse } from "next/server";
import { loadDict } from "../dictfile";
import { ownerOnly } from "../guard";
import { MusePageError, answerAsk, listPages, openPage, recordEvent } from "../musepage";
import { FetchError } from "../fetchtext";
import { ReadingError } from "../reading";
import { bad, body } from "../params";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Muse's daily page (musepage.ts). Owner only, reads too: a page may carry
 * text pulled from the web.
 *
 * GET: `?list=1` the pages; else a day's page (`?day=`, the latest by default), filled in.
 * POST `{ day, block, answer }`: an answer to an ask block, checked now or kept for Muse.
 * POST `{ day, block, kind, data }`: something done on a block.
 */
export async function GET(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const q = req.nextUrl.searchParams;
  if (q.get("list")) return NextResponse.json({ pages: await listPages(gate.sql, gate.owner) });
  return NextResponse.json({ page: await openPage(gate.sql, gate.owner, loadDict(), q.get("day") ?? undefined) });
}

export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = (await body<Record<string, unknown>>(req)) ?? {};
  try {
    if (typeof input.answer === "string") return NextResponse.json(await answerAsk(gate.sql, gate.owner, input));
    await recordEvent(gate.sql, gate.owner, input);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof MusePageError || e instanceof ReadingError || e instanceof FetchError) return bad(e.message);
    throw e;
  }
}
