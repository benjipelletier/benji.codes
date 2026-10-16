// The check after Look up's model call, on a made-up answer: no database, no
// model. npx tsx chongfuxi/scripts/check-lookup.ts
//
// The answer's blocks cite one real count and one invented one, a sentence a
// tool returned and one it didn't, a family member with a count no tool gave,
// a scale point off the end, and a word that isn't a dictionary word. And an
// answer kept in the first shape (options) is turned into blocks.

import assert from "node:assert/strict";
import type { LookupAnswerV1 } from "@chongfuxi/lib/api";
import { checkAnswer, fromV1, normaliseAnswer, type ModelAnswer } from "../../app/api/chongfuxi/lookup-check";
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

console.log(out.checks.join("\n"));
console.log("ok");
