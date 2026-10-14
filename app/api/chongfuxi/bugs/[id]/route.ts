import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { BugStatus } from "@chongfuxi/lib/api";
import { BUG_STATUSES, bugImage, listBugs, setBugStatus } from "../../bugs";
import { ownerOnly, ownersLog } from "../../guard";
import { bad, body } from "../../params";

export const dynamic = "force-dynamic";

const idOf = async (params: Promise<{ id: string }>) => {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** One report; with ?image=1, its screenshot as an image. Readable by anyone. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const id = await idOf(params);
  if (id === null) return bad("which bug?");
  if (req.nextUrl.searchParams.get("image") === "1") {
    const img = await bugImage(gate.sql, gate.owner, id);
    if (!img) return bad("no screenshot", 404);
    return new NextResponse(new Uint8Array(img.bytes), { headers: { "Content-Type": img.type, "Cache-Control": "private, max-age=86400" } });
  }
  const bug = (await listBugs(gate.sql, gate.owner, true)).find((b) => b.id === id);
  return bug ? NextResponse.json({ bug }) : bad("no such bug", 404);
}

/** The token a Claude session closes bugs with, sent as `Authorization: Bearer <token>`. */
function hasToken(req: NextRequest): boolean {
  const want = process.env.CHONGFUXI_BUGS_TOKEN;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!want || !got || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/** Close a report, or open it again: { status, note }. The owner, or a session holding the token. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const log = ownersLog();
  if ("refused" in log) return log.refused;
  const gate = hasToken(req) ? log : await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const id = await idOf(params);
  const input = await body<{ status?: BugStatus; note?: string }>(req);
  if (id === null || !input?.status || !BUG_STATUSES.includes(input.status)) return bad("expected a status: open, fixed or wontfix");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 2000) || null : null;
  const ok = await setBugStatus(gate.sql, gate.owner, id, input.status, note);
  return ok ? NextResponse.json({ ok: true }) : bad("no such bug", 404);
}
