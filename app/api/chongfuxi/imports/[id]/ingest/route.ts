import { NextRequest, NextResponse } from "next/server";
import { ingest } from "../../../corpus";
import { loadDict, readPlecoBytes } from "../../../dictfile";
import { ownerOnly } from "../../../guard";
import { getImport, readImport } from "../../../imports";
import { bad } from "../../../params";
import { NotAPlecoBackupError } from "@chongfuxi/lib/pleco";

export const dynamic = "force-dynamic";
// Reading a 16 MB backup and writing a few hundred thousand rows takes a while.
export const maxDuration = 300;

/**
 * Turn a stored file into rows: words, sentences, tokens and cards. With
 * ?dry=1 nothing is written and the answer says what would be added, so the
 * owner sees an import's effect before committing to it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const { id } = await params;
  const imp = await getImport(gate.sql, gate.owner, id);
  if (!imp) return bad("no such import", 404);
  if (!imp.complete) return bad("the file hasn't finished uploading", 409);

  try {
    const { snapshot } = await readPlecoBytes(await readImport(gate.sql, gate.owner, imp));
    const summary = await ingest(gate.sql, gate.owner, snapshot, { importId: imp.id, fileName: imp.fileName }, loadDict(), {
      dryRun: req.nextUrl.searchParams.get("dry") === "1",
    });
    return NextResponse.json(summary);
  } catch (e) {
    if (e instanceof NotAPlecoBackupError) return bad(e.message, 422);
    throw e;
  }
}
