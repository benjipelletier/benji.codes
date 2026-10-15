import { NextRequest, NextResponse } from "next/server";
import { TEXT_MAX, analyse, getText, listTexts, saveText, titleOf } from "../analyse";
import { loadDict } from "../dictfile";
import { FetchError, fetchPage } from "../fetchtext";
import { ownerOnly, ownersLog } from "../guard";
import { fetchCaptions, videoId } from "../youtube";
import { bad, body } from "../params";

export const dynamic = "force-dynamic";
// A long page: fetched, split and matched against every word.
export const maxDuration = 60;

/** The texts analysed, newest first; with ?id=, one of them analysed against what is known now. Readable by anyone. */
export async function GET(req: NextRequest) {
  const gate = ownersLog();
  if ("refused" in gate) return gate.refused;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!id) return NextResponse.json({ texts: await listTexts(gate.sql, gate.owner) });
  const t = await getText(gate.sql, gate.owner, id);
  if (!t) return bad("no such text", 404);
  return NextResponse.json(await analyse(gate.sql, gate.owner, loadDict(), t));
}

/**
 * Analyse a text: { text } pasted, or { url } of a web page or a YouTube
 * video (its Chinese captions). The owner's are
 * kept in the history; anyone may analyse pasted text, but only the owner
 * may have a page fetched.
 */
export async function POST(req: NextRequest) {
  const owner = await ownerOnly();
  const isOwner = !("refused" in owner);
  const gate = isOwner ? owner : ownersLog();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ text?: string; url?: string }>(req);

  let text: string;
  let title: string | null;
  let url: string | null = null;
  let kind: "paste" | "web" | "youtube" = "paste";
  if (typeof input?.url === "string" && input.url.trim()) {
    if (!isOwner) return owner.refused;
    try {
      // A YouTube link: its Chinese captions. Any other: the page's text.
      const video = videoId(input.url);
      const got = video ? await fetchCaptions(video) : await fetchPage(input.url);
      ({ text, title, url } = got);
      kind = video ? "youtube" : "web";
    } catch (e) {
      if (e instanceof FetchError) return bad(e.message, 422);
      throw e;
    }
  } else if (typeof input?.text === "string" && input.text.trim()) {
    text = input.text.trim();
    title = titleOf(text);
  } else {
    return bad("paste a text, or give a link");
  }
  if (text.length > TEXT_MAX) text = text.slice(0, TEXT_MAX);

  const kept = isOwner ? await saveText(gate.sql, gate.owner, { kind, title, url, text }) : null;
  return NextResponse.json(await analyse(gate.sql, gate.owner, loadDict(), { text, kind, title, url, id: kept?.id ?? null, at: kept?.at }));
}
