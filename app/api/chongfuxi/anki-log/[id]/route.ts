import { NextRequest, NextResponse } from "next/server";
import { ankiSyncDetail, markSyncSeen } from "../../additions";
import { ownerOnly, ownersLog } from "../../guard";
import { bad, body } from "../../params";

export const dynamic = "force-dynamic";

/** One Anki sync in full: its notes and their outcomes, and the addition it made. Readable by anyone. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return bad("which sync?");
  const detail = await ankiSyncDetail(gate.sql, gate.owner, id);
  return detail ? NextResponse.json(detail) : bad("no such sync", 404);
}

/** Mark the sync's page seen (and every sync before it): it won't open by itself again. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const id = Number((await params).id);
  const input = await body<{ action?: string }>(req);
  if (!Number.isInteger(id) || id <= 0) return bad("which sync?");
  if (input?.action !== "seen") return bad("action must be seen");
  await markSyncSeen(gate.sql, gate.owner, id);
  return NextResponse.json({ ok: true });
}
