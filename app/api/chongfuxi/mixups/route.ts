import { NextResponse } from "next/server";
import { ownersLog } from "../guard";
import { mixupMap } from "../mixups";

export const dynamic = "force-dynamic";

/** The mix-up map: words taken for each other, from notes and lookups (mixups.ts). Readable by anyone, like the notes. */
export async function GET() {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json(await mixupMap(gate.sql, gate.owner));
}
