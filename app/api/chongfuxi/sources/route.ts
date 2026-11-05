import { NextRequest, NextResponse } from "next/server";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";
import { listSources } from "../review";
import { SourceError, renameSource, suspendSource } from "../suspended";

export const dynamic = "force-dynamic";

/** Where the sentences came from, each with how many are readable, one word away, locked and suspended. Readable by anyone. */
export async function GET() {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  return NextResponse.json({ sources: await listSources(gate.sql, gate.owner) });
}

/**
 * { sources: [names], suspend: boolean }: every sentence from those sources
 * suspended, or brought back; { rename, to }: a source renamed (into
 * another, merging them). Owner only.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = (await body<{ sources?: unknown; suspend?: unknown; rename?: unknown; to?: unknown }>(req)) ?? {};
  if (typeof input.rename === "string" && typeof input.to === "string") {
    try {
      return NextResponse.json(await renameSource(gate.sql, gate.owner, input.rename, input.to));
    } catch (e) {
      if (e instanceof SourceError) return bad(e.message, 422);
      throw e;
    }
  }
  const names = Array.isArray(input.sources) ? input.sources.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 200) : [];
  if (!names.length || typeof input.suspend !== "boolean") return bad("give { sources: [names], suspend: true | false }");
  let sentences = 0;
  for (const name of names) sentences += (await suspendSource(gate.sql, gate.owner, name, input.suspend)).sentences;
  return NextResponse.json({ sentences });
}
