import { NextRequest, NextResponse } from "next/server";
import { AdditionError, addWords } from "../../additions";
import { getText } from "../../analyse";
import { ingestSentences } from "../../corpus";
import { loadDict } from "../../dictfile";
import { ownerOnly } from "../../guard";
import { bad, body } from "../../params";
import { splitSentences } from "@chongfuxi/lib/texts";

export const dynamic = "force-dynamic";
// Adding words or sentences re-checks which sentences are readable.
export const maxDuration = 60;

/** Words a text may add at once, as a list may. */
const ADD_MAX = 500;

/**
 * Act on a kept text: { action: "add", words } puts words in the deck (one
 * addition, to keep or undo); { action: "save", source } adds its sentences
 * to the corpus under that name; { action: "delete" } drops it from the history.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const id = Number((await params).id);
  const t = Number.isInteger(id) ? await getText(gate.sql, gate.owner, id) : null;
  if (!t) return bad("no such text", 404);
  const input = await body<{ action?: string; words?: string[]; source?: string }>(req);

  if (input?.action === "add") {
    const words = Array.isArray(input.words) ? input.words.filter((w) => typeof w === "string" && w.length <= 20) : [];
    if (!words.length || words.length > ADD_MAX) return bad(`expected 1 to ${ADD_MAX} words`);
    try {
      const added = await addWords(gate.sql, gate.owner, `text:${t.title ?? id}`, words, loadDict());
      return NextResponse.json({ id: added?.id ?? null, added: added?.added ?? [] });
    } catch (e) {
      if (e instanceof AdditionError) return bad(e.message, 409);
      throw e;
    }
  }

  if (input?.action === "save") {
    const source = typeof input.source === "string" ? input.source.trim().slice(0, 80) : "";
    if (!source) return bad("name the source: it is shown on each sentence's card");
    const sentences = t.text
      .split(/\n+/)
      .flatMap((line) => splitSentences(line.trim()))
      .map((zh) => ({ zh, pinyin: "", en: null, source }));
    const out = await ingestSentences(gate.sql, gate.owner, sentences, loadDict());
    await gate.sql`update chongfuxi_text set saved_as = ${source} where owner_email = ${gate.owner} and id = ${id}`;
    return NextResponse.json({ ...out.total, savedAs: source });
  }

  if (input?.action === "delete") {
    await gate.sql`delete from chongfuxi_text where owner_email = ${gate.owner} and id = ${id}`;
    return NextResponse.json({ ok: true });
  }

  return bad("expected an action: add, save or delete");
}
