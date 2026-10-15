// Checks the link between the deck and 龙库 (app/api/chongfuxi/longku.ts)
// against a throwaway owner, then deletes what it wrote:
//
//   npx tsx --env-file=.env.local chongfuxi/scripts/check-longku.ts

import { getDb } from "../../app/api/chongfuxi/db";
import { addWords, removeWord, undoAddition } from "../../app/api/chongfuxi/additions";
import { loadDict } from "../../app/api/chongfuxi/dictfile";
import { longkuAdd, longkuRemove, longkuWords, reconcileLongku, seedFromLongku } from "../../app/api/chongfuxi/longku";
import { lookupWord } from "@longku/lib/data";

const sql = getDb();
const owner = `check-longku-${Date.now()}@chongfuxi.test`;
const dict = loadDict();
let failed = 0;
function check(what: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail === undefined ? "" : `  (${JSON.stringify(detail)})`}`);
  if (!ok) failed++;
}

const inLongku = async (w: string) => (await longkuWords(sql, owner, [w])).has(w);
const status = async (w: string) =>
  ((await sql`select status from chongfuxi_word where owner_email = ${owner} and word = ${w}`) as unknown as Array<{ status: string }>)[0]?.status ??
  null;
const readCards = async (w: string) =>
  ((await sql`select count(*)::int as n from chongfuxi_card where owner_email = ${owner} and word = ${w} and kind = 'read'`) as unknown as Array<{
    n: number;
  }>)[0].n;

async function main() {
  console.log(`owner for this run: ${owner}\n`);
  const corpus = ["一路平安", "自由自在", "画蛇添足"];
  check("the test words are chengyu by 龙库's list", corpus.every((w) => lookupWord(w)) && !lookupWord("我"));

  // A deck with one chengyu and one plain word.
  await sql`insert into chongfuxi_word (owner_email, word, status) values (${owner}, '一路平安', 'deck'), (${owner}, '我', 'deck')`;
  let r = await reconcileLongku(sql, owner);
  check("reconciling links the deck's chengyu into 龙库, and only that", r.linked.join() === "一路平安" && (await inLongku("一路平安")) && !(await inLongku("我")), r);
  const row = (await sql`select fs, ls, f from longku_bank where owner_email = ${owner} and w = '一路平安'`) as unknown as Array<{ fs: string; ls: string; f: number }>;
  check("with its syllables and frequency from 龙库's list", row[0]?.fs === lookupWord("一路平安")!.fs && row[0]?.ls === lookupWord("一路平安")!.ls, row[0]);

  // Removing in 龙库 only unlinks, and it stays unlinked.
  await longkuRemove(sql, owner, "一路平安");
  r = await reconcileLongku(sql, owner);
  check("removed in 龙库, it leaves 龙库 and isn't linked back", !(await inLongku("一路平安")) && r.linked.length === 0);
  check("but stays a deck word here", (await status("一路平安")) === "deck");

  // Adding it again in 龙库 brings it back.
  const e1 = lookupWord("一路平安")!;
  await longkuAdd(sql, owner, [{ w: e1.w, fs: e1.fs, ls: e1.ls, f: e1.f }], dict);
  check("added again in 龙库, it is back", await inLongku("一路平安"));

  // A new word added in 龙库 joins the deck.
  const e2 = lookupWord("自由自在")!;
  const added = await longkuAdd(sql, owner, [{ w: e2.w, fs: e2.fs, ls: e2.ls, f: e2.f }], dict);
  const addition = (await sql`select source, words from chongfuxi_addition where owner_email = ${owner} order by id desc limit 1`) as unknown as Array<{
    source: string;
    words: Array<{ word: string }>;
  }>;
  check(
    "a word added in 龙库 joins the deck with a Read card, as an addition from 龙库",
    added.join() === "自由自在" && (await status("自由自在")) === "deck" && (await readCards("自由自在")) === 1 && addition[0]?.source === "longku",
    { added, addition: addition[0] },
  );

  // Out of the deck, out of 龙库.
  await removeWord(sql, owner, "自由自在");
  check("removing a word from the deck takes it out of 龙库", !(await inLongku("自由自在")));

  // A chengyu learnt here (an Anki sync, say) shows up in 龙库; undone, it goes.
  const a = await addWords(sql, owner, "anki", ["画蛇添足"], dict);
  check("a chengyu learnt here shows up in 龙库 by itself", await inLongku("画蛇添足"));
  await undoAddition(sql, owner, a!.id);
  check("and leaves it when its addition is undone", !(await inLongku("画蛇添足")) && (await status("画蛇添足")) === null);

  // Seeding a card from 龙库's record.
  const at = Date.UTC(2026, 9, 14);
  const never = seedFromLongku({ strength: 0, recalls: 0, misses: 0, added: at - 5e8, lastRecalled: null, lastSeen: null }, at);
  const strong = seedFromLongku({ strength: 0.95, recalls: 5, misses: 1, added: at - 4e9, lastRecalled: at - 2 * 86_400_000, lastSeen: at - 86_400_000 }, at);
  check("a word never played in 龙库 starts as a new card", never.state === 0 && never.due === at);
  check(
    "one played there starts from 龙库's interval for its strength, with misses raising its difficulty",
    strong.state === 2 && strong.stability === 13 && strong.difficulty === 5 && strong.lastReview === at - 2 * 86_400_000 && strong.reps === 5 && strong.lapses === 1,
    strong,
  );
  const seeded = await addWords(sql, owner, "longku", ["画蛇添足"], dict, at, new Map([["画蛇添足", strong]]));
  const card = (await sql`select state::int as state, stability from chongfuxi_card where owner_email = ${owner} and word = '画蛇添足' and kind = 'read'`) as unknown as Array<{
    state: number;
    stability: number;
  }>;
  check("addWords starts a card from a seed when given one", Boolean(seeded) && card[0]?.state === 2 && card[0]?.stability === 13, card[0]);
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(async () => {
    for (const t of ["longku_bank", "longku_excluded", "longku_review", "longku_sweep", "chongfuxi_addition", "chongfuxi_card", "chongfuxi_word"]) {
      await sql.query(`delete from ${t} where owner_email = $1`, [owner]);
    }
    console.log(`\ncleaned up: nothing left for this owner\n\n${failed ? `${failed} checks failed.` : "All checks passed."}`);
    process.exit(failed ? 1 : 0);
  });
