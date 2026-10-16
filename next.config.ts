import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextConfig } from "next";

// 重复习's version, 0.1.N: N counts the commits that touch it, so every
// release that changes it goes up by one. Counted at build time, by the first
// of these that works: the checkout, when it has the whole history (anywhere
// but Vercel, which clones only the last few commits); a copy of the history
// alone, cloned from GitHub (the repo is public); GitHub's API. The build log
// says which ("重复习 v0.1.N, counted by …").
const REPO = "benjipelletier/benji.codes";
const CHONGFUXI_PATHS = ["chongfuxi", "app/chongfuxi", "app/api/chongfuxi"];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const count = (cwd: string, commit: string) => Number(git(cwd, "rev-list", "--count", commit, "--", ...CHONGFUXI_PATHS));

/** Each path's commits up to `commit` from GitHub's API, counted once each. */
async function countByApi(commit: string): Promise<number> {
  const seen = new Set<string>();
  for (const path of CHONGFUXI_PATHS) {
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

async function chongfuxiVersion(): Promise<{ version: string; commit: string }> {
  let commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  const failed: string[] = [];
  const done = (n: number, how: string) => {
    console.log(`重复习 v0.1.${n}, counted by ${how}${failed.length ? ` (${failed.join("; ")})` : ""}`);
    return { version: `0.1.${n}`, commit };
  };
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 2).join(" ");

  try {
    commit ||= git(".", "rev-parse", "HEAD");
    if (git(".", "rev-parse", "--is-shallow-repository") === "false") return done(count(".", commit), "the checkout");
    failed.push("the checkout is shallow");
  } catch (e) {
    failed.push(`checkout: ${why(e)}`);
  }
  if (!commit) {
    console.log("重复习 v0.1: no commit to count from");
    return { version: "0.1", commit };
  }
  try {
    // The history without file contents: a second or two.
    const dir = mkdtempSync(join(tmpdir(), "chongfuxi-history-"));
    git(dir, "clone", "--quiet", "--bare", "--filter=blob:none", `https://github.com/${REPO}.git`, ".");
    return done(count(dir, commit), "a clone of the history");
  } catch (e) {
    failed.push(`clone: ${why(e)}`);
  }
  try {
    return done(await countByApi(commit), "GitHub's API");
  } catch (e) {
    failed.push(`API: ${why(e)}`);
  }
  console.log(`重复习 v0.1: not counted (${failed.join("; ")})`);
  return { version: "0.1", commit };
}

export default async function config(): Promise<NextConfig> {
  // The build loads this config in several processes; count once, and pass
  // the result on through the environment they inherit.
  const known = process.env.CHONGFUXI_VERSION_COUNTED?.split(" ");
  const { version, commit } = known?.length === 2 ? { version: known[0], commit: known[1] } : await chongfuxiVersion();
  process.env.CHONGFUXI_VERSION_COUNTED = `${version} ${commit}`;
  return {
    ...nextConfig,
    env: {
      NEXT_PUBLIC_CHONGFUXI_VERSION: version,
      NEXT_PUBLIC_CHONGFUXI_COMMIT: commit.slice(0, 7),
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
    "/api/chongfuxi/imports/[id]/ingest": [
      "./node_modules/sql.js/dist/sql-wasm.wasm",
      "./chongfuxi/data/cedict.txt",
      "./longku/data/chengyu.json",
    ],
  },
};

