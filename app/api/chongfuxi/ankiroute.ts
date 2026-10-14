// Serving the Anki sync endpoint over HTTP, for the routes that expose it.
//
// AnkiDroid joins "sync/<method>" onto the Sync URL as a relative path, so
// https://benji.codes/api/chongfuxi/anki/ gives /api/chongfuxi/anki/sync/meta,
// but without its last slash it gives /api/chongfuxi/sync/meta. Both are served.

import { after, NextRequest, NextResponse } from "next/server";
import { handleAnki } from "./anki";
import { ownersLog } from "./guard";

export async function serveAnki(req: NextRequest, kind: string, method: string): Promise<NextResponse> {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const user = process.env.CHONGFUXI_ANKI_USER;
  const password = process.env.CHONGFUXI_ANKI_PASSWORD;
  const body = req.method === "POST" ? new Uint8Array(await req.arrayBuffer()) : new Uint8Array();
  const out = await handleAnki(
    { sql: gate.sql, owner: gate.owner, credentials: user && password ? { user, password } : null },
    kind,
    method,
    req.headers.get("anki-sync"),
    body,
    req.nextUrl.searchParams,
  );
  // New notes become words once AnkiDroid has its answer, not before.
  if (out.afterwards) after(out.afterwards);
  return new NextResponse(Buffer.from(out.body), { status: out.status, headers: out.headers });
}

/** What a browser sees at the bare address: what it is, and what to put in AnkiDroid. */
export function ankiHelp(req: NextRequest): NextResponse {
  const base = `${req.nextUrl.origin}/api/chongfuxi/anki/`;
  return new NextResponse(
    `This is 重复习's Anki sync endpoint. It answers AnkiDroid, not browsers.\n\n` +
      `In AnkiDroid: Settings > Sync > Advanced > Custom sync server > Sync URL:\n${base}\n`,
    { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
