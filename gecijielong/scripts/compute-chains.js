import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log("Computing chains...");

  const { count: charCount } = await sql`
    INSERT INTO chains (from_line_id, to_line_id, match_type, connecting_value)
    SELECT a.id, b.id, 'char', a.end_char
    FROM lyric_lines a
    JOIN lyric_lines b ON b.start_char = a.end_char AND b.song_id != a.song_id
    ON CONFLICT DO NOTHING
  `.then(r => ({ count: r.count }));
  console.log(`  字 chains: ${charCount}`);

  const { count: pinyinCount } = await sql`
    INSERT INTO chains (from_line_id, to_line_id, match_type, connecting_value)
    SELECT a.id, b.id, 'pinyin', a.end_pinyin
    FROM lyric_lines a
    JOIN lyric_lines b ON b.start_pinyin = a.end_pinyin AND b.song_id != a.song_id AND a.end_pinyin != ''
    ON CONFLICT DO NOTHING
  `.then(r => ({ count: r.count }));
  console.log(`  拼音 chains: ${pinyinCount}`);

  const { count: tonelessCount } = await sql`
    INSERT INTO chains (from_line_id, to_line_id, match_type, connecting_value)
    SELECT a.id, b.id, 'toneless', a.end_pinyin_toneless
    FROM lyric_lines a
    JOIN lyric_lines b ON b.start_pinyin_toneless = a.end_pinyin_toneless AND b.song_id != a.song_id AND a.end_pinyin_toneless != ''
    ON CONFLICT DO NOTHING
  `.then(r => ({ count: r.count }));
  console.log(`  无声调 chains: ${tonelessCount}`);

  console.log("Done!");
}

main().catch(console.error);
