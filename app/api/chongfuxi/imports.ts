// The Pleco files that were imported, kept whole (chongfuxi_import and its
// chunks). Like everything in this folder that isn't a route, these functions
// take the connection and the owner and know nothing about requests, so the
// scripts in chongfuxi/scripts run the same code the routes do.

import { gunzipSync } from "node:zlib";
import type { Sql } from "./db";
import type { ImportDescriptor, StoredImport } from "@chongfuxi/lib/upload";

interface ImportRow {
  id: string;
  at: number;
  file_name: string;
  sha256: string | null;
  format: StoredImport["format"];
  encoding: StoredImport["encoding"];
  bytes: number;
  chunks: number;
  complete: boolean;
  ingested: number | null;
}

const toImport = (r: ImportRow): StoredImport => ({
  id: r.id,
  at: Math.round(r.at),
  fileName: r.file_name,
  sha256: r.sha256,
  format: r.format,
  encoding: r.encoding,
  bytes: r.bytes,
  chunks: r.chunks,
  complete: r.complete,
  ingested: r.ingested === null ? null : Math.round(r.ingested),
});

export async function listImports(sql: Sql, owner: string): Promise<StoredImport[]> {
  const rows = (await sql`
    select id, (extract(epoch from at) * 1000)::double precision as at, file_name, sha256,
           format, encoding, bytes::int as bytes, chunks, complete,
           (extract(epoch from ingested) * 1000)::double precision as ingested
    from chongfuxi_import
    where owner_email = ${owner}
    order by at
  `) as unknown as ImportRow[];
  return rows.map(toImport);
}

export async function getImport(sql: Sql, owner: string, id: string): Promise<StoredImport | null> {
  return (await listImports(sql, owner)).find((i) => i.id === id) ?? null;
}

/** Announce a file before its chunks arrive. Announcing it twice changes nothing. */
export async function createImport(sql: Sql, owner: string, d: ImportDescriptor): Promise<void> {
  await sql`
    insert into chongfuxi_import (owner_email, id, at, file_name, sha256, format, encoding, bytes, chunks)
    values (${owner}, ${d.id}, to_timestamp(${d.at}::double precision / 1000), ${d.fileName}, ${d.sha256},
            ${d.format}, ${d.encoding}, ${d.bytes}, ${d.chunks})
    on conflict (owner_email, id) do nothing
  `;
}

/** Store one chunk; true once the file has them all. */
export async function putChunk(sql: Sql, owner: string, importId: string, idx: number, data: Uint8Array): Promise<boolean> {
  // base64 through decode() rather than a bytea parameter: it is the one
  // encoding every driver and the HTTP transport agree on.
  const b64 = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
  await sql`
    insert into chongfuxi_import_chunk (owner_email, import_id, idx, data)
    values (${owner}, ${importId}, ${idx}, decode(${b64}, 'base64'))
    on conflict (owner_email, import_id, idx) do update set data = excluded.data
  `;
  const rows = (await sql`
    update chongfuxi_import i
    set complete = (
      select count(*) from chongfuxi_import_chunk c
      where c.owner_email = i.owner_email and c.import_id = i.id
    ) >= i.chunks
    where i.owner_email = ${owner} and i.id = ${importId}
    returning complete
  `) as unknown as Array<{ complete: boolean }>;
  return Boolean(rows[0]?.complete);
}

/** A stored file as Pleco wrote it: its chunks joined and unpacked. */
export async function readImport(sql: Sql, owner: string, imp: StoredImport): Promise<Uint8Array> {
  const parts: Buffer[] = [];
  for (let i = 0; i < imp.chunks; i++) {
    const rows = (await sql`
      select encode(data, 'base64') as b64
      from chongfuxi_import_chunk
      where owner_email = ${owner} and import_id = ${imp.id} and idx = ${i}
    `) as unknown as Array<{ b64: string }>;
    if (!rows[0]) throw new Error(`Chunk ${i} of ${imp.fileName} is missing.`);
    parts.push(Buffer.from(rows[0].b64, "base64"));
  }
  const packed = Buffer.concat(parts);
  return new Uint8Array(imp.encoding === "gzip" ? gunzipSync(packed) : packed);
}
