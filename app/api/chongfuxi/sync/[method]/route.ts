import { NextRequest } from "next/server";
import { serveAnki } from "../../ankiroute";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ method: string }> };

/** The Anki endpoint for a Sync URL entered without its last slash (…/anki rather than …/anki/). */
async function handle(req: NextRequest, { params }: Params) {
  return serveAnki(req, "sync", (await params).method);
}

export const POST = handle;
export const GET = handle;
