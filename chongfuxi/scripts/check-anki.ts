// Drives the Anki sync endpoint (app/api/chongfuxi/anki.ts) the way Anki's
// client does — sign in, ask for meta, upload a collection, run media sync —
// against a throwaway owner, then deletes what it wrote.
//
//   npx tsx --env-file=.env.local chongfuxi/scripts/check-anki.ts

import { decompress } from "fzstd";
import initSqlJs from "sql.js";
import { getDb } from "../../app/api/chongfuxi/db";
import { handleAnki, readCollection, zstdRaw, type AnkiContext } from "../../app/api/chongfuxi/anki";

const sql = getDb();
const owner = `check-anki-${Date.now()}@chongfuxi.test`;
const credentials = { user: "check-user", password: `check-${Math.random().toString(36).slice(2)}` };
const ctx: AnkiContext = { sql, owner, credentials };

let failed = 0;
function check(what: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail === undefined ? "" : `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})`}`);
  if (!ok) failed++;
}

const enc = (obj: unknown) => zstdRaw(new TextEncoder().encode(JSON.stringify(obj)));
const header = (k: string) => JSON.stringify({ v: 11, k, c: "ankidroid,2.21.0,check", s: "session1" });
async function call(kind: string, method: string, key: string, body: Uint8Array) {
  const r = await handleAnki(ctx, kind, method, header(key), body);
  const ok = r.status === 200;
  const data = ok ? decompress(r.body) : r.body;
  const textOut = new TextDecoder().decode(data);
  return { status: r.status, size: r.headers["anki-original-size"], text: textOut, json: () => JSON.parse(textOut) };
}

/** A small collection in Anki's schema 18: one note type with three fields, and notes as Pleco would send them. */
async function collection(notes: Array<[number, string, string, string]>): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`create table notetypes (id integer primary key, name text, mtime_secs integer, usn integer, config blob);
          create table fields (ntid integer, ord integer, name text, config blob, primary key (ntid, ord));
          create table notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text,
                              flds text, sfld text, csum integer, flags integer, data text);`);
  db.run("insert into notetypes values (1700000000000, 'Pleco', 0, 0, x'')");
  ["Hanzi", "Pinyin", "Meaning"].forEach((n, i) => db.run("insert into fields values (1700000000000, ?, ?, x'')", [i, n]));
  for (const [id, hanzi, pinyin, meaning] of notes) {
    db.run("insert into notes values (?, ?, 1700000000000, ?, 0, ' pleco ', ?, ?, 0, 0, '')", [
      id,
      `guid${id}`,
      Math.floor(id / 1000),
      [hanzi, pinyin, meaning].join("\x1f"),
      hanzi,
    ]);
  }
  const bytes = db.export();
  db.close();
  return bytes;
}

async function main() {
  console.log(`owner for this run: ${owner}\n`);

  // Frames: what we send must decode, across block boundaries too.
  const big = new Uint8Array(300_000).map((_, i) => i % 251);
  const round = decompress(zstdRaw(big));
  check("a reply framed as raw zstd decodes to the same bytes, over several blocks", round.length === big.length && round.every((b, i) => b === big[i]));
  check("and an empty reply too", decompress(zstdRaw(new Uint8Array())).length === 0);

  // Sign in.
  let r = await call("sync", "hostKey", "", enc({ u: credentials.user, p: "wrong" }));
  check("a wrong password is refused with 403", r.status === 403);
  r = await call("sync", "hostKey", "", enc({ u: credentials.user, p: credentials.password }));
  const key = r.status === 200 ? (r.json() as { key: string }).key : "";
  check("the right one gets a host key", key.length === 64, r.status);
  check("replies carry their original size", r.size === String(r.text.length));
  r = await call("sync", "meta", "not-the-key", enc({ v: 11, cv: "check" }));
  check("a request with the wrong key is refused", r.status === 403);

  // Meta: always empty, so the client's answer is a one-way upload.
  r = await call("sync", "meta", key, enc({ v: 11, cv: "check" }));
  const meta = r.json() as { mod: number; scm: number; empty: boolean; cont: boolean; ts: number; media_usn: number };
  const local = { mod: Date.now(), scm: Date.now() - 1000, empty: false };
  const uploadOk = !local.empty || meta.empty;
  const downloadOk = !meta.empty || local.empty;
  check(
    "meta says empty, so a client with cards must upload and may not download (Anki's rule in compared_to_remote)",
    meta.empty && meta.cont && meta.mod !== local.mod && meta.scm !== local.scm && uploadOk && !downloadOk,
    meta,
  );
  check("and gives the server's time, for the client's clock check", Math.abs(meta.ts - Date.now() / 1000) < 5);

  // Upload a collection.
  const first = await collection([
    [1760000000001, "扬眉吐气", "yang2mei2tu3qi4", "feel proud and elated"],
    [1760000000002, "出示", "chu1shi4", "to show; to present"],
  ]);
  const notes = await readCollection(first);
  check("the collection's notes are read with their field names", notes.length === 2 && notes[0].fields.Hanzi === "扬眉吐气" && notes[0].notetype === "Pleco", notes[0]);
  r = await call("sync", "upload", key, zstdRaw(first));
  check("an upload is answered OK", r.status === 200 && r.text === "OK", r.text);
  let stored = (await sql`select note_id::text as id, fields->>'Hanzi' as hanzi from chongfuxi_anki_note where owner_email = ${owner} order by note_id`) as unknown as Array<{ id: string; hanzi: string }>;
  check("and its notes are kept", stored.map((s) => s.hanzi).join() === "扬眉吐气,出示");

  const second = await collection([
    [1760000000001, "扬眉吐气", "yang2mei2tu3qi4", "to feel proud"],
    [1760000000002, "出示", "chu1shi4", "to show; to present"],
    [1760000000003, "踏实", "ta1shi5", "steady; at ease"],
  ]);
  r = await call("sync", "upload", key, zstdRaw(second));
  stored = (await sql`select note_id::text as id, fields->>'Meaning' as meaning from chongfuxi_anki_note where owner_email = ${owner} order by note_id`) as unknown as Array<{ id: string; meaning: string }>;
  const log = (await sql`select notes, added from chongfuxi_anki_sync where owner_email = ${owner} order by id`) as unknown as Array<{ notes: number; added: number }>;
  check("the next upload adds the new note and updates the changed one", r.text === "OK" && stored.length === 3 && stored[0].meaning === "to feel proud");
  check("each sync is logged with what it added", log.map((l) => `${l.notes}/${l.added}`).join() === "2/2,3/1", log);

  r = await call("sync", "upload", key, zstdRaw(new TextEncoder().encode("not a database")));
  check("an unreadable upload gets a message back, not a crash", r.status === 200 && r.text !== "OK", r.text);

  r = await call("sync", "download", key, enc({}));
  check("a download is refused: there is never anything to download", r.status === 400);

  // Media sync, for an empty media store.
  r = await call("msync", "begin", key, enc({ v: "check" }));
  check("media sync begins at usn 0", r.json().data.usn === 0 && r.json().err === "");
  r = await call("msync", "mediaChanges", key, enc({ lastUsn: 0 }));
  check("with no changes", Array.isArray(r.json().data) && r.json().data.length === 0);
  r = await call("msync", "mediaSanity", key, enc({ local: 0 }));
  check("and passes its sanity check", r.json().data === "OK");
  r = await call("msync", "uploadChanges", key, zstdRaw(new Uint8Array([1, 2, 3])));
  check("media uploads are turned away with a reason", typeof r.json().err === "string" && r.json().err.length > 0 && !("data" in r.json()));

  const none = await handleAnki({ ...ctx, credentials: null }, "sync", "hostKey", header(""), enc({ u: "a", p: "b" }));
  check("without credentials configured, sync is off", none.status === 503);
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(async () => {
    await sql`delete from chongfuxi_anki_note where owner_email = ${owner}`;
    await sql`delete from chongfuxi_anki_sync where owner_email = ${owner}`;
    console.log(`\ncleaned up: nothing left for this owner\n\n${failed ? `${failed} checks failed.` : "All checks passed."}`);
    process.exit(failed ? 1 : 0);
  });
