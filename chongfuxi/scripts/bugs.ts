// Pull the bugs filed from the app (the bug tab on every screen) into this
// checkout, to fix them. Each report becomes .bugs/<id>.md (what was written,
// where, the card or list on screen, recent errors) and, with a screenshot,
// .bugs/<id>.jpg, which can be opened to look at. .bugs/ is ignored by git.
//
//   npx tsx chongfuxi/scripts/bugs.ts                 the open ones
//   npx tsx chongfuxi/scripts/bugs.ts --all           closed ones too
//   npx tsx chongfuxi/scripts/bugs.ts --close 12 fixed "what was done"
//                                                     (or wontfix, or open;
//                                                     needs CHONGFUXI_BUGS_TOKEN)
//
// Reads https://benji.codes, or CHONGFUXI_URL. The host must be reachable: in
// a Claude cloud session, benji.codes has to be in the environment's allowed
// domains.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BugReport } from "../lib/api";

// Node's fetch only goes through a proxy when told to at start (a Claude
// cloud session has one): start again, told.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" },
  });
  process.exit(r.status ?? 1);
}

const base = (process.env.CHONGFUXI_URL ?? "https://benji.codes").replace(/\/$/, "");
const api = `${base}/api/chongfuxi`;
const out = join(process.cwd(), ".bugs");
const args = process.argv.slice(2);

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

async function close(id: number, status: string, note: string | undefined) {
  const token = process.env.CHONGFUXI_BUGS_TOKEN;
  if (!token) throw new Error("Closing a bug from here needs CHONGFUXI_BUGS_TOKEN (the same value as on Vercel).");
  await json(
    await fetch(`${api}/bugs/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, note }),
    }),
  );
  console.log(`Bug #${id} is ${status}.`);
}

function markdown(b: BugReport): string {
  const c = b.context;
  return [
    `# Bug #${b.id}: ${b.status}`,
    "",
    `Filed ${new Date(b.at).toISOString()} from **${c.screen}** (${c.url})`,
    "",
    "## What the owner wrote",
    "",
    b.text ? b.text.split("\n").map((l) => `> ${l}`).join("\n") : "_Nothing: just the screenshot._",
    "",
    b.hasImage ? `Screenshot: \`.bugs/${b.id}.jpg\` (drawn from the page, not the phone's own capture)` : "No screenshot.",
    "",
    "## On screen",
    "",
    "```json",
    JSON.stringify(c.state, null, 2),
    "```",
    "",
    `Viewport ${c.viewport.width}×${c.viewport.height} @${c.viewport.dpr}x, ${c.theme} theme, build ${c.build ?? "unknown"}, ${c.pending} answers waiting to send.`,
    "",
    c.userAgent,
    "",
    "## Recent errors",
    "",
    c.errors.length ? c.errors.map((e) => `- ${new Date(e.at).toISOString()} ${e.message}`).join("\n") : "None.",
    ...(b.note ? ["", "## What was done", "", b.note] : []),
    "",
  ].join("\n");
}

async function pull(all: boolean) {
  const { bugs } = await json<{ bugs: BugReport[] }>(await fetch(`${api}/bugs${all ? "?all=1" : ""}`));
  mkdirSync(out, { recursive: true });
  for (const b of bugs) {
    writeFileSync(join(out, `${b.id}.md`), markdown(b));
    if (b.hasImage) {
      const res = await fetch(`${api}/bugs/${b.id}?image=1`);
      if (res.ok) writeFileSync(join(out, `${b.id}.jpg`), Buffer.from(await res.arrayBuffer()));
    }
  }
  if (!bugs.length) return console.log(all ? "No bugs filed." : "No open bugs.");
  console.log(`${bugs.length} ${all ? "" : "open "}bug${bugs.length === 1 ? "" : "s"}, written to .bugs/:\n`);
  for (const b of bugs) {
    const what = (b.text || "(screenshot only)").replace(/\s+/g, " ");
    console.log(`#${b.id}  ${b.status.padEnd(7)} ${b.context.screen.padEnd(18)} ${what.length > 90 ? `${what.slice(0, 89)}…` : what}`);
  }
}

(async () => {
  const at = args.indexOf("--close");
  if (at >= 0) return close(Number(args[at + 1]), args[at + 2] ?? "fixed", args[at + 3]);
  await pull(args.includes("--all"));
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
