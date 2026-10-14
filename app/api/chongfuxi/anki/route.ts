import { NextRequest } from "next/server";
import { ankiHelp } from "../ankiroute";

export const dynamic = "force-dynamic";

/** The bare address, opened in a browser. */
export function GET(req: NextRequest) {
  return ankiHelp(req);
}
