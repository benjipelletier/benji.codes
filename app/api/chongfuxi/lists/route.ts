import { NextRequest, NextResponse } from "next/server";
import { AdditionError, addList } from "../additions";
import { loadDict } from "../dictfile";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body, dayFrom } from "../params";
import { listTree, listWords } from "../review";

export const dynamic = "force-dynamic";
// Adding a list unlocks sentences, which re-checks them.
export const maxDuration = 60;

/**
 * The Pleco word lists as a tree, with how much of each is in the deck; with
 * ?list=<path>, that list's words a page at a time. Readable by anyone.
 */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const p = req.nextUrl.searchParams;
  const list = p.get("list");
  // With the study day, each list says how many of its words are due.
  if (!list) return NextResponse.json({ lists: await listTree(gate.sql, gate.owner, dayFrom(req)) });
  const words = await listWords(
    gate.sql,
    gate.owner,
    list,
    Math.max(Number(p.get("offset")) || 0, 0),
    Math.min(Math.max(Number(p.get("limit")) || 300, 1), 500),
  );
  return NextResponse.json({ words });
}

/**
 * Add a list's missing words to the deck, but those in `skip`; or, given
 * `only`, just those. The reply names the addition, to keep or undo.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ list?: string; skip?: string[]; only?: string[] }>(req);
  const list = input?.list;
  const skip = input?.skip ?? [];
  const only = input?.only ?? null;
  const words = (v: unknown) => Array.isArray(v) && v.every((w) => typeof w === "string");
  if (typeof list !== "string" || !list || !words(skip) || (only !== null && !words(only))) {
    return bad("expected a list, and the words to skip or the only ones to add");
  }
  try {
    const made = await addList(gate.sql, gate.owner, list, skip, loadDict(), Date.now(), only);
    return NextResponse.json(made ? { id: made.id, added: made.added.length, unlocked: made.unlocked } : { id: null, added: 0, unlocked: 0 });
  } catch (e) {
    if (e instanceof AdditionError) return bad(e.message, 409);
    throw e;
  }
}
