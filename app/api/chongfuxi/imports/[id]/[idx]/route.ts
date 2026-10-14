import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../../../guard";
import { getImport, putChunk } from "../../../imports";
import { bad } from "../../../params";
import { CHUNK_BYTES } from "@chongfuxi/lib/upload";

export const dynamic = "force-dynamic";

/** Store one chunk of a file announced through POST /api/chongfuxi/imports. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; idx: string }> }) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const { id, idx } = await params;
  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0) return bad("bad chunk index");

  const imp = await getImport(gate.sql, gate.owner, id);
  if (!imp) return bad("announce the import first", 404);
  if (n >= imp.chunks) return bad("chunk index past the end");

  const data = new Uint8Array(await req.arrayBuffer());
  if (!data.byteLength) return bad("empty chunk");
  if (data.byteLength > CHUNK_BYTES) return bad("chunk too large", 413);

  return NextResponse.json({ ok: true, complete: await putChunk(gate.sql, gate.owner, id, n, data) });
}
