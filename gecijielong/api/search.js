import sql from "../lib/db.js";

export default async function handler(req, res) {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: "q is required" });
  }

  const songs = await sql`
    SELECT id, title, artist, year, genre, region
    FROM songs
    WHERE title ILIKE ${"%" + q + "%"}
       OR artist ILIKE ${"%" + q + "%"}
    LIMIT 20
  `;
  res.json({ songs });
}
