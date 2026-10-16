import { NextRequest, NextResponse } from "next/server";
import { loadDict } from "../../dictfile";
import { ownerOnly } from "../../guard";
import { bad, body } from "../../params";
import { SongError, addSong } from "../../spotify";

export const dynamic = "force-dynamic";
// Spotify's page, then LRCLIB, then the words written.
export const maxDuration = 60;

/**
 * { link, lyrics? }: file a Spotify song's words as a list. Without lyrics
 * they are looked up; when none are found the reply asks for them
 * ({ needLyrics, title, artist }), to send again with them pasted.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ link?: unknown; lyrics?: unknown }>(req);
  if (!input || typeof input.link !== "string" || !input.link.trim() || input.link.length > 300) return bad("a Spotify song link");
  if (input.lyrics !== undefined && (typeof input.lyrics !== "string" || input.lyrics.length > 20_000)) return bad("lyrics as text");
  try {
    return NextResponse.json(await addSong(gate.sql, gate.owner, loadDict(), { link: input.link.trim(), lyrics: (input.lyrics as string | undefined) ?? null }));
  } catch (e) {
    if (e instanceof SongError) return bad(e.message, 422);
    console.error("song failed", e);
    return bad(`Adding the song failed: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
}
