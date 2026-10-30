import { NextRequest, NextResponse } from "next/server";
import { ownerOnly, ownersLog } from "../guard";
import { ADD_GOAL_TOP, habitView, setAddGoal } from "../habit";
import { bad, body, dayFrom } from "../params";

export const dynamic = "force-dynamic";

/** The habit of adding words: the daily goal, today, the streak, words worth adding (habit.ts). Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const day = dayFrom(req);
  if (!day) return bad("day and cutoff are required");
  return NextResponse.json(await habitView(gate.sql, gate.owner, day));
}

/** { goal }: words to add a day, 1 to ADD_GOAL_TOP. Owner only. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const goal = (await body<{ goal?: number }>(req))?.goal;
  if (typeof goal !== "number" || !Number.isFinite(goal) || goal < 1 || goal > ADD_GOAL_TOP) return bad(`goal is 1 to ${ADD_GOAL_TOP}`);
  return NextResponse.json({ goal: await setAddGoal(gate.sql, gate.owner, goal) });
}
