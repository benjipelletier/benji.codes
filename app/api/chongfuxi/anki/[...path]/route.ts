import { NextRequest, NextResponse } from "next/server";
import { handleAnki, type AnkiReply } from "../../anki";
import { ownersLog } from "../../guard";

export const dynamic = "force-dynamic";
// A whole collection comes in one request on every sync.
export const maxDuration = 60;

/**
 * AnkiDroid's custom sync server: point it at https://<host>/api/chongfuxi/anki/
 * and it calls sync/<method> and msync/<method> under it. See ../../anki.ts.
 */
async function handle(req: NextRequest, params: Promise<{ path: string[] }>): Promise<NextResponse> {
  const { path } = await params;
  const [kind, method] = path;
  if (path.length !== 2 || !kind || !method) return new NextResponse("not found", { status: 404 });
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const user = process.env.CHONGFUXI_ANKI_USER;
  const password = process.env.CHONGFUXI_ANKI_PASSWORD;
  const body = req.method === "POST" ? new Uint8Array(await req.arrayBuffer()) : new Uint8Array();
  const out: AnkiReply = await handleAnki(
    { sql: gate.sql, owner: gate.owner, credentials: user && password ? { user, password } : null },
    kind,
    method,
    req.headers.get("anki-sync"),
    body,
    req.nextUrl.searchParams,
  );
  return new NextResponse(Buffer.from(out.body), { status: out.status, headers: out.headers });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handle(req, params);
}

/** Old clients start media sync with a GET. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return handle(req, params);
}
