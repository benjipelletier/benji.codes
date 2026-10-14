// Drives the Anki sync endpoint (app/api/chongfuxi/anki.ts) the way Anki's
// client does — sign in, ask for meta, upload a collection, run media sync —
// and follows the notes into the deck as additions (additions.ts): words
// added, sentences unlocked, undo. Against a throwaway owner with a tiny
// corpus, deleted afterwards.
//
//   npx tsx --env-file=.env.local chongfuxi/scripts/check-anki.ts

import { decompress } from "fzstd";
import initSqlJs from "sql.js";
import { getDb } from "../../app/api/chongfuxi/db";
import { handleAnki, readCollection, zstdRaw, type AnkiContext } from "../../app/api/chongfuxi/anki";
import { addWords, listAdditions, listAnkiSyncs, markSeen, removeWord, undoAddition, wordOfNote } from "../../app/api/chongfuxi/additions";
import { recomputeUnlocks } from "../../app/api/chongfuxi/corpus";
import { loadDict } from "../../app/api/chongfuxi/dictfile";

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
  // What the route hands to after(): run it here, before looking.
  await r.afterwards?.();
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

  // A tiny corpus: 我 and 喝 known, 茶 on a list, and a sentence 茶 would unlock.
  await sql`
    insert into chongfuxi_word (owner_email, word, status) values
      (${owner}, '我', 'deck'), (${owner}, '喝', 'deck'), (${owner}, '茶', 'listed')
  `;
  const sentence = (await sql`
    insert into chongfuxi_sentence (owner_email, key, zh, en, split, sources)
    values (${owner}, '我喝茶', '我喝茶。', 'I drink tea.', 'dictionary', array['check'])
    returning id::int as id
  `) as unknown as Array<{ id: number }>;
  await sql`
    insert into chongfuxi_token (owner_email, sentence_id, pos, word)
    values (${owner}, ${sentence[0].id}, 0, '我'), (${owner}, ${sentence[0].id}, 1, '喝'), (${owner}, ${sentence[0].id}, 2, '茶')
  `;
  await recomputeUnlocks(sql, owner);
  const blockersOf = async () =>
    ((await sql`select blockers from chongfuxi_sentence where owner_email = ${owner} and id = ${sentence[0].id}`) as unknown as Array<{ blockers: string[] }>)[0]
      .blockers;
  check("the tiny corpus has its sentence waiting on 茶", (await blockersOf()).join() === "茶");

  // Reading a word off a note.
  check("a note's headword is read from its named field, with the traditional form dropped", wordOfNote({ Pinyin: "yáng", Hanzi: "扬眉吐气[揚眉吐氣]" }) === "扬眉吐气");
  check("or from the first field that is a word, through its HTML", wordOfNote({ Front: "<b>出示</b>", Back: "to show" }) === "出示");
  check("and a note with no word in it gives none", wordOfNote({ "Field 1": "hello there", "Field 2": "你好吗？我很好。" }) === null);

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

  // The notes became words: one addition per sync that brought new ones.
  let adds = await listAdditions(sql, owner);
  check(
    "each sync's new notes became deck words, as one addition each, newest first",
    adds.length === 2 && adds[0].words.map((w) => w.word).join() === "踏实" && adds[1].words.map((w) => w.word).sort().join() === ["出示", "扬眉吐气"].sort().join(),
    adds.map((a) => a.words.map((w) => w.word).join("+")),
  );
  const cards = (await sql`select word from chongfuxi_card where owner_email = ${owner} and kind = 'read' and state = 0 order by word`) as unknown as Array<{ word: string }>;
  check("each new word has a new Read card", cards.map((c) => c.word).sort().join() === ["出示", "扬眉吐气", "踏实"].sort().join());
  const defs = (await sql`select jsonb_array_length(defs)::int as n, pinyin from chongfuxi_word where owner_email = ${owner} and word = '出示'`) as unknown as Array<{ n: number; pinyin: string }>;
  check("with CC-CEDICT's definition and pinyin, not the note's", defs[0].n > 0 && defs[0].pinyin === "chu1@shi4", defs[0]);
  check("an edited note that was already added isn't added again", adds.every((a) => a.words.filter((w) => w.word === "扬眉吐气").length <= 1) && adds.length === 2);

  // A note for a word on a list: it joins the deck and unlocks the sentence.
  const third = await collection([
    [1760000000001, "扬眉吐气", "yang2mei2tu3qi4", "to feel proud"],
    [1760000000002, "出示", "chu1shi4", "to show; to present"],
    [1760000000003, "踏实", "ta1shi5", "steady; at ease"],
    [1760000000004, "茶", "cha2", "tea"],
    [1760000000005, "hello there", "", "not a word"],
  ]);
  await call("sync", "upload", key, zstdRaw(third));
  adds = await listAdditions(sql, owner);
  const tea = adds[0];
  check(
    "茶 joins the deck from the list, and its sentence unlocks",
    tea.words.length === 1 && tea.words[0].word === "茶" && tea.words[0].was === "listed" && tea.unlocked === 1 && (await blockersOf()).length === 0,
    { words: tea.words, unlocked: tea.unlocked },
  );
  check("the addition shows the sentence, which word did it, and the deck's size", tea.examples[0]?.zh === "我喝茶。" && tea.examples[0]?.by === "茶" && tea.deck === 6 && tea.words[0].readable === 1, tea.examples);
  const outcomes = (await sql`select word, outcome from chongfuxi_anki_note where owner_email = ${owner} order by note_id`) as unknown as Array<{ word: string | null; outcome: string }>;
  check("each note says what became of it", outcomes.map((o) => `${o.word ?? "-"}:${o.outcome}`).join() === "扬眉吐气:added,出示:added,踏实:added,茶:added,-:unreadable", outcomes);
  const sentenceCard = async () => (await sql`select id from chongfuxi_card where owner_email = ${owner} and kind = 'sentence' and sentence_id = ${sentence[0].id}`) as unknown as unknown[];
  check("and the unlocked sentence has its card", (await sentenceCard()).length === 1);
  const syncLog = await listAnkiSyncs(sql, owner);
  check(
    "the sync log says what each sync did, and links the one that added 茶 to its addition",
    syncLog.length === 3 &&
      syncLog[0].processed && syncLog[0].wordsAdded === 1 && syncLog[0].unlocked === 1 && syncLog[0].unreadable === 1 && syncLog[0].known === 0 &&
      syncLog[0].additionId === tea.id && syncLog[2].wordsAdded === 2,
    syncLog.map((y) => `${y.wordsAdded}w/${y.unlocked}u/${y.known}k/${y.unreadable}x -> ${y.additionId}`),
  );

  await markSeen(sql, owner, tea.id);
  check("seen, it isn't shown again", (await listAdditions(sql, owner))[0].seen);

  // Undo it.
  const undone = await undoAddition(sql, owner, tea.id);
  const status = (await sql`select status from chongfuxi_word where owner_email = ${owner} and word = '茶'`) as unknown as Array<{ status: string }>;
  const teaCard = (await sql`select id from chongfuxi_card where owner_email = ${owner} and word = '茶'`) as unknown as unknown[];
  check(
    "undoing puts 茶 back on its list, takes its card away, and locks the sentence again",
    undone.relocked === 1 && status[0]?.status === "listed" && teaCard.length === 0 && (await blockersOf()).join() === "茶" && (await sentenceCard()).length === 0,
  );
  await call("sync", "upload", key, zstdRaw(third));
  adds = await listAdditions(sql, owner);
  const afterUndo = await listAnkiSyncs(sql, owner);
  check("after undoing, its sync is marked undone, and the next sync adds nothing", afterUndo[1].undone && afterUndo[0].wordsAdded === 0 && afterUndo[0].additionId === null);
  check("and the next sync doesn't add it back", adds.length === 3 && adds[0].undone && (await sql`select outcome from chongfuxi_anki_note where owner_email = ${owner} and word = '茶'` as unknown as Array<{ outcome: string }>)[0].outcome === "undone");

  // An addition whose words have been answered can't be undone.
  await sql`update chongfuxi_card set answered = 1 where owner_email = ${owner} and word = '出示' and kind = 'read'`;
  const first2 = adds.find((a) => a.words.some((w) => w.word === "出示"))!;
  let refused = "";
  try {
    await undoAddition(sql, owner, first2.id);
  } catch (e) {
    refused = e instanceof Error ? e.message : String(e);
  }
  check("an addition with an answered word is kept, with the reason", refused.includes("出示"), refused);
  check("and says so before it's tried", (await listAdditions(sql, owner)).find((a) => a.id === first2.id)!.answered.join() === "出示");
  check("adding words already in the deck makes no addition", (await addWords(sql, owner, "check", ["出示", "我"], loadDict())) === null);

  // Removing a word in the app.
  await sql`insert into chongfuxi_review (owner_email, id, at, day, card_id, kind, word, grade, cause, scheduler, before, after)
            select ${owner}, 'check-r1', now(), current_date, id, kind, word, 'good', 'answer', 'check', '{}'::jsonb, '{}'::jsonb
            from chongfuxi_card where owner_email = ${owner} and word = '出示' and kind = 'read'`;
  const gone = await removeWord(sql, owner, "出示");
  const left = (await sql`select (select count(*)::int from chongfuxi_word where owner_email = ${owner} and word = '出示') as word,
                                 (select count(*)::int from chongfuxi_card where owner_email = ${owner} and word = '出示') as cards,
                                 (select count(*)::int from chongfuxi_review where owner_email = ${owner} and word = '出示') as reviews,
                                 (select outcome from chongfuxi_anki_note where owner_email = ${owner} and word = '出示') as note`) as unknown as Array<{
    word: number; cards: number; reviews: number; note: string;
  }>;
  check("removing a word takes it, its cards and their answers out, and marks its Anki note removed", gone.answers === 1 && left[0].word === 0 && left[0].cards === 0 && left[0].reviews === 0 && left[0].note === "removed", { gone, left: left[0] });
  await sql`update chongfuxi_word set lists = array['HSK 2012-2021/Level 1'] where owner_email = ${owner} and word = '我'`;
  await sql`update chongfuxi_word set status = 'deck' where owner_email = ${owner} and word = '茶'`;
  await recomputeUnlocks(sql, owner);
  const wo = await removeWord(sql, owner, "我");
  const woStatus = (await sql`select status from chongfuxi_word where owner_email = ${owner} and word = '我'`) as unknown as Array<{ status: string }>;
  check("a word on a list goes back on it, and the sentence that needed it locks", woStatus[0]?.status === "listed" && wo.relocked === 1 && (await blockersOf()).join() === "我");
  let notDeck = "";
  try {
    await removeWord(sql, owner, "我");
  } catch (e) {
    notDeck = e instanceof Error ? e.message : String(e);
  }
  check("a word not in the deck can't be removed", notDeck.includes("isn't in the deck"));

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
    await sql`delete from chongfuxi_addition where owner_email = ${owner}`;
    await sql`delete from chongfuxi_card where owner_email = ${owner}`;
    await sql`delete from chongfuxi_token where owner_email = ${owner}`;
    await sql`delete from chongfuxi_sentence where owner_email = ${owner}`;
    await sql`delete from chongfuxi_word where owner_email = ${owner}`;
    console.log(`\ncleaned up: nothing left for this owner\n\n${failed ? `${failed} checks failed.` : "All checks passed."}`);
    process.exit(failed ? 1 : 0);
  });
