import { NextRequest, NextResponse } from "next/server";
import { lookupWord } from "@longku/lib/data";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const word = url.searchParams.get("w");
  if (!word) {
    return NextResponse.json({ error: "missing ?w=" }, { status: 400 });
  }
  const entry = lookupWord(word);
  if (!entry) return NextResponse.json({ found: false }, { status: 404 });
  return NextResponse.json({ found: true, entry });
}
