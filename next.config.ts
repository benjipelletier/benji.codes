import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";

// 重复习's version, 0.1.N: N counts the commits that touch it, so every
// release that changes it goes up by one. Counted at build time. Vercel clones
// only the last few commits, so the history is fetched in full first (the
// repo is public); failing that, GitHub's API counts them.
const CHONGFUXI_PATHS = ["chongfuxi", "app/chongfuxi", "app/api/chongfuxi"];

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

async function chongfuxiVersion(): Promise<{ version: string; commit: string }> {
  let commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  try {
    commit ||= git("rev-parse", "HEAD");
    if (git("rev-parse", "--is-shallow-repository") === "true" && process.env.VERCEL) {
      git("fetch", "--quiet", "--unshallow");
    }
    if (git("rev-parse", "--is-shallow-repository") === "false") {
      return { version: `0.1.${git("rev-list", "--count", "HEAD", "--", ...CHONGFUXI_PATHS)}`, commit };
    }
  } catch {
    // No git, or the fetch failed: ask GitHub.
  }
  try {
    // One commit a page, so the last page's number is the count. The API
    // takes one path, so this counts chongfuxi/ alone, a few short.
    const r = await fetch(
      `https://api.github.com/repos/benjipelletier/benji.codes/commits?sha=${commit || "main"}&path=chongfuxi&per_page=1`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const last = r.headers.get("link")?.match(/[?&]page=(\d+)>; rel="last"/)?.[1];
    if (r.ok && last) return { version: `0.1.${last}`, commit };
  } catch {
    // Offline.
  }
  return { version: "0.1", commit };
}

export default async function config(): Promise<NextConfig> {
  const { version, commit } = await chongfuxiVersion();
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

