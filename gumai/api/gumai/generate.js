import Anthropic from "@anthropic-ai/sdk";
import sql from "../../lib/db.js";

function validateGeneration(result, existingNodes) {
  const errors = [];
  const existingIds = existingNodes.map(n => n.id);
  const existingTitles = new Set(existingNodes.map(n => n.title));

  if (!result.node || !result.connections || !result.changelog_entry)
    errors.push("Missing top-level fields");

  if (!["chengyu", "figure", "character", "concept"].includes(result.node?.node_type))
    errors.push("Invalid node_type");

  if (existingTitles.has(result.node?.title))
    errors.push(`Duplicate title: ${result.node.title}`);

  for (const conn of result.connections || []) {
    if (!existingIds.includes(conn.target_id))
      errors.push(`Invalid connection target: ${conn.target_id}`);
  }

  if ((result.connections?.length === 0) && existingNodes.length > 0)
    errors.push("Must have at least 1 connection");

  if (!result.node?.challenge?.type || !result.node?.challenge?.data)
    errors.push("Invalid challenge structure");

  return errors;
}

async function generateNode(existingNodes, existingConnections, validationErrors = []) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const lastNode = existingNodes[existingNodes.length - 1];
  const recentTypes = existingNodes.slice(-4).map(n => n.node_type);
  const typeCounts = { chengyu: 0, figure: 0, character: 0, concept: 0 };
  existingNodes.forEach(n => { if (typeCounts[n.node_type] !== undefined) typeCounts[n.node_type]++; });

  const nodeContext = existingNodes.map(n =>
    `[${n.id}] ${n.title} (${n.pinyin}) — ${n.node_type}, ${n.dynasty}: ${n.english}`
  ).join("\n");

  const connectionContext = existingConnections.map(c =>
    `${c.source_id} → ${c.target_id}: ${c.relationship}${c.label ? ` (${c.label})` : ""}`
  ).join("\n");

  const systemPrompt = `You are the content engine for 古脉 (Gǔmài), a daily-growing knowledge map of Chinese cultural history. You generate one new node per day.

RULES:
1. CHRONOLOGICAL: The map expands forward through Chinese dynasties. Add nodes at or slightly ahead of the frontier. Occasionally reach back if a strong connection justifies it.
2. NO DUPLICATES: Never generate a node with the same title as any existing node.
3. NODE TYPE ROTATION: Cycle through types. The last 4 were: [${recentTypes.join(", ")}]. Pick a different type if possible.
4. CONNECTIONS ARE MANDATORY: Every new node MUST connect to at least 1 existing node (ideally 2-3). Connections should be meaningful — shared characters, related meanings, same origin text, teacher/student, same theme.
5. CONNECTION TARGETS MUST EXIST: Only reference node IDs from the existing nodes list.
6. CONTENT QUALITY: Origin stories should be specific and vivid. Figures should highlight lesser-known details. Characters should trace real etymology. Concepts should connect to modern experience.
7. DIFFICULTY CURVE: Day ${lastNode ? lastNode.day_number + 1 : 1}. Days 1-14: accessible. Gradually increase obscurity.
8. CHALLENGE DESIGN: Distractors should be plausible but clearly wrong on careful reading.
9. CHANGELOG: Write a brief poetic changelog entry (1-3 lines) in the style of a chronicle.

Node type schemas:
- chengyu content: {origin_story, source_text, modern_usage, example_sentence, example_pinyin, example_english}
- figure content: {bio, key_contribution, fun_fact, related_works}
- character content: {modern_meaning, radical, stroke_count, etymology, evolution, derived_characters, cultural_note}
- concept content: {explanation, historical_roots, modern_relevance, related_concepts}

Challenge types by node_type:
- chengyu: reconstruct {characters:[4], distractors:[2-4], hint} or match_origin or fill_blank
- figure: match_achievement {question, correct, distractors:[2]} or match_era or match_connection
- character: match_radical {question, correct, distractors:[2]} or identify_composition or match_meaning
- concept: scenario {scenario, question, correct, distractors:[2]} or match_origin or match_definition

Respond ONLY with a JSON object. No markdown, no explanation.${validationErrors.length ? `\n\nPREVIOUS ATTEMPT FAILED WITH ERRORS:\n${validationErrors.join("\n")}\nFix these issues.` : ""}`;

  const userPrompt = `EXISTING NODES:
${nodeContext || "(none — this is Day 1)"}

EXISTING CONNECTIONS:
${connectionContext || "(none yet)"}

CURRENT DAY: ${lastNode ? lastNode.day_number + 1 : 1}
CURRENT DYNASTY FRONTIER: ${lastNode?.dynasty || "夏"}
NODE TYPE DISTRIBUTION: ${JSON.stringify(typeCounts)}

Generate the next node. Respond with ONLY this JSON:

{
  "node": {
    "node_type": "chengyu|figure|character|concept",
    "dynasty": "dynasty name",
    "title": "Chinese text",
    "pinyin": "full pinyin with tone marks",
    "english": "brief English meaning (1 sentence)",
    "content": { ... },
    "challenge": { "type": "...", "data": { ... } }
  },
  "connections": [
    { "target_id": number, "relationship": "string", "label": "string or null" }
  ],
  "changelog_entry": "poetic chronicle entry"
}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const raw = message.content[0].text.trim();
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth check
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    // Idempotency check
    const existing = await sql`SELECT id FROM gumai_nodes WHERE date_added = ${today}`;
    if (existing.length > 0) {
      return res.status(200).json({ message: "Already generated today", nodeId: existing[0].id });
    }

    // Fetch current state
    const nodes = await sql`
      SELECT id, day_number, node_type, dynasty, title, pinyin, english
      FROM gumai_nodes ORDER BY day_number
    `;
    const connections = await sql`
      SELECT source_id, target_id, relationship, label FROM gumai_connections
    `;

    const dayNumber = (nodes[nodes.length - 1]?.day_number ?? 0) + 1;

    // Generate with retry
    let result;
    let errors = [];

    for (let attempt = 0; attempt < 2; attempt++) {
      result = await generateNode(nodes, connections, errors);
      errors = validateGeneration(result, nodes);
      if (errors.length === 0) break;
    }

    if (errors.length > 0) {
      console.error("Generation failed validation:", errors);
      return res.status(500).json({ error: "Generation failed validation", details: errors });
    }

    const { node, connections: newConns, changelog_entry } = result;

    // Write to DB
    const [newNode] = await sql`
      INSERT INTO gumai_nodes (date_added, day_number, node_type, dynasty, title, pinyin, english, content, challenge)
      VALUES (${today}, ${dayNumber}, ${node.node_type}, ${node.dynasty}, ${node.title}, ${node.pinyin}, ${node.english}, ${JSON.stringify(node.content)}, ${JSON.stringify(node.challenge)})
      RETURNING id
    `;

    for (const conn of newConns) {
      await sql`
        INSERT INTO gumai_connections (source_id, target_id, relationship, label)
        VALUES (${newNode.id}, ${conn.target_id}, ${conn.relationship}, ${conn.label ?? null})
        ON CONFLICT DO NOTHING
      `;
    }

    await sql`
      INSERT INTO gumai_changelog (day_number, date, entry, node_id)
      VALUES (${dayNumber}, ${today}, ${changelog_entry}, ${newNode.id})
    `;

    return res.status(200).json({ success: true, nodeId: newNode.id, title: node.title });
  } catch (err) {
    console.error("generate error:", err);
    return res.status(500).json({ error: err.message });
  }
}
