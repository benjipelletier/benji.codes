import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextConfig } from "next";

// Versions, 0.1.N: N counts the commits that touch a project, so every
// release that changes it goes up by one — 重复习's, and Voiceshed's (which
// writes the one running to its database, so an open app can tell it's
// behind). Counted at build time, by the first of these that works: the
// checkout, when it has the whole history (anywhere but Vercel, which clones
// only the last few commits); a copy of the history alone, cloned from GitHub
// (the repo is public); GitHub's API. The build log says which
// ("重复习 v0.1.N, counted by …").
const REPO = "benjipelletier/benji.codes";
const PROJECTS = {
  chongfuxi: { label: "重复习", paths: ["chongfuxi", "app/chongfuxi", "app/api/chongfuxi"] },
  voiceshed: { label: "Voiceshed", paths: ["voiceshed", "app/voiceshed", "app/api/voiceshed", "public/voiceshed", "public/voiceshed-sw.js"] },
};
type Project = keyof typeof PROJECTS;
type Versions = Record<Project, string> & { commit: string };

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const count = (cwd: string, commit: string, paths: string[]) => Number(git(cwd, "rev-list", "--count", commit, "--", ...paths));

/** Each path's commits up to `commit` from GitHub's API, counted once each. */
async function countByApi(commit: string, paths: string[]): Promise<number> {
  const seen = new Set<string>();
  for (const path of paths) {
    for (let page = 1; ; page++) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/commits?sha=${commit}&path=${path}&per_page=100&page=${page}`, {
        headers: process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const rows = (await r.json()) as Array<{ sha: string }>;
      for (const c of rows) seen.add(c.sha);
      if (rows.length < 100) break;
    }
  }
  return seen.size;
}

async function countVersions(): Promise<Versions> {
  let commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  const failed: string[] = [];
  const names = Object.keys(PROJECTS) as Project[];
  const uncounted = (): Versions => ({ commit, ...(Object.fromEntries(names.map((n) => [n, "0.1"])) as Record<Project, string>) });
  const done = (counted: (n: Project) => number, how: string): Versions => {
    const out = uncounted();
    for (const n of names) {
      out[n] = `0.1.${counted(n)}`;
      console.log(`${PROJECTS[n].label} v${out[n]}, counted by ${how}${failed.length ? ` (${failed.join("; ")})` : ""}`);
    }
    return out;
  };
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 2).join(" ");

  try {
    commit ||= git(".", "rev-parse", "HEAD");
    if (git(".", "rev-parse", "--is-shallow-repository") === "false") return done((n) => count(".", commit, PROJECTS[n].paths), "the checkout");
    failed.push("the checkout is shallow");
  } catch (e) {
    failed.push(`checkout: ${why(e)}`);
  }
  if (!commit) {
    console.log("versions: no commit to count from");
    return uncounted();
  }
  try {
    // The history without file contents: a second or two.
    const dir = mkdtempSync(join(tmpdir(), "benji-history-"));
    git(dir, "clone", "--quiet", "--bare", "--filter=blob:none", `https://github.com/${REPO}.git`, ".");
    return done((n) => count(dir, commit, PROJECTS[n].paths), "a clone of the history");
  } catch (e) {
    failed.push(`clone: ${why(e)}`);
  }
  try {
    const counts = new Map<Project, number>();
    for (const n of names) counts.set(n, await countByApi(commit, PROJECTS[n].paths));
    return done((n) => counts.get(n)!, "GitHub's API");
  } catch (e) {
    failed.push(`API: ${why(e)}`);
  }
  console.log(`versions: not counted (${failed.join("; ")})`);
  return uncounted();
}

export default async function config(): Promise<NextConfig> {
  // The build loads this config in several processes; count once, and pass
  // the result on through the environment they inherit.
  let v: Versions;
  try {
    v = JSON.parse(process.env.BENJI_VERSIONS_COUNTED ?? "") as Versions;
  } catch {
    v = await countVersions();
    process.env.BENJI_VERSIONS_COUNTED = JSON.stringify(v);
  }
  return {
    ...nextConfig,
    env: {
      NEXT_PUBLIC_CHONGFUXI_VERSION: v.chongfuxi,
      NEXT_PUBLIC_CHONGFUXI_COMMIT: v.commit.slice(0, 7),
      NEXT_PUBLIC_VOICESHED_VERSION: v.voiceshed,
      NEXT_PUBLIC_VOICESHED_COMMIT: v.commit.slice(0, 7),
    },
  };
}

const nextConfig: NextConfig = {
  transpilePackages: [
    "d3",
    "d3-force",
    "d3-polygon",
    "react-force-graph-2d",
  ],
  serverExternalPackages: [
    "@neondatabase/serverless",
    "@vercel/kv",
    "@anthropic-ai/sdk",
    "sql.js",
  ],
  // chongfuxi's ingest route reads these from disk at run time, where the
  // bundler can't see them: the SQLite reader's wasm and the dictionary.
  outputFileTracingIncludes: {
    // 龙库 is backed by 重复习: adding a word there adds it to the deck (the
    // dictionary), and anything that changes the deck links chengyu into 龙库
    // (longku's idiom list).
    "/api/longku/bank": ["./chongfuxi/data/cedict.txt", "./longku/data/chengyu.json"],
    "/api/chongfuxi/anki/[...path]": ["./node_modules/sql.js/dist/sql-wasm.wasm", "./chongfuxi/data/cedict.txt", "./longku/data/chengyu.json"],
    "/api/chongfuxi/sync/[method]": ["./node_modules/sql.js/dist/sql-wasm.wasm", "./chongfuxi/data/cedict.txt", "./longku/data/chengyu.json"],
    // Splitting texts into words.
    "/api/chongfuxi/texts": ["./chongfuxi/data/cedict.txt"],
    // Definitions for the words a list adds.
    "/api/chongfuxi/lists": ["./chongfuxi/data/cedict.txt", "./longku/data/chengyu.json"],
    // Its headwords, for picking the sentences a word card is shown in.
    "/api/chongfuxi/session": ["./chongfuxi/data/cedict.txt"],
    // A sentence's words, read from the dictionary when the deck has none.
    "/api/chongfuxi/sentence": ["./chongfuxi/data/cedict.txt"],
    // Look up: the dictionary both ways, the readings of every option, and
    // adding a word from an answer (which links a chengyu into 龙库).
    "/api/chongfuxi/lookup": ["./chongfuxi/data/cedict.txt", "./longku/data/chengyu.json"],
    // A song's lyrics split into words, traditional turned simplified, the new words defined.
    "/api/chongfuxi/lists/spotify": ["./chongfuxi/data/cedict.txt"],
    // Checking the model's pinyin for a word that has none, character by character.
    "/api/chongfuxi/define": ["./chongfuxi/data/cedict.txt"],
    // Removing a word, or undoing an addition, unlinks it from 龙库.
    "/api/chongfuxi/word": ["./longku/data/chengyu.json"],
    "/api/chongfuxi/additions/[id]": ["./longku/data/chengyu.json"],
    // Notes after a Forgot: the words a note names, matched against the dictionary.
    "/api/chongfuxi/notes": ["./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/agent/notes": ["./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/agent/drill": ["./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/word/page": ["./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/rescue": ["./chongfuxi/data/cedict.txt"],
    // The day's story material takes the stuck words, whose mix-up partners are checked against the dictionary.
    "/api/chongfuxi/agent/story": ["./chongfuxi/data/cedict.txt"],
    // The weekly debrief's figures take the stuck words too.
    "/api/chongfuxi/agent/week": ["./chongfuxi/data/cedict.txt"],
    // Episodes: subtitles split into words and measured against the deck, traditional made simplified.
    // A word learnt in Practice and worth keeping goes into the deck, which links a chengyu into 龙库.
    "/api/chongfuxi/episodes": ["./chongfuxi/data/cedict.txt", "./longku/data/chengyu.json"],
    "/api/chongfuxi/agent/episodes": ["./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/agent/episodes/prep": ["./chongfuxi/data/cedict.txt", "./longku/data/chengyu.json"],
    // Muse's daily page: passages split into words and measured, words looked up, the data tools.
    "/api/chongfuxi/muse": ["./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/agent/muse": ["./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/agent/muse/data": ["./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/agent/muse/measure": ["./chongfuxi/data/cedict.txt"],
    // Muse's reading: each page split into words and measured against the deck.
    "/api/chongfuxi/reading": ["./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/agent/reading": ["./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/agent/reading/check": ["./chongfuxi/data/cedict.txt"],
    // iFake Pro's standards library is the jazz project's iReal file, read at run time.
    "/api/ifakepro/standards": ["./jazz/charts_raw/jazz.ireal"],
    "/api/ifakepro/standards/[index]": ["./jazz/charts_raw/jazz.ireal"],
    "/api/ifakepro/playlists": ["./jazz/charts_raw/jazz.ireal"],
    "/api/ifakepro/playlists/[slug]/songs": ["./jazz/charts_raw/jazz.ireal"],
    "/api/chongfuxi/imports/[id]/ingest": [
      "./node_modules/sql.js/dist/sql-wasm.wasm",
      "./chongfuxi/data/cedict.txt",
      "./longku/data/chengyu.json",
    ],
  },
};

