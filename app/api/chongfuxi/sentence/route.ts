import { NextRequest, NextResponse } from "next/server";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";
import { sentenceDetail } from "../review";
import { suspendSentence } from "../suspended";

export const dynamic = "force-dynamic";

/** One sentence in full: its words and how each stands, what blocks it, its card. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return bad("which sentence?");
  const detail = await sentenceDetail(gate.sql, gate.owner, id);
  return detail ? NextResponse.json(detail) : bad("no such sentence", 404);
}

/** { id, action: "suspend" | "resume" }: take the sentence's card out of review, or bring it back. Owner only. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ id?: number; action?: string }>(req);
  const id = Number(input?.id);
  if (!Number.isInteger(id) || id <= 0 || (input?.action !== "suspend" && input?.action !== "resume")) {
    return bad("expected a sentence id and action: suspend or resume");
  }
  return NextResponse.json(await suspendSentence(gate.sql, gate.owner, id, input.action === "suspend"));
}
