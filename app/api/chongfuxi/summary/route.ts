import { NextRequest, NextResponse } from "next/server";
import { getDb, hasDb } from "../db";
import { bad, dayFrom } from "../params";
import { getSummary } from "../review";
import type { Summary } from "@chongfuxi/lib/api";
import { getViewer, ownerEmail } from "@chongfuxi/lib/session";

export const dynamic = "force-dynamic";

const EMPTY = {
  words: 0, characters: 0, wordCards: 0, recallCards: 0, names: 0, sentences: 0, readable: 0, oneAway: 0, locked: 0,
  dueWords: 0, dueRead: 0, dueRecall: 0, dueSentences: 0,
  newSentences: 0, newLeftToday: 0, newPerDay: 10, retired: 0, flagged: 0, answeredToday: 0,
  answeredYesterday: 0, cameDueToday: 0, dueTomorrow: 0,
};

/** Who is asking, and where the deck stands. Readable by anyone. */
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  const owner = ownerEmail();
  if (!hasDb() || !owner) {
    return NextResponse.json({ viewer: { configured: false, ...viewer }, ...EMPTY } satisfies Summary);
  }
  const day = dayFrom(req);
  if (!day) return bad("day and cutoff are required");
  const summary = await getSummary(getDb(), owner, day);
  return NextResponse.json({ viewer: { configured: true, ...viewer }, ...summary } satisfies Summary);
}
