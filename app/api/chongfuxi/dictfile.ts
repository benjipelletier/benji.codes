// The dictionary and the SQLite reader, loaded from disk on the server.
// Both are only needed when a Pleco file is being turned into rows.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { readBackup, type BackupFormat } from "@chongfuxi/lib/backup";
import { parseDict, type Dict } from "@chongfuxi/lib/dict";
import type { PlecoSnapshot } from "@chongfuxi/lib/pleco";

let dict: Dict | null = null;

/** CC-CEDICT, from chongfuxi/data/cedict.txt (see scripts/build-dict.ts). */
export function loadDict(): Dict {
  dict ??= parseDict(readFileSync(join(process.cwd(), "chongfuxi", "data", "cedict.txt"), "utf8"));
  return dict;
}

/** Read a Pleco file of either kind. sql.js is only started for a .pqb. */
export function readPlecoBytes(bytes: Uint8Array): Promise<{ format: BackupFormat; snapshot: PlecoSnapshot }> {
  return readBackup(bytes, () => initSqlJs());
}
