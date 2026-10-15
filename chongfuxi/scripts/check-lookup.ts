// The check after Look up's model call, on a made-up answer: no database, no
// model. npx tsx chongfuxi/scripts/check-lookup.ts
//
// The answer cites one real count and one invented one, one sentence a tool
// returned and one it didn't, and has an option that isn't a dictionary word.

import assert from "node:assert/strict";
import { checkAnswer, type ModelAnswer } from "../../app/api/chongfuxi/lookup-check";
import { newSeen } from "../../app/api/chongfuxi/lookup-evidence";
import { dictEntry } from "../../app/api/chongfuxi/headwords";

const seen = newSeen();
seen.sentences.add(101);
seen.counts.set("得+抑郁症", new Set([3]));
seen.counts.set("抑郁症", new Set([7]));

const raw: ModelAnswer = {
  reading: { parts: [{ text: "develop", asked: true }, { text: "depression", asked: false }], kind: "pairing", note: "Asking about the verb." },
  frame: "___抑郁症",
  senses: [],
  gist: "Say 得了, or 患上 in writing. Not 发展.",
  options: [
    {
      zh: "得了",
      label: "",
      fits: true,
      verdict: "The everyday way to say you got an illness.",
      points: [
        { point: "pairing", says: "得 comes before 抑郁症 in 3 of your sentences", source: "corpus", count: 3 },
        { point: "frequency", says: "Very common", source: "corpus", count: 40 },
      ],
      examples: [101, 999],
      wrong: "",
      right: "",
    },
    {
      zh: "患上",
      label: "",
      fits: true,
      verdict: "More formal: news, medicine.",
      points: [{ point: "register", says: "Formal", source: "dictionary", count: -1 }],
      examples: [],
      wrong: "",
      right: "",
    },
    {
      zh: "发展",
      label: "",
      fits: false,
      verdict: "发展 is for things growing, not catching an illness.",
      points: [{ point: "meaning", says: "Develop as in grow", source: "model", count: -1 }],
      examples: [],
      wrong: "他发展了抑郁症。",
      right: "他得了抑郁症。",
    },
    { zh: "覅郁", label: "", fits: false, verdict: "made up", points: [], examples: [], wrong: "", right: "" },
  ],
  written: [{ zh: "她去年得了抑郁症。", en: "She developed depression last year." }],
  summary: "Your sentences use 得 with illnesses.",
};

const out = checkAnswer(raw, seen, {
  entry: (w) => dictEntry(w),
  sentences: new Map([[101, { id: 101, zh: "他得了抑郁症。", en: "He developed depression.", readable: true }]]),
});

const [deLe, huanShang, fazhan, fake] = out.options;
assert.equal(deLe.pinyin, "déle", "pinyin comes from the dictionary, as the app writes it");
assert.deepEqual(
  deLe.points.map((p) => [p.source, p.checked, p.count]),
  [["corpus", true, 3], ["model", false, null]],
  "a returned count stands; an invented one becomes the model's own",
);
assert.deepEqual(deLe.examples.map((e) => e.id), [101], "an example no tool returned is dropped");
assert.equal(huanShang.inDictionary, true);
assert.equal(huanShang.points[0].checked, true, "患上 is a headword, so the dictionary point stands");
assert.equal(fazhan.fits, false);
assert.equal(fazhan.right, "他得了抑郁症。");
assert.equal(fake.inDictionary, false, "two lone characters are not a dictionary word");
const pattern = checkAnswer(
  { ...raw, options: [{ ...raw.options[3], zh: "越…越…" }, { ...raw.options[3], zh: "打电话" }] },
  seen,
  { entry: (w) => dictEntry(w), sentences: new Map() },
);
assert.deepEqual(pattern.options.map((o) => o.inDictionary), [true, true], "a pattern of headwords, and a phrase with a real word in it, stand");
assert.equal(out.written.length, 1, "sentences the model wrote are kept, apart");
console.log(out.checks.join("\n"));
console.log("ok");
