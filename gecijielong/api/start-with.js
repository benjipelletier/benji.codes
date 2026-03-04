import sql from "../lib/db.js";

export default async function handler(req, res) {
  const { char, mode = "char" } = req.query;

  if (!char) {
    // Return suggested starting lines (popular lines with many onward chains)
    const suggested = await sql`
      SELECT
        ll.id, ll.text, ll.start_char, ll.end_char, ll.start_pinyin, ll.end_pinyin,
        ll.start_pinyin_toneless, ll.end_pinyin_toneless, ll.timestamp_ms,
        s.title as song, s.artist, s.album, s.year,
        s.album_art_url, s.preview_url, s.spotify_url,
        (SELECT COUNT(*) FROM chains c WHERE c.from_line_id = ll.id AND c.match_type = 'pinyin') as connections
      FROM lyric_lines ll
      JOIN songs s ON s.id = ll.song_id
      WHERE s.lrclib_status = 'found'
      ORDER BY connections DESC, RANDOM()
      LIMIT 6
    `;
    return res.json({ lines: suggested });
  }

  // Find lines starting with the given character, ordered by richness
  // Deduplicate by text (same line can appear in multiple songs)
  const lines = await sql`
    SELECT * FROM (
      SELECT DISTINCT ON (ll.text)
        ll.id, ll.text, ll.start_char, ll.end_char, ll.start_pinyin, ll.end_pinyin,
        ll.start_pinyin_toneless, ll.end_pinyin_toneless, ll.timestamp_ms,
        s.title as song, s.artist, s.album, s.year,
        s.album_art_url, s.preview_url, s.spotify_url,
        (SELECT COUNT(*) FROM chains c WHERE c.from_line_id = ll.id AND c.match_type = ${mode}) as connections
      FROM lyric_lines ll
      JOIN songs s ON s.id = ll.song_id
      WHERE ll.start_char = ${char}
        AND s.lrclib_status = 'found'
      ORDER BY ll.text, connections DESC
    ) deduped
    ORDER BY connections DESC
    LIMIT 20
  `;

  res.json({ lines });
}
