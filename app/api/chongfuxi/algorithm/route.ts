import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { bad, dayFrom } from "../params";
import { queueNow } from "../algorithm";

export const dynamic = "force-dynamic";

/** What the queue is doing now, and why: Settings › Algorithm. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const day = dayFrom(req);
  if (!day) return bad("day and cutoff are required");
  return NextResponse.json(await queueNow(gate.sql, gate.owner, day));
}
