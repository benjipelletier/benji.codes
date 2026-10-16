// The check after Look up's model call, on a made-up answer: no database, no
// model. npx tsx chongfuxi/scripts/check-lookup.ts
//
// The answer's blocks cite one real count and one invented one, a sentence a
// tool returned and one it didn't, a family member with a count no tool gave,
// a scale point off the end, and a word that isn't a dictionary word. And an
// answer kept in the first shape (options) is turned into blocks.

import assert from "node:assert/strict";
import type { LookupAnswerV1 } from "@chongfuxi/lib/api";
import { checkAnswer, fromV1, mistakeKey, normaliseAnswer, type ModelAnswer } from "../../app/api/chongfuxi/lookup-check";
import { newSeen } from "../../app/api/chongfuxi/lookup-evidence";
import { dictEntry } from "../../app/api/chongfuxi/headwords";

const seen = newSeen();
seen.sentences.add(101);
seen.counts.set("得+抑郁症", new Set([3]));
seen.counts.set("得+感冒", new Set([7]));
seen.counts.set("抑郁症", new Set([7]));

const raw: ModelAnswer = {
  reading: { parts: [{ text: "develop", asked: true }, { text: "depression", asked: false }], kind: "pairing", note: "" },
  blocks: [
    { type: "example", id: 101, zh: "(the model's copy)", en: "" },
    { type: "wrong-right", wrong: "他发展了抑郁症。", right: "他得了抑郁症。", why: "发展 is for things that grow." },
    {
      type: "sense",
      items: [
        {
          zh: "得了",
          label: "spoken, everyday",
          why: "The everyday way to say someone got an illness.",
          points: [
            { point: "pairing", says: "得 comes before an illness in 3 of your sentences", source: "corpus", count: 3 },
            { point: "frequency", says: "Very common", source: "corpus", count: 40 },
          ],
          examples: [101, 999],
        },
      ],
    },
    {
      type: "gap",
      frame: "他去年___抑郁症。",
      options: [
        { zh: "得了", label: "spoken, everyday", fits: true, why: "" },
        { zh: "患上", label: "written, formal", fits: true, why: "" },
        { zh: "覅郁", label: "", fits: false, why: "made up" },
      ],
    },
    { type: "family", head: "得", rule: "+ an illness", members: [{ zh: "得感冒", count: 7 }, { zh: "得了癌症", count: 12 }] },
    { type: "scale", left: "good", middle: "neutral", right: "bad", points: [{ zh: "后果", gloss: "bad", at: 1.4 }, { zh: "结果", gloss: "result", at: 0.5 }] },
    { type: "gap", frame: "no gap here", options: [{ zh: "有", label: "", fits: false, why: "" }] },
  ],
  summary: "",
};

const out = checkAnswer(raw, seen, {
  entry: (w) => dictEntry(w),
  sentences: new Map([[101, { id: 101, zh: "他得了抑郁症。", en: "He developed depression.", readable: true }]]),
});

assert.deepEqual(
  out.blocks.map((b) => b.type),
  ["gap", "scale", "sense", "family", "wrong-right", "example"],
  "headline blocks first, examples last; a gap with no ___ is dropped",
);
const sense = out.blocks.find((b) => b.type === "sense")!;
assert.ok(sense.type === "sense");
assert.deepEqual(
  sense.items[0].points.map((p) => [p.source, p.checked, p.count]),
  [["corpus", true, 3], ["model", false, null]],
  "a returned count stands; an invented one becomes the model's own",
);
assert.deepEqual(sense.items[0].examples.map((e) => e.id), [101], "an example no tool returned is dropped");
assert.equal(sense.items[0].count, 3);
assert.equal(out.words["得了"].pinyin, "déle", "pinyin comes from the dictionary, as the app writes it");
assert.equal(out.words["覅郁"].inDictionary, false, "two lone characters are not a dictionary word");
const family = out.blocks.find((b) => b.type === "family")!;
assert.ok(family.type === "family");
assert.deepEqual(family.members.map((m) => m.count), [7, null], "a member's count stands only if a search returned it");
assert.deepEqual(out.words["得了癌症"].parts, ["得了", "癌症"], "a member phrase is shown as the words it splits into");
assert.equal(out.words["癌症"].pinyin, "áizhèng", "and each of those words has its own entry, to add");
assert.equal(out.words["得了"].parts, undefined, "a headword is not split");
const scale = out.blocks.find((b) => b.type === "scale")!;
assert.ok(scale.type === "scale");
assert.deepEqual(scale.points.map((p) => [p.zh, p.at]), [["结果", 0.5], ["后果", 1]], "points sorted, kept on the line");
const example = out.blocks.find((b) => b.type === "example")!;
assert.ok(example.type === "example");
assert.equal(example.zh, "他得了抑郁症。", "a cited sentence is shown as stored, not as the model copied it");
assert.equal(example.mine, true);

const old: LookupAnswerV1 = {
  query: "develop depression",
  model: "claude-haiku-5-5",
  at: 0,
  reading: raw.reading,
  frame: "___抑郁症",
  senses: [],
  options: [
    { zh: "得了", pinyin: "déle", gloss: null, inDictionary: true, fits: true, verdict: "Everyday.", points: [], examples: [], wrong: "", right: "" },
    { zh: "发展", pinyin: "fāzhǎn", gloss: null, inDictionary: true, fits: false, verdict: "Grows.", points: [], examples: [], wrong: "他发展了抑郁症。", right: "他得了抑郁症。" },
  ],
  written: [{ zh: "她得了抑郁症。", en: "She developed depression." }],
  summary: "Use 得了.",
  checks: [],
  usage: { input: 0, output: 0, calls: 0 },
};
assert.deepEqual(
  fromV1(old).blocks.map((b) => b.type),
  ["gap", "sense", "wrong-right", "example"],
  "an answer kept as options comes back as blocks",
);

// The answer as handed in through the tool, nothing enforcing its schema:
// a list sent as JSON text, "false" and "7" as strings, a block of no known
// type, fields missing.
const handed = normaliseAnswer({
  reading: { parts: [{ text: "develop", asked: "true" }], kind: "nonsense" },
  blocks: JSON.stringify([
    { type: "gap", frame: "___抑郁症", options: [{ zh: "发展", fits: "false" }] },
    { type: "mystery" },
    { type: "family", head: "得", members: [{ zh: "得感冒", count: "7" }] },
    "not a block",
  ]),
  summary: null,
});
assert.deepEqual(handed.blocks.map((b) => b.type), ["gap", "family"], "unknown blocks dropped, a list in JSON text read");
assert.deepEqual(handed.blocks[0], { type: "gap", frame: "___抑郁症", options: [{ zh: "发展", label: "", fits: false, why: "" }] });
assert.deepEqual(handed.blocks[1], { type: "family", head: "得", rule: "", members: [{ zh: "得感冒", count: 7 }] });
assert.deepEqual(handed.reading, { parts: [{ text: "develop", asked: true }], kind: "meaning", note: "" });
assert.equal(handed.summary, "");
for (const junk of [null, undefined, 3, "x", [], { blocks: 5 }, { blocks: [null, 1, []] }]) {
  assert.deepEqual(normaliseAnswer(junk).blocks, [], "junk gives no blocks, never a crash");
}

// What a warning is tested with in the owner's sentences: where the wrong
// version differs, a character either side.
assert.equal(mistakeKey("哪个站", "哪个车站"), "个站", "an insertion: the characters around it");
assert.equal(mistakeKey("发展抑郁症", "得了抑郁症 / 患上抑郁症"), "发展抑");
assert.equal(mistakeKey("越多越很好", "越多越好"), "越很好");
assert.equal(mistakeKey("他发展了抑郁症。", "他得了抑郁症。"), "他发展了");
assert.equal(mistakeKey("站", "车站"), null, "one character is too little to look for");
assert.equal(mistakeKey("哪个站", "哪个站"), null, "nothing differs");

// A word taken apart: its own characters only, each read as the word reads it.
const parts = checkAnswer(
  {
    reading: { parts: [{ text: "不着痕迹", asked: false }, { text: "character breakdown", asked: true }], kind: "breakdown", note: "" },
    blocks: [
      {
        type: "parts",
        word: "不着痕迹",
        chars: [
          { zh: "不", gloss: "not" },
          { zh: "着", gloss: "to touch" },
          { zh: "痕", gloss: "mark" },
          { zh: "迹", gloss: "trace" },
          { zh: "龙", gloss: "dragon" },
        ],
        literal: "not touching any mark or trace",
      },
    ],
    summary: "",
  },
  newSeen(),
  { entry: (w) => dictEntry(w), sentences: new Map() },
);
const pb = parts.blocks[0];
assert.ok(pb?.type === "parts");
assert.deepEqual(pb.chars.map((c) => [c.zh, c.pinyin, c.gloss]), [["不", "bù", "not"], ["着", "zhuó", "to touch"], ["痕", "hén", "mark"], ["迹", "jì", "trace"]], "着 read zhuó, as in this word; 龙 left out");
assert.ok(parts.checks.some((c) => c.includes("龙")), "the stray character is reported");
assert.equal(normaliseAnswer({ blocks: [{ type: "parts", word: "畅销", chars: "[{\"zh\":\"畅\",\"gloss\":\"freely\"}]" }] }).blocks.length, 1, "a parts block handed in survives the shape check");

// A sense's example where the word is only part of a longer one says so.
const inside = checkAnswer(
  {
    reading: { parts: [{ text: "县", asked: true }], kind: "meaning", note: "" },
    blocks: [{ type: "sense", items: [{ zh: "县", label: "county", why: "", points: [], examples: [7, 8] }] }],
    summary: "",
  },
  (() => {
    const s = newSeen();
    s.sentences.add(7);
    s.sentences.add(8);
    return s;
  })(),
  {
    entry: (w) => dictEntry(w),
    sentences: new Map([
      [7, { id: 7, zh: "县城离这有百儿八十里。", en: null, readable: false, words: ["县城", "离", "这", "有", "百儿八十", "里", "。"] }],
      [8, { id: 8, zh: "这个县很大。", en: null, readable: true, words: ["这个", "县", "很", "大", "。"] }],
    ]),
  },
);
const ex = inside.blocks[0]?.type === "sense" ? inside.blocks[0].items[0].examples : [];
assert.deepEqual(ex.map((e) => [e.id, e.within, e.readable]), [[7, "县城", false], [8, null, true]], "in 县城, locked; a word of its own");
assert.ok(!ex.some((e) => "words" in e), "the word list isn't kept with the answer");

// A grammar note: kept when it names a Chinese structure; its shape only when well formed; one at most.
const noted = checkAnswer(
  {
    reading: { parts: [{ text: "是围绕X转的", asked: true }], kind: "reading", note: "" },
    blocks: [
      { type: "note", title: "是…的", shape: "是{围绕X转}的", text: "是…的 marks how things are." },
      { type: "note", title: "把", shape: "", text: "A second one." },
      { type: "note", title: "frame", shape: "", text: "No Chinese in the title." },
    ],
    summary: "",
  },
  newSeen(),
  { entry: (w) => dictEntry(w), sentences: new Map() },
);
assert.deepEqual(noted.blocks, [{ type: "note", title: "是…的", shape: "是{围绕X转}的", text: "是…的 marks how things are." }]);
assert.ok(noted.checks.some((c) => c.includes("把")), "the second note is reported");
const badShape = checkAnswer(
  { reading: { parts: [], kind: "reading", note: "" }, blocks: [{ type: "note", title: "是…的", shape: "是{围绕{X}转的", text: "t" }], summary: "" },
  newSeen(),
  { entry: (w) => dictEntry(w), sentences: new Map() },
);
assert.equal(badShape.blocks[0]?.type === "note" && badShape.blocks[0].shape, "", "a malformed shape is dropped, the note kept");
assert.equal(normaliseAnswer({ blocks: [{ type: "note", title: "是…的", text: "x" }] }).blocks[0]?.type, "note", "a note handed in survives the shape check");

console.log(out.checks.join("\n"));
console.log("ok");
