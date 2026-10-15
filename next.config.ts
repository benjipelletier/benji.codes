import type { NextConfig } from "next";

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

export default nextConfig;
