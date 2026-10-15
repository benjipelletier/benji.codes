// Checks which definition is shown where only one has room (lib/senses.ts),
// on the cases the owner reported. Pure: no database.
//
//   npx tsx chongfuxi/scripts/check-senses.ts

import type { Definition } from "../lib/dict";
import { mainEntry, mainSenses, votedEntry } from "../lib/senses";

let failed = 0;
function check(what: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail === undefined ? "" : `  (${JSON.stringify(detail)})`}`);
  if (!ok) failed++;
}

const ji: Definition[] = [
  { p: "ji1", senses: ["small table"] },
  { p: "ji1", senses: ["(literary) almost"] },
  { p: "ji3", senses: ["how many; how much", "several; a few"] },
];
check("几 read jǐ is 'how many', not jī's 'small table'", mainSenses(ji, "ji3")[0] === "how many; how much");

const xian: Definition[] = [
  { p: "xian2", own: true, senses: ["salted; salty"] },
  { p: "xian2", senses: ["all", "everyone", "each"] },
  { p: "xian2", senses: ["salted", "salty", "stingy"] },
  { p: "Xian2", senses: ["surname Xian"] },
];
check("咸 is 'salty', as the owner's own definition says, not 'all'", mainSenses(xian, "xian2")[0] === "salted");

const jiaoshou: Definition[] = [
  { p: "jiao1@shou4", senses: ["to teach (a subject)"] },
  { p: "jiao4@shou4", senses: ["professor"] },
];
check("教授 read jiàoshòu is 'professor'", mainSenses(jiaoshou, "jiao4@shou4")[0] === "professor");

const mi: Definition[] = [{ p: "mi3", senses: ["uncooked rice", "meter (unit of length)", "(slang) Chinese yuan"] }];
check("米 under a sentence about meters leads with 'meter'", mainSenses(mi, "mi3", { en: "He effortlessly ran the 1,000 meters." })[0] === "meter (unit of length)");
check("and with no sentence keeps the dictionary's first", mainSenses(mi, "mi3")[0] === "uncooked rice");

const ben: Definition[] = [
  { p: "ben3", senses: ["(bound form) root; stem", "(bound form) origin; source", "(bound form) one's own; this", "originally; initially", "classifier for books, periodicals, files etc"] },
];
check("本 under 那本书 brings the classifier sense into the three shown", mainSenses(ben, "ben3", { en: "That book is mine." })[0].startsWith("classifier for books"));

const yun: Definition[] = [
  { p: "yun2", senses: ["(classical) to say"] },
  { p: "yun2", senses: ["cloud"] },
  { p: "Yun2", senses: ["surname Yun"] },
];
check("云 is 'cloud', not the classical 'to say'", mainEntry(yun, "yun2")?.senses[0] === "cloud");

const nian: Definition[] = [
  { p: "nian2", senses: ["year"] },
  { p: "nian2", senses: ["grain; harvest (old)"] },
];
check("年 is 'year', an old sense later in an entry still marks it", mainEntry(nian, "nian2")?.senses[0] === "year");

const zhi: Definition[] = [
  { p: "zhi3", senses: ["only; merely; just"] },
  { p: "zhi1", senses: ["grain that has begun to ripen"] },
  { p: "zhi1", senses: ["classifier for birds and certain animals, one of a pair, some utensils, vessels etc"] },
];
const birds = ["Two birds sat on the branch.", "I have a cat and two birds.", "Three little birds.", "A pair of shoes."];
check("只's sentences choose the classifier over 'grain'", votedEntry([zhi[1], zhi[2]], birds) === zhi[2]);
check("an unclear vote chooses nothing", votedEntry([zhi[1], zhi[2]], ["The grain was ripe.", "Two birds."]) === null);

const own: Definition[] = [{ p: "", own: true, senses: ["my own gloss"] }];
check("a word with no dictionary entry shows the owner's own definition", mainSenses(own, null)[0] === "my own gloss");

console.log(failed ? `\n${failed} checks failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
