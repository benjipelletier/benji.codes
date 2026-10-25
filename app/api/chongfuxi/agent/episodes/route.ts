import { NextRequest, NextResponse } from "next/server";
import { AgentError, agentGate } from "../../agent";
import { loadDict } from "../../dictfile";
import { EpisodeError, episodeMaterial, listEpisodes, writeEpisode } from "../../episodes";
import { body } from "../../params";

export const dynamic = "force-dynamic";
// An episode's lines split into words and measured against the deck.
export const maxDuration = 60;

/**
 * Episodes of dramas, for the owner's agent (Muse) to bring in and prep
 * (episodes.ts). Same token as agent/lists.
 *
 * GET: every episode, with whether it is prepped. GET ?id=: the material to
 *   prep it from: brief, lines (i, at, zh) and the words not known (count,
 *   pinyin, gloss, the lines they are said in).
 * POST { show, episode, subtitles, english?, title?, source? }: the episode's
 *   Chinese subtitles (SRT best; WebVTT, ASS, or a line each), and English
 *   ones of the same release to pair with them by time (a bilingual file
 *   needs none); the same show and episode again replaces them. Answers with
 *   the material, `english` saying how many lines got a translation.
 */
export async function GET(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  const id = Number(req.nextUrl.searchParams.get("id"));
  try {
    if (id) return NextResponse.json(await episodeMaterial(g.sql, g.owner, loadDict(), id));
    return NextResponse.json({ episodes: await listEpisodes(g.sql, g.owner, loadDict()) });
  } catch (e) {
    if (e instanceof EpisodeError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const g = agentGate(req);
  if ("refused" in g) return g.refused;
  try {
    return NextResponse.json(await writeEpisode(g.sql, g.owner, loadDict(), (await body<Record<string, unknown>>(req)) ?? {}));
  } catch (e) {
    if (e instanceof AgentError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
