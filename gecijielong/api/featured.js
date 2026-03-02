import sql from "../lib/db.js";

export default async function handler(req, res) {
  const [line] = await sql`
    SELECT ll.*, s.title as song, s.artist, s.album, s.year
    FROM lyric_lines ll
    JOIN songs s ON s.id = ll.song_id
    WHERE s.lrclib_status = 'found'
    ORDER BY RANDOM()
    LIMIT 1
  `;
  res.json({ line });
}
