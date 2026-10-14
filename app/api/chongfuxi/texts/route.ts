import { NextRequest, NextResponse } from "next/server";
import { readText } from "@chongfuxi/lib/texts";
import { ingestSentences, type LooseSentence } from "../corpus";
import { loadDict } from "../dictfile";
import { ownerOnly } from "../guard";
import { bad, body } from "../params";

export const dynamic = "force-dynamic";
// Adding re-checks which sentences are readable, all of them.
export const maxDuration = 60;

/** A request's text, at most: a book's worth of lessons, well under the 4.5 MB a request may carry. */
const TEXT_MAX = 3_000_000;
const FILES_MAX = 500;

/**
 * Plain Chinese texts (textbook lessons, articles) into the corpus as
 * sentences, under one source name. Sentences only: no word is added to the
 * deck or changed, so a sentence becomes readable as its words are learnt.
 * With dryRun, only what it would do.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ source?: string; files?: Array<{ name?: string; text?: string }>; dryRun?: boolean }>(req);
  const source = typeof input?.source === "string" ? input.source.trim().slice(0, 80) : "";
  const files = Array.isArray(input?.files) ? input.files : [];
  if (!source) return bad("name the source: it is shown on each sentence's card");
  if (!files.length || files.length > FILES_MAX || !files.every((f) => typeof f.text === "string" && typeof f.name === "string")) {
    return bad(`expected 1 to ${FILES_MAX} text files`);
  }
  if (files.reduce((n, f) => n + f.text!.length, 0) > TEXT_MAX) return bad("too much text at once: split it into smaller files");

  const read = files.map((f) => readText({ name: f.name!, text: f.text! }));
  const sentences: LooseSentence[] = read.flatMap((t) => t.sentences.map((zh) => ({ zh, pinyin: "", en: null, source })));
  const out = await ingestSentences(gate.sql, gate.owner, sentences, loadDict(), {
    dryRun: input?.dryRun === true,
    samples: 8,
    sampleEvery: Math.max(7, Math.round(sentences.length / 8)),
  });
  return NextResponse.json({
    files: read.length,
    titles: read.map((t) => t.title).filter(Boolean),
    ...out.total,
    samples: out.samples,
    done: input?.dryRun !== true,
  });
}
