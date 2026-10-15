import { NextRequest, NextResponse } from "next/server";
import type { LearnResult } from "@chongfuxi/lib/api";
import { ownerOnly, ownersLog } from "../guard";
import { LEARN_MAX, finishLearning, wordsToLearn } from "../learn";
import { bad, body, dayFrom } from "../params";

export const dynamic = "force-dynamic";

const STEPS = new Set(["meet", "context", "cloze", "word"]);

/** The next new words to learn (?list= for one list's), with their sentences. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const list = req.nextUrl.searchParams.get("list") || null;
  return NextResponse.json({
    words: await wordsToLearn(gate.sql, gate.owner, list, LEARN_MAX),
  });
}

/** Words through Learn: { session, words: LearnResult[] }, with the study day in the query. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const day = dayFrom(req);
  if (!day) return bad("day and cutoff are required");
  const b = await body<{ session?: string; words?: LearnResult[] }>(req);
  const words = b?.words;
  const fine =
    typeof b?.session === "string" &&
    b.session.length > 0 &&
    b.session.length <= 80 &&
    Array.isArray(words) &&
    words.length <= LEARN_MAX &&
    words.every(
      (w) =>
        Number.isInteger(w.card) &&
        typeof w.word === "string" &&
        Number.isInteger(w.misses) &&
        Array.isArray(w.steps) &&
        w.steps.length <= 100 &&
        w.steps.every(
          (s) =>
            STEPS.has(s.step) && ["good", "forgot", "seen"].includes(s.grade),
        ),
    );
  if (!fine) return bad("expected a session and the words learned");
  return NextResponse.json({
    learned: await finishLearning(
      gate.sql,
      gate.owner,
      day,
      b!.session!,
      words!,
    ),
  });
}
