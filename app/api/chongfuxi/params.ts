import { NextRequest, NextResponse } from "next/server";
import { isStudyDay, type StudyDay } from "@chongfuxi/lib/day";

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** The study day the device says it is: ?day=YYYY-MM-DD&cutoff=<ms>. */
export function dayFrom(req: NextRequest): StudyDay | null {
  const p = req.nextUrl.searchParams;
  const day = { day: p.get("day") ?? "", cutoff: Number(p.get("cutoff")) };
  return isStudyDay(day) ? day : null;
}

export const numbers = (csv: string | null): number[] =>
  (csv ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);

export const words = (csv: string | null): string[] => (csv ?? "").split(",").filter(Boolean).slice(0, 500);

export async function body<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
