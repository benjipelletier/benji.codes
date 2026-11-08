import { NextResponse } from 'next/server';
import { getDb } from '../db';
import { BUILD, ensureTrainer } from '../schema';

export const dynamic = 'force-dynamic';

const REPO = 'benjipelletier/benji.codes';
/** How long main's newest commit is kept before GitHub is asked again (its API allows 60 an hour without a token). */
const PUSH_TTL_MS = 60_000;
let pushed: { at: number; value: { sha: string; at: string } | null } | null = null;

/**
 * The newest commit on main — a push, the moment it lands, before it's deployed (the owner:
 * "the live symbol … still shows live even though we just pushed and it hasn't been
 * deployed yet"). Kept a minute; null if GitHub can't be reached.
 */
async function latestPush(): Promise<{ sha: string; at: string } | null> {
  if (pushed && Date.now() - pushed.at < PUSH_TTL_MS) return pushed.value;
  let value: { sha: string; at: string } | null = pushed?.value ?? null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
      headers: { accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    });
    if (r.ok) {
      const c = (await r.json()) as { sha: string; commit: { committer: { date: string } } };
      value = { sha: c.sha, at: c.commit.committer.date };
    }
  } catch {
    // Keep the last one heard of.
  }
  pushed = { at: Date.now(), value };
  return value;
}

/**
 * Where the app stands: the newest build the database has seen running (written by each
 * production build's first run), this server's own build, and main's newest commit. The app
 * compares them with the build it's running: live, deploying, or a newer build to reload into.
 */
export async function GET() {
  let latest: { build: string; built_at: string; at: string } | null = null;
  const [push] = await Promise.all([
    latestPush(),
    (async () => {
      try {
        const sql = getDb();
        await ensureTrainer(sql);
        const rows = (await sql`SELECT value FROM voiceshed_meta WHERE key = 'live_build'`) as { value: string }[];
        if (rows[0]) latest = JSON.parse(rows[0].value);
      } catch {
        // No database (or it's down): the server's own build still says what's deployed.
      }
    })(),
  ]);
  return NextResponse.json({ latest, server: BUILD, push }, { headers: { 'Cache-Control': 'no-store' } });
}
