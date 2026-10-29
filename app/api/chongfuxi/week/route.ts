import { NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { latestWeek } from "../week";

export const dynamic = "force-dynamic";

/** The latest weekly debrief from Muse, with its figures. Readable by anyone, like the rest of the log. */
export async function GET() {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json({ week: await latestWeek(gate.sql, gate.owner) });
}
