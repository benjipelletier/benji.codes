import { NextRequest, NextResponse } from "next/server";
import { AgentError, MAX_LISTS, agentAllowed, agentLists, agentToken, removeList, writeList, type WrittenList } from "../../agent";
import { loadDict } from "../../dictfile";
import { ownersLog } from "../../guard";
import { bad, body } from "../../params";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The owner's agent (Muse) writing word lists, nested under "Muse". Every
 * method needs `Authorization: Bearer <CHONGFUXI_AGENT_TOKEN>`; without the
 * token, 401, and with the variable unset nothing gets in.
 *
 * GET: every Muse list and its words.
 * POST { lists: [{ path, words, replace? }] }: file each list's words under
 *   it (path "Travel/Airport" or ["Travel", "Airport"], under Muse either
 *   way); replace takes off it what isn't given, and its lists below.
 * DELETE { path }: take a list (and those below it) off every word.
 */
function gate(req: NextRequest) {
  // Unset (or under 32 characters) on the server: say so, so a refused token can be told from a missing one.
  if (!agentToken()) return { refused: NextResponse.json({ error: "agent token not set on the server" }, { status: 503 }) } as const;
  if (!agentAllowed(req)) return { refused: NextResponse.json({ error: "not allowed" }, { status: 401 }) } as const;
  return ownersLog();
}

export async function GET(req: NextRequest) {
  const g = gate(req);
  if ("refused" in g) return g.refused;
  return NextResponse.json({ lists: await agentLists(g.sql, g.owner) });
}

export async function POST(req: NextRequest) {
  const g = gate(req);
  if ("refused" in g) return g.refused;
  const input = await body<{ lists?: Array<{ path?: unknown; words?: unknown; replace?: boolean }> }>(req);
  const lists = input?.lists;
  if (!Array.isArray(lists) || !lists.length) return bad("expected lists: [{ path, words, replace? }]");
  if (lists.length > MAX_LISTS) return bad(`at most ${MAX_LISTS} lists at once`);
  const dict = loadDict();
  const written: WrittenList[] = [];
  try {
    for (const l of lists) written.push(await writeList(g.sql, g.owner, dict, { path: l?.path, words: l?.words, replace: l?.replace === true }));
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message, written }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ written });
}

export async function DELETE(req: NextRequest) {
  const g = gate(req);
  if ("refused" in g) return g.refused;
  const input = await body<{ path?: unknown }>(req);
  try {
    return NextResponse.json(await removeList(g.sql, g.owner, input?.path));
  } catch (e) {
    if (e instanceof AgentError) return bad(e.message);
    throw e;
  }
}
