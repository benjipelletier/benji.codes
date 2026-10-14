import { NextRequest, NextResponse } from "next/server";
import type { BugContext } from "@chongfuxi/lib/api";
import { BUG_IMAGE_MAX, fileBug, listBugs } from "../bugs";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";

export const dynamic = "force-dynamic";

/** Bug reports, newest first: the open ones, or every one with ?all=1. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const all = req.nextUrl.searchParams.get("all") === "1";
  return NextResponse.json({ bugs: await listBugs(gate.sql, gate.owner, all) });
}

/** File a bug: what went wrong, what the app knew, and a screenshot as a data URL. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ text?: string; context?: BugContext; image?: string | null }>(req);
  const text = typeof input?.text === "string" ? input.text.trim().slice(0, 4000) : "";
  if (!input || typeof input.context !== "object" || input.context === null) return bad("expected a report");
  let image: { data: string; type: string } | null = null;
  if (typeof input.image === "string" && input.image) {
    const m = input.image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return bad("the screenshot must be a JPEG, PNG or WebP data URL");
    if ((m[2].length * 3) / 4 > BUG_IMAGE_MAX) return bad("the screenshot is too big");
    image = { type: m[1], data: m[2] };
  }
  if (!text && !image) return bad("say what went wrong, or attach a screenshot");
  const id = await fileBug(gate.sql, gate.owner, { text, context: input.context, image });
  return NextResponse.json({ id });
}
