import { NextResponse } from "next/server";
import { getDb, hasDb, type Sql } from "./db";
import { getViewer, ownerEmail } from "@chongfuxi/lib/session";

export type Guarded = { owner: string; sql: Sql } | { refused: NextResponse };

const unconfigured = () =>
  NextResponse.json({ error: "chongfuxi storage is not configured" }, { status: 503 });

/**
 * For reads: whose log this deployment serves. Anyone may read it, as with
 * 龙库 and jazz — the site shows one person's log and everyone else looks on.
 */
export function ownersLog(): Guarded {
  const owner = ownerEmail();
  if (!hasDb() || !owner) return { refused: unconfigured() };
  return { owner, sql: getDb() };
}

/**
 * For writes: the one gate every route that changes the log goes through.
 * Being signed in isn't enough — anyone can finish the OAuth flow — so this
 * asks whether the session is the owner's.
 */
export async function ownerOnly(): Promise<Guarded> {
  const log = ownersLog();
  if ("refused" in log) return log;
  const viewer = await getViewer();
  if (!viewer.isOwner) {
    return {
      refused: viewer.email
        ? NextResponse.json({ error: "Only the owner can change this log" }, { status: 403 })
        : NextResponse.json({ error: "Sign in first" }, { status: 401 }),
    };
  }
  return log;
}
