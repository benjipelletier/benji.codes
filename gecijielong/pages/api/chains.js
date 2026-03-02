import sql from "../../lib/db";

export default async function handler(req, res) {
  const { line_id, mode = "pinyin" } = req.query;

  if (!line_id) {
    return res.status(400).json({ error: "line_id is required" });
  }

  const chains = await sql`
    SELECT
      c.id,
      c.connecting_value,
      ll.id as to_line_id,
      ll.text as line,
      ll.start_char,
      ll.start_pinyin,
      ll.end_char,
      ll.end_pinyin,
      s.title as song,
      s.artist,
      s.album,
      s.year,
      json_build_object(
        'id', ll.id,
        'text', ll.text,
        'start_char', ll.start_char,
        'end_char', ll.end_char,
        'start_pinyin', ll.start_pinyin,
        'end_pinyin', ll.end_pinyin,
        'song', s.title,
        'artist', s.artist,
        'album', s.album,
        'year', s.year
      ) as to_line,
      (SELECT COUNT(*) FROM chains c2 WHERE c2.from_line_id = ll.id AND c2.match_type = ${mode}) as connections
    FROM chains c
    JOIN lyric_lines ll ON ll.id = c.to_line_id
    JOIN songs s ON s.id = ll.song_id
    WHERE c.from_line_id = ${line_id}
      AND c.match_type = ${mode}
    ORDER BY connections DESC
    LIMIT 20
  `;

  res.json({ chains });
}
