// sql.js in the browser, loaded on demand.
//
// The build in public/chongfuxi/vendor is sql.js's own browser bundle, copied
// from node_modules/sql.js/dist (keep the two at the same version). Loading it
// with a script tag keeps it out of the app bundle — it is only needed when a
// backup is being read — and sidesteps the Node-only requires inside it.

import type { SqlJsStatic } from "sql.js";

const VENDOR = "/chongfuxi/vendor";

declare global {
  interface Window {
    initSqlJs?: (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>;
  }
}

let loading: Promise<SqlJsStatic> | null = null;

export function loadSqlJs(): Promise<SqlJsStatic> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    if (window.initSqlJs) return resolve();
    const script = document.createElement("script");
    script.src = `${VENDOR}/sql-wasm.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load the SQLite reader."));
    document.head.appendChild(script);
  })
    .then(() => window.initSqlJs!({ locateFile: (file) => `${VENDOR}/${file}` }))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
