import { NextRequest, NextResponse } from "next/server";
import type { LearnStepDone } from "@chongfuxi/lib/api";
import { ownerOnly, ownersLog } from "../guard";
import { LEARN_MAX, LEARN_SESSION_MAX, recordSteps, wordsToLearn } from "../learn";
import { bad, body, dayFrom } from "../params";

export const dynamic = "force-dynamic";

const STEPS = ["meet", "context", "cloze", "word"];

/**
 * The next new words to learn, with their sentences and where each is on the
 * ladder: ?list= for one list's (a drill, ten), else the deck's (a review
 * session, more). Readable by anyone.
 */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const list = req.nextUrl.searchParams.get("list") || null;
  return NextResponse.json({ words: await wordsToLearn(gate.sql, gate.owner, list, list ? LEARN_MAX : LEARN_SESSION_MAX) });
}

/** Steps taken: { session, steps: LearnStepDone[] } in the order taken, with the study day in the query. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const day = dayFrom(req);
  if (!day) return bad("day and cutoff are required");
  const b = await body<{ session?: string; steps?: LearnStepDone[] }>(req);
  const steps = b?.steps;
  const fine =
    typeof b?.session === "string" &&
    b.session.length > 0 &&
    b.session.length <= 80 &&
    Array.isArray(steps) &&
    steps.length <= 200 &&
    steps.every(
      (s) =>
        typeof s.id === "string" &&
        s.id.length <= 80 &&
        Number.isInteger(s.card) &&
        typeof s.word === "string" &&
        STEPS.includes(s.step) &&
        (s.next === null || STEPS.includes(s.next)) &&
        (s.sentence === null || Number.isInteger(s.sentence)) &&
        ["good", "forgot", "seen", "known"].includes(s.grade),
    );
  if (!fine) return bad("expected a session and the steps taken");
  return NextResponse.json({ learned: await recordSteps(gate.sql, gate.owner, day, b!.session!, steps!) });
}
