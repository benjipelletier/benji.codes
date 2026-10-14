// Talking to /api/chongfuxi from the browser.

import { studyDay } from "./day";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined>;

function url(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return `/api/chongfuxi/${path}${qs ? `?${qs}` : ""}`;
}

async function answer<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `The server answered ${res.status}.`, res.status);
  }
  return res.json() as Promise<T>;
}

export async function get<T>(path: string, query?: Query): Promise<T> {
  return answer(await fetch(url(path, query), { cache: "no-store" }));
}

export async function send<T>(path: string, body: unknown, method: "POST" | "PUT" = "POST", query?: Query): Promise<T> {
  return answer(
    await fetch(url(path, query), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  );
}

/** The study day as this device sees it, as the query every dated request carries. */
export function today(): { day: string; cutoff: number } {
  return studyDay();
}
