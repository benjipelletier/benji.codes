// Put first, among a word's equally fitting dictionary entries, the one its
// sentences are about (app/api/chongfuxi/defs.ts). Imports and additions do
// this as they go; this does it for every word at once.
//
//   npx tsx --env-file=.env.local chongfuxi/scripts/order-defs.ts [--dry-run]

import { getDb } from "../../app/api/chongfuxi/db";
import { orderStoredDefs } from "../../app/api/chongfuxi/defs";

const owner = process.env.CHONGFUXI_OWNER_EMAIL || process.env.LONGKU_OWNER_EMAIL || process.env.JAZZ_OWNER_EMAIL;
if (!owner) throw new Error("No owner in the environment (CHONGFUXI_OWNER_EMAIL).");
const dry = process.argv.includes("--dry-run");

orderStoredDefs(getDb(), owner, null, dry).then((changed) => {
  console.log(`${dry ? "would reorder" : "reordered"} ${changed.length} words: ${changed.join(" ")}`);
  process.exit(0);
});
