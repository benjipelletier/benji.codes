import { NextRequest, NextResponse } from "next/server";
import { ankiHelp, serveAnki } from "../../ankiroute";

export const dynamic = "force-dynamic";
// A whole collection comes in one request on every sync.
export const maxDuration = 60;

type Params = { params: Promise<{ path: string[] }> };

/**
 * AnkiDroid's custom sync server: point it at https://<host>/api/chongfuxi/anki/
 * and it calls sync/<method> and msync/<method> under it. See ../../anki.ts.
 */
async function handle(req: NextRequest, { params }: Params): Promise<NextResponse> {
  const { path } = await params;
  const [kind, method] = path;
  if (path.length !== 2 || !kind || !method) return req.method === "GET" ? ankiHelp(req) : new NextResponse("not found", { status: 404 });
  return serveAnki(req, kind, method);
}

export const POST = handle;
/** Old clients start media sync with a GET; a browser gets the help text. */
export const GET = handle;
