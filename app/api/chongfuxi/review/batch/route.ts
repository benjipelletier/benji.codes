import { NextRequest, NextResponse } from "next/server";
import { ownerOnly } from "../../guard";
import { bad, body } from "../../params";
import { ReviewError, isReviewInput, submitReview } from "../../review";
import type { ReviewInput } from "@chongfuxi/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Answers this many at once, each in its own transaction, as if sent one by one. */
const AT_ONCE = 6;

/**
 * A run of answers from Fast review. Each is recorded exactly as a single one
 * would be, so retrying the batch records nothing twice; the reply says which
 * went in and which were refused.
 */
export async function POST(req: NextRequest) {
  const gate = await ownerOnly();
  if ("refused" in gate) return gate.refused;
  const input = await body<{ reviews?: ReviewInput[] }>(req);
  const reviews = input?.reviews;
  if (!Array.isArray(reviews) || reviews.length === 0 || reviews.length > 60 || !reviews.every(isReviewInput)) {
    return bad("expected up to 60 answers");
  }
  const done: string[] = [];
  const refused: Array<{ id: string; why: string }> = [];
  let recallOpened = 0;
  let revived = 0;
  for (let i = 0; i < reviews.length; i += AT_ONCE) {
    await Promise.all(
      reviews.slice(i, i + AT_ONCE).map(async (r) => {
        try {
          const result = await submitReview(gate.sql, gate.owner, r);
          done.push(r.id);
          if (result.produceOpened) recallOpened++;
          revived += result.revived;
        } catch (e) {
          if (!(e instanceof ReviewError)) throw e;
          refused.push({ id: r.id, why: e.message });
        }
      }),
    );
  }
  return NextResponse.json({ done, refused, recallOpened, revived });
}
