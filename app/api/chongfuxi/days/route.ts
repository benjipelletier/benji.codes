import { NextRequest, NextResponse } from "next/server";
import { getDays } from "../days";
import { ownersLog } from "../guard";
import { bad, dayFrom } from "../params";

export const dynamic = "force-dynamic";

/** The days either side of today: reviewed before, due after, by kind. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const day = dayFrom(req);
  if (!day) return bad("day and cutoff are required");
  return NextResponse.json(await getDays(gate.sql, gate.owner, day));
}
