// Hold the review rules to account, end to end, against the real database.
//
//   npx tsx --env-file=.env.local chongfuxi/scripts/check-review.ts
//
// Ingests a small made-up deck under an owner address invented for the run,
// then reviews it across three made-up days through the same functions the
// routes call, checking each rule as it goes. Finally it replays the review
// log from scratch and checks that it reproduces every card's schedule. The
// invented owner's rows are deleted when it finishes, pass or fail.

import { neon } from "@neondatabase/serverless";
import { ingest, setName } from "../../app/api/chongfuxi/corpus";
import type { Sql } from "../../app/api/chongfuxi/db";
import { loadDict } from "../../app/api/chongfuxi/dictfile";
import { getStats } from "../../app/api/chongfuxi/stats";
import {
  getSummary,
  mergeMeaning,
  nextCards,
  setNote,
  splitMeaning,
  submitReview,
} from "../../app/api/chongfuxi/review";
import type { ReviewInput, SessionCard } from "../lib/api";
import type { StudyDay } from "../lib/day";
import { readPlecoXml } from "../lib/pleco-xml";
import { REVIVED_CLEAN_READS } from "../lib/review";
import { SEED_CAP_DAYS, answer, type Grade, type Schedule } from "../lib/schedule";

const url = process.env.CHONGFUXI_DATABASE_URL || process.env.CHONGFUXI_POSTGRES_URL;
if (!url) throw new Error("No chongfuxi database URL in the environment.");
const sql = neon(url) as Sql;
const owner = `check-${Date.now()}@chongfuxi.test`;

let failed = 0;
function check(what: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

// Three days in 2030, answered at noon; a study day ends at 04:00 the next morning.
const noon = (n: number) => Date.UTC(2030, 0, n, 12);
const dayN = (n: number): StudyDay => ({ day: `2030-01-0${n}`, cutoff: Date.UTC(2030, 0, n + 1, 4) });

// A deck of our own: eight words, three of them with a Pleco history, and
// fourteen sentences — twelve readable, one waiting on a word, one on a name.
const pleco = (score: number, daysAgo: number, wrong = 0) => {
  const last = Math.round(noon(1) / 1000) - daysAgo * 86400;
  return `<scoreinfo scorefile="Default" score="${score}" difficulty="100" history="666" correct="3" incorrect="${wrong}" reviewed="${3 + wrong}" firstreviewedtime="${last - 86400 * 90}" lastreviewedtime="${last}"/>`;
};
const WORDS: Array<[string, string, string]> = [
  ["我", "wo3", pleco(800, 30)],
  ["你", "ni3", pleco(51200, 600)],
  ["他", "ta1", ""],
  ["喝", "he1", pleco(200, 1, 1)],
  ["茶", "cha2", ""],
  ["水", "shui3", ""],
  ["很", "hen3", ""],
  ["好", "hao3", ""],
];
const SUBJECTS: Array<[string, string]> = [["我", "wo3"], ["你", "ni3"], ["他", "ta1"]];
const TAILS: Array<[string, string, string]> = [
  ["喝茶", "he1 cha2", "drink tea"],
  ["喝水", "he1 shui3", "drink water"],
  ["很好", "hen3 hao3", "be well"],
  ["好", "hao3", "be good"],
];
const SENTENCES: Array<[string, string, string]> = [
  ...SUBJECTS.flatMap(([s, sp]) => TAILS.map(([t, tp, en]): [string, string, string] => [`${s}${t}。`, `${sp} ${tp}`, `${s} ${en}.`])),
  ["我喝咖啡。", "wo3 he1 ka1fei1", "I drink coffee."],
  ["约翰喝茶。", "yue1han4 he1 cha2", "John drinks tea."],
];
const card = (hw: string, pron: string, defn: string, cat: string, extra = "") =>
  `<card language="chinese"><entry><headword>${hw}</headword><pron type="hypy" tones="numbers">${pron}</pron><defn>${defn}</defn></entry><catassign category="${cat}"/>${extra}</card>`;
const XML =
  `<?xml version="1.0" encoding="UTF-8"?><plecoflash formatversion="2" generator="check-review"><cards>` +
  WORDS.map(([w, p, score]) => card(w, p, "", "ACTIVE", score)).join("") +
  SENTENCES.map(([zh, p, en]) => card(zh, p, en, "Sentences")).join("") +
  `</cards></plecoflash>`;

interface Row {
  id: number;
  kind: string;
  word: string | null;
  meaning_id: number | null;
  sentence_id: number | null;
  state: number;
  due: number;
  stability: number;
  lapses: number;
  answered: number;
  clean_reads: number;
  retired: boolean;
  suspended: boolean;
  flagged: boolean;
}
const cards = async (): Promise<Row[]> =>
  (await sql`
    select id::int as id, kind, word, meaning_id::int as meaning_id, sentence_id::int as sentence_id, state::int as state,
           (extract(epoch from due) * 1000)::double precision as due, stability, lapses, answered, clean_reads,
           retired is not null as retired, suspended, flagged is not null as flagged
    from chongfuxi_card where owner_email = ${owner} order by id
  `) as unknown as Row[];
const sentenceId = async (zh: string): Promise<number> =>
  ((await sql`select id::int as id from chongfuxi_sentence where owner_email = ${owner} and zh = ${zh}`) as unknown as Array<{ id: number }>)[0].id;
const wordCard = async (kind: string, word: string) => (await cards()).find((c) => c.kind === kind && c.word === word && c.meaning_id === null);
const sentenceCard = async (zh: string) => {
  const id = await sentenceId(zh);
  return (await cards()).find((c) => c.sentence_id === id)!;
};
const reviews = async () =>
  Number(((await sql`select count(*) as n from chongfuxi_review where owner_email = ${owner}`) as unknown as Array<{ n: string }>)[0].n);

let n = 0;
const submit = (cardId: number, grade: Grade, day: number, extra: Partial<ReviewInput> = {}) =>
  submitReview(
    sql,
    owner,
    { id: `r${++n}`, cardId, grade, at: noon(day) + n * 1000, session: "check", ms: 4000, utcOffset: 120, position: n, device: "phone", ...dayN(day), ...extra },
    true,
  );
const queue = (day: number, exclude: number[] = [], limit = 30): Promise<SessionCard[]> =>
  nextCards(sql, owner, dayN(day), { limit, position: 0, exclude, skipWords: [], at: noon(day) });

async function main() {
  console.log(`owner for this run: ${owner}\n`);

  // ---------------------------------------------------------------- ingest
  const summary = await ingest(sql, owner, readPlecoXml(XML), { importId: "check", fileName: "check.xml" }, loadDict(), { at: noon(1) });
  check("the deck is the eight words", summary.words.total === 8 && summary.words.added === 8);
  check("twelve of fourteen sentences are readable", summary.sentences.total === 14 && summary.sentences.readable === 12, JSON.stringify(summary.sentences));
  let all = await cards();
  check("every word has a Read card and every readable sentence a card", all.filter((c) => c.kind === "read").length === 8 && all.filter((c) => c.kind === "sentence").length === 12);
  const wo = (await wordCard("read", "我"))!;
  const cha = (await wordCard("read", "茶"))!;
  check("a word Pleco scored starts from that score, due at once", wo.state === 2 && wo.stability === 8 && wo.due === noon(1), `stability ${wo.stability}`);
  check("a word Pleco never tested starts new", cha.state === 0 && cha.answered === 0);
  const ni = (await wordCard("read", "你"))!;
  check("Pleco's top score is capped, and due at once like the rest", ni.stability === SEED_CAP_DAYS && ni.due === noon(1), `stability ${ni.stability}`);

  // ----------------------------------------------------------------- day 1
  let q = await queue(1);
  const fresh = q.filter((c) => c.kind === "sentence" && c.isNew);
  check("the queue mixes words and sentences", q.some((c) => c.kind === "read") && fresh.length > 0, q.map((c) => c.kind[0]).join(""));
  check("no more than ten new sentences in a day, though twelve are waiting", fresh.length === 10);
  check("one card per word in a batch", new Set(q.filter((c) => c.word).map((c) => c.word!.word)).size === q.filter((c) => c.word).length);
  const chaCard = q.find((c) => c.word?.word === "茶")!;
  check("a Read card comes with a readable sentence that has the word", Boolean(chaCard?.sentence?.words.includes("茶")), chaCard?.sentence?.zh);
  check("and with the dictionary's definition", Boolean(chaCard?.word?.defs.some((d) => d.senses.some((s) => /tea/.test(s)))));
  check("each button says when the card would return", chaCard.intervals.good >= 2 && chaCard.intervals.forgot >= 1, JSON.stringify(chaCard.intervals));

  let r = await submit(cha.id, "good", 1, { sentenceId: chaCard.sentence!.id });
  check("Got it sends the card days away", r.days !== null && r.days >= 2 && !r.duplicate, `${r.days} days`);
  check("and opens the word's Produce card", r.produceOpened && Boolean(await wordCard("produce", "茶")));
  check(
    "the receipt says when Recall starts, and that the word was read in a sentence for the first time",
    r.recallIn !== null && r.exposed.join() === "茶" && r.firstSeen.join() === "茶",
    JSON.stringify({ was: r.was, recallIn: r.recallIn, exposed: r.exposed, firstSeen: r.firstSeen }),
  );
  const before = await reviews();
  const again = await submitReview(sql, owner, { id: `r${n}`, cardId: cha.id, grade: "forgot", at: noon(1), session: "check", ...dayN(1) }, true);
  check("an answer sent twice is recorded once", again.duplicate && (await reviews()) === before && (await wordCard("read", "茶"))!.lapses === 0);
  q = await queue(1);
  check("the word's other card waits for another day", !q.some((c) => c.word?.word === "茶"));

  const tea1 = await sentenceCard("我喝茶。");
  const tea2 = await sentenceCard("他喝茶。");
  r = await submit(tea1.id, "good", 1);
  check("a sentence read cleanly once is not retired", !r.retired && (await sentenceCard("我喝茶。")).clean_reads === 1);
  check(
    "its receipt counts the clean read and names the deck words read, first-timers apart",
    r.was === null && r.cleanReads?.before === 0 && r.cleanReads.now === 1 && r.cleanReads.need === 2 &&
      r.exposed.includes("茶") && r.exposed.includes("喝") && r.firstSeen.includes("喝") && !r.firstSeen.includes("茶"),
    JSON.stringify({ cleanReads: r.cleanReads, exposed: r.exposed, firstSeen: r.firstSeen }),
  );
  r = await submit(tea1.id, "good", 1);
  check("a second clean read the same day doesn't count", !r.retired && (await sentenceCard("我喝茶。")).clean_reads === 1);
  check("and the receipt shows it didn't", r.cleanReads?.before === 1 && r.cleanReads.now === 1 && r.was !== null && r.firstSeen.length === 0);
  check(
    "a card answered before comes with the odds it was remembered and its difficulty either side",
    r.odds !== null && r.odds > 0 && r.odds <= 1 && r.difficulty.before !== null && r.difficulty.after >= 1 && r.difficulty.after <= 10,
    JSON.stringify({ odds: r.odds, difficulty: r.difficulty }),
  );
  await submit(tea2.id, "good", 1);
  const exposures = ((await sql`select exposures from chongfuxi_word where owner_email = ${owner} and word = '茶'`) as unknown as Array<{ exposures: number }>)[0].exposures;
  check("reading sentences counts as seeing their words", exposures >= 3, `茶 seen ${exposures} times`);
  check("and moves no word's schedule", (await wordCard("read", "喝"))!.answered === 0);

  // ----------------------------------------------------------------- day 2
  r = await submit(tea1.id, "good", 2);
  check("a clean read on a second day retires the sentence", r.retired && (await sentenceCard("我喝茶。")).retired);
  await submit(tea2.id, "good", 2);
  q = await queue(2);
  check("retired sentences leave the queue", !q.some((c) => c.id === tea1.id || c.id === tea2.id));
  check("the Produce card is offered a day after it opened", q.some((c) => c.kind === "produce" && c.word?.word === "茶"));
  const produce = q.find((c) => c.kind === "produce" && c.word?.word === "茶")!;
  check("with the word blanked rather than shown, when there is a sentence", produce.sentence === null || produce.sentence.zh.includes("茶"));

  const water = await sentenceCard("我喝水。");
  const shui = (await wordCard("read", "水"))!;
  r = await submit(water.id, "forgot", 2, { tapped: ["水", "不在句子里"] });
  const shuiAfter = (await wordCard("read", "水"))!;
  check("tapping a word in a forgotten sentence lapses that word", r.lapsed.join() === "水" && shuiAfter.answered === shui.answered + 1 && shuiAfter.state === 2);
  check(
    "the receipt says where the lapsed word went, and leaves it out of the words read",
    r.lapses.length === 1 && r.lapses[0].word === "水" && r.lapses[0].days >= 1 && !r.exposed.includes("水") && r.exposed.includes("喝"),
    JSON.stringify({ lapses: r.lapses, exposed: r.exposed }),
  );
  check("the forgotten sentence starts its clean reads over", (await sentenceCard("我喝水。")).clean_reads === 0);
  q = await queue(2);
  check("the lapsed word isn't asked again that day", !q.some((c) => c.word?.word === "水"));

  // ----------------------------------------------------------------- day 3
  r = await submit(cha.id, "forgot", 3, { sentenceId: tea1.sentence_id! });
  const back1 = await sentenceCard("我喝茶。");
  const back2 = await sentenceCard("他喝茶。");
  check("forgetting a word brings back its sentence and one other", r.revived === 2 && !back1.retired && !back2.retired);
  check(
    "the receipt names them, and counts no reading for a forgotten word",
    r.revivedSentences.slice().sort().join() === ["我喝茶。", "他喝茶。"].sort().join() && r.exposed.length === 0 && r.was !== null,
    r.revivedSentences.join(" "),
  );
  check("each one clean read from retiring again", back1.clean_reads === REVIVED_CLEAN_READS && back2.clean_reads === REVIVED_CLEAN_READS);
  check("and not before tomorrow", back1.due === dayN(3).cutoff);
  check("Forgot counts as a lapse", (await wordCard("read", "茶"))!.lapses === 1);

  const hen = (await wordCard("read", "很"))!;
  await setNote(sql, owner, hen.id, "  the adverb, not 狠  ");
  const noted = (await queue(3)).find((c) => c.id === hen.id);
  check("a note stays on the card and the card stays in the queue", noted?.note === "the adverb, not 狠" && (await wordCard("read", "很"))!.answered === 0);
  await setNote(sql, owner, hen.id, "");
  check("an empty note takes it off", (await queue(3)).find((c) => c.id === hen.id)?.note === null);

  const meaning = await splitMeaning(sql, owner, "好", "to be fond of", noon(3));
  all = await cards();
  check("a split-off meaning gets its own card under the word", all.some((c) => c.kind === "read" && c.word === "好" && c.meaning_id === meaning));
  q = await queue(3, [], 30);
  check("never beside the word's own card", q.filter((c) => c.word?.word === "好").length === 1);
  await mergeMeaning(sql, owner, meaning);
  check("merging it back sets its card aside", (await cards()).find((c) => c.meaning_id === meaning)!.suspended);

  // ------------------------------------------------------------- unlocking
  const john = await setName(sql, owner, "约翰", true);
  const johnCard = await sentenceCard("约翰喝茶。");
  check("marking a name unlocks the sentence it was blocking", john.unlocked === 1 && Boolean(johnCard) && !johnCard.suspended);
  const news = (await queue(3, [], 30)).filter((c) => c.kind === "sentence" && c.isNew);
  check("a just-unlocked sentence goes first among the new ones", news[0]?.id === johnCard.id, news[0]?.sentence?.zh);
  const gone = await setName(sql, owner, "约翰", false);
  check("unmarking it locks the sentence again", gone.relocked === 1 && (await sentenceCard("约翰喝茶。")).suspended);

  const s = await getSummary(sql, owner, dayN(3));
  check("the counts add up", s.words === 8 && s.sentences === 14 && s.readable === 12 && s.readable + s.oneAway + s.locked === 14, JSON.stringify(s));
  check("word cards are the Read cards plus the Recall cards opened", s.wordCards === 9 && s.recallCards === 1);

  // ------------------------------------------------------------- filters
  const plain = await nextCards(sql, owner, dayN(4), { limit: 30, position: 0, exclude: [], skipWords: [], recall: false, sentences: false, at: noon(4) });
  check("a session can leave out Recall and sentence cards", plain.length > 0 && plain.every((c) => c.kind === "read"), plain.map((c) => c.kind[0]).join(""));
  const reading = await nextCards(sql, owner, dayN(4), { limit: 30, position: 0, exclude: [], skipWords: [], read: false, recall: false, at: noon(4) });
  check("or everything but sentences", reading.length > 0 && reading.every((c) => c.kind === "sentence"), reading.map((c) => c.kind[0]).join(""));
  const full = await queue(4);
  check("and has them when they aren't left out", full.some((c) => c.kind === "produce") && full.some((c) => c.kind === "sentence"));

  // --------------------------------------------------------------- stats
  const st = await getStats(sql, owner, dayN(3));
  const answers = st.days.reduce((t, d) => t + d.good + d.forgot, 0);
  check("stats count each answer once, by study day", st.days.length === 3 && answers === 8 && st.totalReviews === 8, st.days.map((d) => `${d.day.slice(8)}:${d.good}+${d.forgot}`).join(" "));
  check("time spent is added up", st.days.reduce((t, d) => t + d.ms, 0) === 8 * 4000);
  const read = st.retention.find((x) => x.kind === "read")!;
  check("retention is Got it over answers, per kind of card", read.all.good === 1 && read.all.total === 2);
  check("the hour is the device's, not the server's", st.hours.length === 1 && st.hours[0].hour === 14 && st.hours[0].total === 8, JSON.stringify(st.hours));
  check("forgotten words are listed, tapped ones included", st.hardest.map((h) => h.word).sort().join() === "水,茶");
  check("every card is somewhere in the stages", Object.values(st.maturity).reduce((t, m) => t + m.fresh + m.young + m.mature + m.retired, 0) === (await cards()).filter((c) => !c.suspended).length);
  check("the forecast holds what is scheduled ahead", st.dueNow.words > 0 && st.forecast.length === 30);

  // ---------------------------------------------------------------- replay
  // Nothing but the log: start each card where its first review found it and
  // apply every answer and every revival in order of arrival.
  const log = (await sql`
    select id, seq::int as seq, card_id::int as card_id, grade, (extract(epoch from at) * 1000)::double precision as at,
           before, after, effects
    from chongfuxi_review where owner_email = ${owner} order by seq
  `) as unknown as Array<{ id: string; seq: number; card_id: number; grade: Grade; at: number; before: Schedule; after: Schedule; effects: { revived?: number[]; cutoff?: number } }>;
  const state = new Map<number, Schedule>();
  let agree = true;
  for (const e of log) {
    const start = state.get(e.card_id) ?? e.before;
    if (JSON.stringify(pick(start)) !== JSON.stringify(pick(e.before))) agree = false;
    const next = answer(pick(start), e.grade, Math.round(e.at));
    if (JSON.stringify(next) !== JSON.stringify(pick(e.after))) agree = false;
    state.set(e.card_id, next);
    for (const id of e.effects.revived ?? []) state.set(id, { ...state.get(id)!, due: e.effects.cutoff! });
  }
  const now = new Map((await cards()).map((c) => [c.id, c]));
  const matches = [...state].every(([id, st]) => now.get(id)!.due === st.due && Math.abs(now.get(id)!.stability - st.stability) < 1e-9);
  check(`replaying the ${log.length} reviews reproduces every answer`, agree);
  check("and leaves every reviewed card where the database has it", matches, `${state.size} cards`);
}

const pick = (s: Schedule): Schedule => ({
  state: s.state,
  due: s.due,
  stability: s.stability,
  difficulty: s.difficulty,
  reps: s.reps,
  lapses: s.lapses,
  scheduledDays: s.scheduledDays,
  lastReview: s.lastReview,
});

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(async () => {
    // The review log is append-only for a real owner; the invented one is swept away.
    for (const table of ["chongfuxi_review", "chongfuxi_card", "chongfuxi_meaning", "chongfuxi_sentence", "chongfuxi_word", "chongfuxi_settings", "chongfuxi_import"]) {
      await sql.query(`delete from ${table} where owner_email = $1`, [owner]);
    }
    const left = (await sql`
      select (select count(*) from chongfuxi_card where owner_email = ${owner})
           + (select count(*) from chongfuxi_token where owner_email = ${owner})
           + (select count(*) from chongfuxi_review where owner_email = ${owner}) as n
    `) as unknown as Array<{ n: string }>;
    console.log(`\ncleaned up: ${Number(left[0].n) === 0 ? "nothing left for this owner" : `${left[0].n} rows LEFT BEHIND`}`);
    console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
    process.exit(failed ? 1 : 0);
  });
