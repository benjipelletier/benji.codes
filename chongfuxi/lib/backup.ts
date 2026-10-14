// One way in for either kind of Pleco file: a backup (.pqb, SQLite) or a card
// export (.xml). Told apart by what the file starts with, not by its name —
// phones rename downloads freely.

import { NotAPlecoBackupError, readPleco, type PlecoSnapshot, type SqlLike } from "./pleco";
import { looksLikePlecoXml, readPlecoXml } from "./pleco-xml";

export type BackupFormat = "pqb" | "xml";

/** The slice of sql.js this needs; only loaded when the file is a .pqb. */
export interface SqlEngine {
  Database: new (data: Uint8Array) => SqlLike & { close(): void };
}

const SQLITE_MAGIC = "SQLite format 3\u0000";

export function formatOf(bytes: Uint8Array): BackupFormat | null {
  if (bytes.length >= SQLITE_MAGIC.length && [...SQLITE_MAGIC].every((c, i) => bytes[i] === c.charCodeAt(0))) {
    return "pqb";
  }
  return looksLikePlecoXml(new TextDecoder().decode(bytes.subarray(0, 2000))) ? "xml" : null;
}

export async function readBackup(
  bytes: Uint8Array,
  loadSql: () => Promise<SqlEngine>,
): Promise<{ format: BackupFormat; snapshot: PlecoSnapshot }> {
  const format = formatOf(bytes);
  if (format === "xml") return { format, snapshot: readPlecoXml(new TextDecoder().decode(bytes)) };
  if (format === "pqb") {
    const SQL = await loadSql();
    const db = new SQL.Database(bytes);
    try {
      return { format, snapshot: readPleco(db) };
    } finally {
      db.close();
    }
  }
  throw new NotAPlecoBackupError("neither a .pqb backup nor an .xml card export");
}
