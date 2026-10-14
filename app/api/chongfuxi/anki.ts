// A sync server for AnkiDroid that only takes uploads.
//
// The way in for new words: Pleco adds a card to AnkiDroid, and AnkiDroid
// syncs here. This speaks just enough of Anki's sync protocol (version 11,
// as in rslib/src/sync of ankitects/anki) for that:
//
// - `sync/hostKey` checks the username and password (CHONGFUXI_ANKI_USER,
//   CHONGFUXI_ANKI_PASSWORD) and hands back a key derived from them.
// - `sync/meta` always says the server is empty. An empty server makes the
//   client's next step a one-way full upload, which AnkiDroid does without
//   asking when the sync is started by hand. (A background sync skips it.)
// - `sync/upload` receives the whole collection, a SQLite file, and keeps its
//   notes in chongfuxi_anki_note. Nothing else of the collection is kept, so
//   there is never anything to download. Once the reply has gone, the notes
//   not seen before become deck words, as one addition (additions.ts).
// - `msync/*` answers for an empty media store. Media uploads are refused:
//   media sync should be off for this profile.
//
// Every request body comes zstd-compressed with an `anki-sync` header; every
// reply goes back as a zstd frame with `anki-original-size`. Replies are
// small, so they are framed uncompressed (raw blocks), which any decoder takes.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { decompress } from "fzstd";
import initSqlJs from "sql.js";
import { processAnkiNotes } from "./additions";
import type { Sql } from "./db";
import { loadDict } from "./dictfile";

export interface AnkiReply {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  /** Work to do once the reply has gone: turning new notes into words. */
  afterwards?: () => Promise<unknown>;
}

export interface AnkiContext {
  sql: Sql;
  owner: string;
  /** The username and password AnkiDroid signs in with; null if not configured. */
  credentials: { user: string; password: string } | null;
}

/** What the sync header carries: protocol version, host key, client version, session. */
interface SyncHeader {
  v: number;
  k: string;
  c: string;
  s: string;
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const MAX_BLOCK = 128 * 1024;

/** `data` as a zstd frame of raw (uncompressed) blocks, with its size in the header. */
export function zstdRaw(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / MAX_BLOCK));
  const out = new Uint8Array(4 + 1 + 4 + blocks * 3 + data.length);
  out.set(ZSTD_MAGIC, 0);
  // Frame header: single segment, 4-byte content size, no checksum, no dictionary.
  out[4] = 0xa0;
  new DataView(out.buffer).setUint32(5, data.length, true);
  let at = 9;
  for (let b = 0; b < blocks; b++) {
    const chunk = data.subarray(b * MAX_BLOCK, (b + 1) * MAX_BLOCK);
    const last = b === blocks - 1 ? 1 : 0;
    // Block header: last-block bit, type 0 (raw), size.
    const header = last | (0 << 1) | (chunk.length << 3);
    out[at] = header & 0xff;
    out[at + 1] = (header >> 8) & 0xff;
    out[at + 2] = (header >> 16) & 0xff;
    out.set(chunk, at + 3);
    at += 3 + chunk.length;
  }
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);

function reply(data: Uint8Array, status = 200): AnkiReply {
  return {
    status,
    headers: { "content-type": "application/octet-stream", "anki-original-size": String(data.length) },
    body: zstdRaw(data),
  };
}
const json = (obj: unknown) => reply(text(JSON.stringify(obj)));
/** An error as Anki's own server sends one: a status and a plain message. */
const fail = (status: number, message: string): AnkiReply => ({
  status,
  headers: { "content-type": "text/plain" },
  body: text(message),
});

/** The key a signed-in client sends on every later request. */
const hostKeyFor = (c: { user: string; password: string }) =>
  createHmac("sha256", c.password).update(`chongfuxi-anki:${c.user}`).digest("hex");

const same = (a: string, b: string) => {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
};

/** One request to `{kind}/{method}`, its `anki-sync` header (if any) and its raw body. */
export async function handleAnki(
  ctx: AnkiContext,
  kind: string,
  method: string,
  headerValue: string | null,
  body: Uint8Array,
  query: URLSearchParams = new URLSearchParams(),
): Promise<AnkiReply> {
  if (!ctx.credentials) return fail(503, "Anki sync isn't set up on this server.");
  let header: SyncHeader | null = null;
  if (headerValue) {
    try {
      header = JSON.parse(headerValue) as SyncHeader;
    } catch {
      return fail(400, "bad sync header");
    }
  }
  // Media begin may also come as a GET from old clients, with the key in the query.
  const key = header?.k ?? query.get("k") ?? "";
  if (header && (header.v < 8 || header.v > 11)) return fail(400, `unsupported sync version: ${header.v}`);
  if (header && header.v < 11) return fail(400, "Please update AnkiDroid: this server needs sync version 11.");

  let data: Uint8Array = new Uint8Array();
  if (body.length) {
    try {
      data = decompress(body);
    } catch {
      return fail(400, "decoding zstd body");
    }
  }
  const input = () => JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;

  if (kind === "sync" && method === "hostKey") {
    const { u, p } = input() as { u?: string; p?: string };
    if (typeof u !== "string" || typeof p !== "string") return fail(400, "invalid json");
    if (!same(u, ctx.credentials.user) || !same(p, ctx.credentials.password)) return fail(403, "invalid username or password");
    return json({ key: hostKeyFor(ctx.credentials) });
  }

  if (!same(key, hostKeyFor(ctx.credentials))) return fail(403, "invalid host key");

  if (kind === "sync") {
    switch (method) {
      case "meta":
        // Always empty, with a schema no client has: the client's answer is to upload.
        return json({
          mod: 0,
          scm: 0,
          usn: 0,
          ts: Math.floor(Date.now() / 1000),
          msg: "",
          cont: true,
          hostNum: 0,
          empty: true,
          media_usn: 0,
        });
      case "upload":
        return receiveUpload(ctx, data, header?.c ?? null);
      case "abort":
        return json(null);
      default:
        // Download and the normal-sync steps never come: the server is always empty.
        return fail(400, `${method} isn't supported: this server only takes uploads`);
    }
  }

  if (kind === "msync") {
    switch (method) {
      case "begin":
        return json({ data: { usn: 0, sk: key }, err: "" });
      case "mediaChanges":
        return json({ data: [], err: "" });
      case "mediaSanity":
        return json({ data: "OK", err: "" });
      case "uploadChanges":
        return json({ err: "This server keeps no media. Turn off media sync for this profile in AnkiDroid's settings." });
      default:
        return fail(400, `${method} isn't supported`);
    }
  }
  return fail(404, "not found");
}

/** A note as the collection holds it. */
export interface AnkiNote {
  id: number;
  guid: string;
  notetype: string;
  fields: Record<string, string>;
  tags: string;
  modified: number;
}

/** Every note in an uploaded collection (Anki's schema 18, or the older one with note types as JSON). */
export async function readCollection(bytes: Uint8Array): Promise<AnkiNote[]> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(bytes);
  try {
    const rows = <T>(q: string): T[] => {
      const res = db.exec(q)[0];
      if (!res) return [];
      return res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]])) as T);
    };
    const tables = new Set(rows<{ name: string }>("select name from sqlite_master where type = 'table'").map((t) => t.name));
    // Note type id to its name and field names, in order.
    const types = new Map<number, { name: string; fields: string[] }>();
    if (tables.has("notetypes") && tables.has("fields")) {
      for (const t of rows<{ id: number; name: string }>("select id, name from notetypes")) types.set(Number(t.id), { name: t.name, fields: [] });
      for (const f of rows<{ ntid: number; ord: number; name: string }>("select ntid, ord, name from fields order by ntid, ord")) {
        types.get(Number(f.ntid))?.fields.push(f.name);
      }
    } else {
      const col = rows<{ models: string }>("select models from col")[0];
      const models = col ? (JSON.parse(col.models) as Record<string, { id: number; name: string; flds: Array<{ name: string; ord: number }> }>) : {};
      for (const m of Object.values(models)) {
        types.set(Number(m.id), { name: m.name, fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name) });
      }
    }
    return rows<{ id: number; guid: string; mid: number; mod: number; tags: string; flds: string }>(
      "select id, guid, mid, mod, tags, flds from notes order by id",
    ).map((n) => {
      const type = types.get(Number(n.mid));
      const values = String(n.flds).split("\x1f");
      const names = type?.fields ?? values.map((_, i) => `Field ${i + 1}`);
      return {
        id: Number(n.id),
        guid: String(n.guid),
        notetype: type?.name ?? "unknown",
        fields: Object.fromEntries(values.map((v, i) => [names[i] ?? `Field ${i + 1}`, v])),
        tags: String(n.tags ?? "").trim(),
        // Anki keeps a note's mod in seconds.
        modified: Number(n.mod) * 1000,
      };
    });
  } finally {
    db.close();
  }
}

/** Keep the notes of an uploaded collection, and log the sync. Replies "OK", as Anki's server does. */
async function receiveUpload(ctx: AnkiContext, data: Uint8Array, client: string | null): Promise<AnkiReply> {
  let notes: AnkiNote[];
  try {
    notes = await readCollection(data);
  } catch (e) {
    await ctx.sql`
      insert into chongfuxi_anki_sync (owner_email, client, bytes, error)
      values (${ctx.owner}, ${client}, ${data.length}, ${String(e instanceof Error ? e.message : e).slice(0, 500)})
    `;
    return reply(text("Your collection couldn't be read by 重复习."));
  }
  const before = (await ctx.sql`select count(*)::int as n from chongfuxi_anki_note where owner_email = ${ctx.owner}`) as unknown as Array<{
    n: number;
  }>;
  const payload = JSON.stringify(
    notes.map((n) => ({ i: n.id, g: n.guid, t: n.notetype, f: n.fields, s: n.tags, m: new Date(n.modified).toISOString() })),
  );
  await ctx.sql.transaction([
    ctx.sql`
      insert into chongfuxi_anki_note (owner_email, note_id, guid, notetype, fields, tags, modified)
      select ${ctx.owner}, (x->>'i')::bigint, x->>'g', x->>'t', x->'f', x->>'s', (x->>'m')::timestamptz
      from jsonb_array_elements(${payload}::jsonb) x
      on conflict (owner_email, note_id) do update
        set guid = excluded.guid, notetype = excluded.notetype, fields = excluded.fields,
            tags = excluded.tags, modified = excluded.modified, last_seen = now()
    `,
  ]);
  const after = (await ctx.sql`select count(*)::int as n from chongfuxi_anki_note where owner_email = ${ctx.owner}`) as unknown as Array<{
    n: number;
  }>;
  const logged = (await ctx.sql`
    insert into chongfuxi_anki_sync (owner_email, client, bytes, notes, added)
    values (${ctx.owner}, ${client}, ${data.length}, ${notes.length}, ${after[0].n - before[0].n})
    returning id::int as id
  `) as unknown as Array<{ id: number }>;
  return { ...reply(text("OK")), afterwards: () => processAnkiNotes(ctx.sql, ctx.owner, loadDict(), Date.now(), logged[0].id) };
}
