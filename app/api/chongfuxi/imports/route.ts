import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../guard";
import { createImport, getImport, listImports } from "../imports";
import { bad, body } from "../params";
import { MAX_CHUNKS, type ImportDescriptor } from "@chongfuxi/lib/upload";

export const dynamic = "force-dynamic";

function isDescriptor(d: unknown): d is ImportDescriptor {
  if (!d || typeof d !== "object") return false;
  const x = d as Record<string, unknown>;
  return (
    typeof x.id === "string" &&
    x.id.length > 0 &&
    x.id.length <= 64 &&
    typeof x.at === "number" &&
    typeof x.fileName === "string" &&
    x.fileName.length <= 300 &&
    (x.sha256 === null || typeof x.sha256 === "string") &&
    (x.format === "pqb" || x.format === "xml") &&
    (x.encoding === "gzip" || x.encoding === "identity") &&
    typeof x.bytes === "number" &&
    x.bytes >= 0 &&
    Number.isInteger(x.chunks) &&
    (x.chunks as number) >= 1 &&
    (x.chunks as number) <= MAX_CHUNKS
  );
}

/** The files imported so far. The owner's only: a file is not served to visitors. */
export async function GET() {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json({ imports: await listImports(gate.sql, gate.owner) });
}

/**
 * Announce a file: what it is and how many chunks to expect. The chunks follow
 * one request each (./[id]/[idx]); then ./[id]/ingest turns it into rows.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const d = await body<unknown>(req);
  if (!isDescriptor(d)) return bad("not an import descriptor");
  await createImport(gate.sql, gate.owner, d);
  return NextResponse.json({ ok: true, import: await getImport(gate.sql, gate.owner, d.id) });
}
