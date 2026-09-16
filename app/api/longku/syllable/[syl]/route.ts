import { NextRequest, NextResponse } from "next/server";
import { bySyllable, topForSyllable } from "@longku/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ syl: string }> },
) {
  const { syl } = await params;
  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(2000, Math.max(1, Number(rawLimit) || 50));
  const list = topForSyllable(syl, limit);
  const total = bySyllable()[syl]?.length ?? 0;
  return NextResponse.json({ syllable: syl, count: total, returned: list.length, chengyus: list });
}
