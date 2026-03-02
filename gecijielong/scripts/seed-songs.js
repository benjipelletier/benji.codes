import { neon } from "@neondatabase/serverless";
import XLSX from "xlsx";

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const wb = XLSX.readFile("./data/chinese_songs_final.xlsx");
  const ws = wb.Sheets["Songs"];
  const rows = XLSX.utils.sheet_to_json(ws);

  let count = 0;
  for (const row of rows) {
    await sql`
      INSERT INTO songs (title, artist, album, year, genre, region)
      VALUES (
        ${row["Title (歌名)"]},
        ${row["Artist (歌手)"]},
        ${row["Album (专辑)"] || null},
        ${row["Year (年份)"] || null},
        ${row["Genre (类型)"] || null},
        ${row["Region (地区)"] || null}
      )
      ON CONFLICT DO NOTHING
    `;
    count++;
  }
  console.log(`Seeded ${count} songs`);
}

main().catch(console.error);
