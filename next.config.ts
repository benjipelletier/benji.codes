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
    "/api/chongfuxi/anki/[...path]": ["./node_modules/sql.js/dist/sql-wasm.wasm", "./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/sync/[method]": ["./node_modules/sql.js/dist/sql-wasm.wasm", "./chongfuxi/data/cedict.txt"],
    // Its headwords, for picking the sentences a word card is shown in.
    "/api/chongfuxi/session": ["./chongfuxi/data/cedict.txt"],
    "/api/chongfuxi/imports/[id]/ingest": [
      "./node_modules/sql.js/dist/sql-wasm.wasm",
      "./chongfuxi/data/cedict.txt",
    ],
  },
};

export default nextConfig;
