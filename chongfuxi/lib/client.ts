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

/**
 * No real connection: the network failed, the request ran past its time
 * limit, or something other than the app answered (a plane's or café's
 * sign-in page, which answers every address with its own page). Wi-Fi
 * that is connected but not online does all three (the owner, on a flight).
 */
export class OfflineError extends Error {}

async function answer<T>(res: Response): Promise<T> {
  // The app answers with JSON; a sign-in page in its place means no connection, not an error of ours.
  const json = (res.headers.get("content-type") ?? "").includes("application/json");
  if (!res.ok) {
    if (!json) throw new OfflineError(`No connection (something else answered, ${res.status}).`);
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `The server answered ${res.status}.`, res.status);
  }
  if (!json) throw new OfflineError("No connection (a sign-in page answered).");
  return res.json() as Promise<T>;
}

/** fetch, with an optional time limit; a failure to reach the server is an OfflineError. */
async function call(input: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
  try {
    return await fetch(input, ctrl ? { ...init, signal: ctrl.signal } : init);
  } catch (e) {
    throw new OfflineError(ctrl?.signal.aborted ? "No connection (it took too long)." : `No connection (${e instanceof Error ? e.message : String(e)}).`);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether an error means the server couldn't be reached, rather than that it said no. */
export const isOffline = (e: unknown) => e instanceof OfflineError || e instanceof TypeError || (e instanceof ApiError && e.status >= 500);

export async function get<T>(path: string, query?: Query, opts: { timeoutMs?: number } = {}): Promise<T> {
  return answer(await call(url(path, query), { cache: "no-store" }, opts.timeoutMs));
}

export async function send<T>(path: string, body: unknown, method: "POST" | "PUT" = "POST", query?: Query, opts: { timeoutMs?: number } = {}): Promise<T> {
  return answer(
    await call(url(path, query), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, opts.timeoutMs),
  );
}

/** The study day as this device sees it, as the query every dated request carries. */
export function today(): { day: string; cutoff: number } {
  return studyDay();
}
