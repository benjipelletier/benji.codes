import sql from "../../lib/db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const entries = await sql`
      SELECT cl.day_number, cl.date::text, cl.entry, gn.title as node_title
      FROM gumai_changelog cl
      JOIN gumai_nodes gn ON gn.id = cl.node_id
      ORDER BY cl.day_number DESC
      LIMIT 50
    `;

    return res.status(200).json({ entries });
  } catch (err) {
    console.error("changelog API error:", err);
    return res.status(500).json({ error: "Database error" });
  }
}
