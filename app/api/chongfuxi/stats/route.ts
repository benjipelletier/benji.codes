import { NextRequest, NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { bad, dayFrom } from "../params";
import { getStats } from "../stats";

export const dynamic = "force-dynamic";

/** What has been reviewed, what is coming and how it is sticking. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const day = dayFrom(req);
  if (!day) return bad("day and cutoff are required");
  const offset = Number(req.nextUrl.searchParams.get("offset")) || 0;
  return NextResponse.json(await getStats(gate.sql, gate.owner, day, Math.max(-960, Math.min(960, Math.round(offset)))));
}
