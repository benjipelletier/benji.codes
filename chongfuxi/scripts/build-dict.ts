// Build chongfuxi/data/cedict.txt from CC-CEDICT.
//
//   curl -sL -o cedict.txt.gz https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
//   gunzip cedict.txt.gz
//   npx tsx chongfuxi/scripts/build-dict.ts cedict.txt
//
// Source: CC-CEDICT, https://www.mdbg.net/chinese/dictionary?page=cc-cedict,
// CC BY-SA 4.0. The output keeps headwords, readings and definitions, so it is
// a share-alike work and the app credits it wherever definitions are shown.
//
// One line per entry, tab-separated: simplified, traditional (empty when it is
// the same), pinyin as the source writes it, and the senses still joined by
// "/". Nothing is trimmed or reworded here; chongfuxi/lib/dict.ts decides what
// to show. Entries with no Chinese character in the headword are left out.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LINE = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/;
const HAN = /[㐀-䶿一-鿿豈-﫿]/;

const path = process.argv[2];
if (!path) {
  console.error("usage: build-dict.ts <path to cedict.txt>");
  process.exit(1);
}

const out: string[] = [];
let version = "";
let skipped = 0;
for (const line of readFileSync(path, "utf8").split("\n")) {
  if (line.startsWith("#! date=")) version = line.slice(8).trim();
  if (!line || line.startsWith("#")) continue;
  const m = line.match(LINE);
  if (!m || !HAN.test(m[2])) {
    skipped++;
    continue;
  }
  const [, trad, simp, pinyin, senses] = m;
  out.push(`${simp}\t${trad === simp ? "" : trad}\t${pinyin}\t${senses}`);
}

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "cedict.txt");
writeFileSync(target, `# CC-CEDICT ${version} — CC BY-SA 4.0 — https://www.mdbg.net/chinese/dictionary?page=cc-cedict\n${out.join("\n")}\n`);
console.log(`${out.length.toLocaleString("en-US")} entries -> ${target} (${skipped} left out)`);
