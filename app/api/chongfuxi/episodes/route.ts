import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { loadDict } from "../dictfile";
import { EpisodeError, gradeEpisodeAnswer, lineWords, listEpisodes, openEpisode } from "../episodes";
import { ownerOnly, ownersLog } from "../guard";
import { bad, body } from "../params";
import { ReadingError } from "../reading";

export const dynamic = "force-dynamic";
// An episode measured against the deck, and a model call to grade an answer.
export const maxDuration = 120;

/** The episodes (names and figures: readable by anyone); with ?id=, one opened for study, and with &line=, that line's words in the corpus (owner only: the subtitles aren't ours to serve). */
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) {
    const gate = ownersLog();
    if ("refused" in gate) return gate.refused;
    return NextResponse.json({ episodes: await listEpisodes(gate.sql, gate.owner, loadDict()) });
  }
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const line = req.nextUrl.searchParams.get("line");
  try {
    // A line's words as they live in the corpus.
    if (line !== null) return NextResponse.json({ words: await lineWords(gate.sql, gate.owner, loadDict(), id, Number(line)) });
    return NextResponse.json({ episode: await openEpisode(gate.sql, gate.owner, loadDict(), id) });
  } catch (e) {
    if (e instanceof EpisodeError) return bad(e.message, 404);
    throw e;
  }
}

/** { id, q, answer }: an answer to one of the episode's questions, graded. Owner only. */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = (await body<{ id?: unknown; q?: unknown; answer?: unknown }>(req)) ?? {};
  if (typeof input.id !== "number" || typeof input.q !== "number" || typeof input.answer !== "string") return bad("give { id, q, answer }");
  try {
    return NextResponse.json({ retell: await gradeEpisodeAnswer(gate.sql, gate.owner, input.id, input.q, input.answer) });
  } catch (e) {
    if (e instanceof ReadingError || e instanceof EpisodeError) return bad(e.message, 422);
    if (e instanceof Anthropic.APIError) return bad(`The model call failed (${e.status ?? "no status"}): ${e.message}`, 502);
    throw e;
  }
}
