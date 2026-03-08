import sql from "../lib/db.js";

export default async function handler(req, res) {
  const { line_id, mode = "pinyin" } = req.query;

  if (!line_id) {
    return res.status(400).json({ error: "line_id is required" });
  }

  if (!["char", "pinyin", "toneless"].includes(mode)) {
    return res.status(400).json({ error: "Invalid mode" });
  }

  const chains = await sql`
    SELECT * FROM (
      SELECT DISTINCT ON (s.id)
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
          'timestamp_ms', ll.timestamp_ms,
          'song', s.title,
          'artist', s.artist,
          'album', s.album,
          'year', s.year,
          'album_art_url', s.album_art_url,
          'preview_url', s.preview_url,
          'spotify_url', s.spotify_url
        ) as to_line,
        (SELECT COUNT(*) FROM chains c2 WHERE c2.from_line_id = ll.id AND c2.match_type = ${mode}) as connections,
        (
          (${mode} = 'char' AND ll.end_char = ll.start_char) OR
          (${mode} = 'pinyin' AND ll.end_pinyin = ll.start_pinyin) OR
          (${mode} = 'toneless' AND ll.end_pinyin_toneless = ll.start_pinyin_toneless)
        ) as is_loop
      FROM chains c
      JOIN lyric_lines ll ON ll.id = c.to_line_id
      JOIN songs s ON s.id = ll.song_id
      WHERE c.from_line_id = ${line_id}
        AND c.match_type = ${mode}
      ORDER BY s.id, connections DESC
    ) deduped
    ORDER BY is_loop ASC, connections DESC
    LIMIT 20
  `;

  res.json({ chains });
}
