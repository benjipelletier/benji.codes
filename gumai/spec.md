# 古脉 (Gǔmài) — Ancient Veins

## Product Spec v1.1 — Part 1: Design & Data

---

## Vision

古脉 is a living, fog-of-war knowledge map that grows one node per day across Chinese dynastic history. It lives at `benji.codes/gumai` as a self-contained page within the benji.codes repo.

Each day, a new node appears on the map — a 成语, a cultural concept, a historical figure, or a character with deep etymology. The node is visible but isolated, floating in fog. When the player completes a micro-challenge associated with the node, its connections to existing nodes reveal themselves — ink brushstrokes bleeding across silk, linking this new piece to the growing web of Chinese cultural knowledge.

Over weeks and months, the map becomes a dense, interconnected constellation spanning dynasties. The journey begins at 夏/商/周 and moves forward chronologically. Users who return after a month find a world that didn't exist before.

**The daily loop:** Show up → see the new node pulsing in the fog → complete the challenge → watch connections appear → explore the broader map.

**The meta-experience:** The map's evolution history (changelog) is visible to users. The growth of the map is part of the content.

---

## Design Principles

1. **Mobile first.** This is a phone experience. Touch targets, swipe gestures, thumb-reachable interactions. Desktop is a nice-to-have that scales up gracefully.
2. **One hand, one minute.** The daily challenge should be completable in under 60 seconds with one thumb.
3. **The map is the reward.** Beauty and growth are the motivation, not points or streaks.
4. **Accumulation over novelty.** Each day adds to a persistent structure. The value compounds.

---

## Aesthetic Direction: Ink & Silk

The visual world draws from Song dynasty ink wash painting (水墨画). The entire experience should feel like an ancient scroll being slowly revealed.

### Palette

- **Background:** Aged silk — warm off-white with subtle texture, not pure white. `#F5F0E8` to `#EDE4D3` with subtle noise/grain overlay.
- **Ink:** Rich blacks and grays for nodes and text. Not flat black — varied opacity like real ink wash. `#1A1A1A` to `#4A4A4A`.
- **Fog:** Misty gray-white washes. Fog of war should literally look like mountain mist from a Song landscape. Semi-transparent layers with soft edges.
- **Connections:** Ink brushstroke lines between nodes. Varying thickness, slightly imperfect, calligraphic quality. Opacity varies with age — older connections more faded.
- **Accent:** Vermillion red (朱红 `#C23B22`) used very sparingly — seal stamps on completed nodes, today's node highlight. The only color that pops.
- **Dynasty labels:** Muted stone gray or faded gold, rendered classically.

### Typography

- **Chinese text:** Noto Serif SC for body content. Ma Shan Zheng or ZCOOL XiaoWei for display headings and dynasty labels.
- **English/pinyin:** Cormorant Garamond for body, Playfair Display for headings.
- The typography should feel printed on paper, not rendered on screen.

### Visual Details

- Nodes render as ink dots/circles — varying size by importance, slight bleed effect at edges.
- Completed nodes get a faint vermillion seal stamp (印章) overlay.
- Fog of war is a gradual atmospheric fade, not a hard mask — layered mist obscuring what's beyond.
- Connections animate in like brushstrokes being drawn when revealed.
- Subtle paper grain texture across the entire viewport.
- The overall feel: contemplative, scholarly, beautiful.

---

## Mobile-First Map Rendering

### Approach: d3-force with SVG

Use d3-force for organic graph layout with SVG rendering for nodes and connections. The map is pannable and zoomable via touch gestures.

### Mobile Interaction Model

- **Viewport:** The map fills the full screen. No chrome except a minimal top bar with the 古脉 title and a changelog icon.
- **Pan:** Single-finger drag to pan the map.
- **Zoom:** Pinch to zoom. Zoomed out shows the full dynasty timeline, zoomed in shows individual nodes with labels.
- **Tap node:** Opens the node detail or challenge (slide-up panel).
- **Initial view:** On load, the map auto-centers and zooms to today's new node. A subtle pulse animation draws the eye.
- **Navigation hint:** After completing today's challenge, a gentle prompt suggests exploring the rest of the map. First-time users get a brief onboarding overlay.

### d3-force Configuration

```typescript
const simulation = d3.forceSimulation(nodes)
  .force("x", d3.forceX(d => dynastyToX(d.dynasty)).strength(0.8))
  .force("y", d3.forceY(viewportHeight / 2).strength(0.05))
  .force("collide", d3.forceCollide(NODE_RADIUS * 2.5))
  .force("link", d3.forceLink(connections).distance(80).strength(0.3))
  .force("charge", d3.forceManyBody().strength(-50));
```

### Dynasty Timeline Mapping

```typescript
const DYNASTY_POSITIONS: Record<string, { x: number; label: string }> = {
  '夏':       { x: 0,    label: '夏' },
  '商':       { x: 200,  label: '商' },
  '西周':     { x: 400,  label: '西周' },
  '春秋':     { x: 650,  label: '春秋' },
  '战国':     { x: 900,  label: '战国' },
  '秦':       { x: 1100, label: '秦' },
  '西汉':     { x: 1300, label: '西汉' },
  '东汉':     { x: 1500, label: '东汉' },
  '三国':     { x: 1700, label: '三国' },
  '晋':       { x: 1900, label: '晋' },
  '南北朝':   { x: 2100, label: '南北朝' },
  '隋':       { x: 2300, label: '隋' },
  '唐':       { x: 2500, label: '唐' },
  '北宋':     { x: 2750, label: '北宋' },
  '南宋':     { x: 2950, label: '南宋' },
  '元':       { x: 3150, label: '元' },
  '明':       { x: 3400, label: '明' },
  '清':       { x: 3650, label: '清' },
  '近现代':   { x: 3900, label: '近现代' },
};
```

### Fog of War Rendering

- SVG `<filter>` with `feTurbulence` and `feGaussianBlur` for misty organic fog texture.
- Each completed node clears fog in a soft circle. Fog layer is a mask subtracting revealed areas.
- Uncompleted nodes (other than today's): CSS `filter: blur(4px) opacity(0.3)`.
- Today's node pierces the fog — fully visible, gently pulsing with vermillion glow.

### Responsive Scaling

- **Mobile (< 768px):** Full-bleed map. Slide-up panel for challenges/details. Touch gestures. Node labels hidden at default zoom, visible when zoomed in.
- **Desktop (≥ 768px):** Same map, more spacing. Side panel instead of slide-up. Mouse wheel zoom, click-drag pan. Node labels visible at default zoom.

---

## Challenge UI: Slide-Up Panel

When the user taps today's node (or any uncompleted node), a panel slides up from the bottom covering ~60% of the screen.

- Map remains visible above, slightly dimmed.
- The tapped node stays visible above the panel — maintains spatial context.
- Drag handle at top to dismiss (swipe down to close).
- On completion, panel shows the reveal (origin story, connections), then user dismisses and watches connections animate on the map.

### Panel States

**Challenge mode (uncompleted):** Node title in large display type, dynasty tag, the challenge UI. Minimal — just the challenge.

**Reveal mode (just completed):** Seal stamp, full content (origin story / bio / etymology / explanation), list of connections revealed with relationship labels. Tap a connected node name to pan the map to it.

**Detail mode (revisiting completed):** Same as reveal mode, for reference.

---

## Node Types

### 1. 成语 (Chéngyǔ)

**Content JSON:**
```json
{
  "origin_story": "string — vivid retelling of the historical origin",
  "source_text": "string — original text reference (e.g. 韩非子·五蠹)",
  "modern_usage": "string — how it's used today",
  "example_sentence": "string — Chinese example sentence",
  "example_pinyin": "string",
  "example_english": "string"
}
```

**Challenge types:** `reconstruct` (tap 4 correct characters in order from 6-8 options), `match_origin` (pick correct origin from 3), `fill_blank` (pick correct 成语 for a sentence from 3).

**Challenge JSON (reconstruct):**
```json
{
  "type": "reconstruct",
  "data": {
    "characters": ["守", "株", "待", "兔"],
    "distractors": ["树", "免", "寺", "朱"],
    "hint": "A farmer waits by a tree stump..."
  }
}
```

### 2. Historical Figures (历史人物)

**Content JSON:**
```json
{
  "bio": "string — 2-3 sentences focused on cultural significance",
  "key_contribution": "string",
  "fun_fact": "string — lesser-known fascinating detail",
  "related_works": ["string array"]
}
```

**Challenge types:** `match_achievement` (match figure to contribution from 3), `match_era` (place in correct dynasty from 4), `match_connection` (which existing node connects to this figure).

**Challenge JSON (match_achievement):**
```json
{
  "type": "match_achievement",
  "data": {
    "question": "What is 韩非子 best known for?",
    "correct": "Unifying Legalist thought into a system of law, statecraft, and authority",
    "distractors": [
      "Writing the first Chinese dictionary",
      "Establishing the Confucian academy system"
    ]
  }
}
```

### 3. Characters with Deep Etymology (字源)

**Content JSON:**
```json
{
  "modern_meaning": "string",
  "radical": "string",
  "stroke_count": "number",
  "etymology": "string — how it evolved from pictograph to modern form",
  "evolution": ["string array — one entry per script stage"],
  "derived_characters": ["string array — related characters with brief explanations"],
  "cultural_note": "string — connection to Five Elements, philosophy, etc."
}
```

**Challenge types:** `match_radical` (what does the pictograph depict, pick from 3), `identify_composition` (which character combines X with Y, pick from 3), `match_meaning` (match ancient description to modern character).

**Challenge JSON (match_radical):**
```json
{
  "type": "match_radical",
  "data": {
    "question": "In its earliest oracle bone form, 木 was a pictograph of what?",
    "correct": "A tree with branches above and roots below",
    "distractors": [
      "A person standing with arms outstretched",
      "A house with a peaked roof"
    ]
  }
}
```

### 4. Cultural Concepts (文化概念)

**Content JSON:**
```json
{
  "explanation": "string — nuanced explanation of the concept",
  "historical_roots": "string — when and why this became important",
  "modern_relevance": "string — how it manifests today",
  "related_concepts": ["string array"]
}
```

**Challenge types:** `scenario` (which concept fits this situation, pick from 3), `match_origin` (match to philosophical school from 3), `match_definition` (match to English definition from 3).

**Challenge JSON (scenario):**
```json
{
  "type": "scenario",
  "data": {
    "scenario": "The Shang dynasty falls because its last king is cruel. The Zhou claim the right to replace them.",
    "question": "Which concept justified this transfer of power?",
    "correct": "天命 — the Mandate of Heaven",
    "distractors": [
      "面子 — maintaining social reputation",
      "缘分 — predestined affinity between people"
    ]
  }
}
```

---

## Data Model (Neon Postgres)

### `gumai_nodes`

```sql
CREATE TABLE gumai_nodes (
  id            SERIAL PRIMARY KEY,
  date_added    DATE NOT NULL UNIQUE,
  day_number    INTEGER NOT NULL,
  node_type     TEXT NOT NULL CHECK (node_type IN ('chengyu', 'figure', 'character', 'concept')),
  dynasty       TEXT NOT NULL,
  title         TEXT NOT NULL UNIQUE,
  pinyin        TEXT NOT NULL,
  english       TEXT NOT NULL,
  content       JSONB NOT NULL,
  challenge     JSONB NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW()
);
```

### `gumai_connections`

```sql
CREATE TABLE gumai_connections (
  id            SERIAL PRIMARY KEY,
  source_id     INTEGER REFERENCES gumai_nodes(id),
  target_id     INTEGER REFERENCES gumai_nodes(id),
  relationship  TEXT NOT NULL,
  label         TEXT,
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(source_id, target_id, relationship)
);
```

### `gumai_changelog`

```sql
CREATE TABLE gumai_changelog (
  id            SERIAL PRIMARY KEY,
  day_number    INTEGER NOT NULL,
  date          DATE NOT NULL,
  entry         TEXT NOT NULL,
  node_id       INTEGER REFERENCES gumai_nodes(id),
  created_at    TIMESTAMP DEFAULT NOW()
);
```

Node positions are NOT stored — computed client-side by d3-force using dynasty timeline mapping and connection graph.

---

## User State (localStorage)

Key: `gumai_progress`

```json
{
  "completedNodes": [1, 2, 3, 5],
  "lastVisit": "2025-06-15",
  "firstVisit": "2025-06-01"
}
```

On load, fetch all nodes/connections from API, cross-reference with `completedNodes` to determine fog state.


# 古脉 (Gǔmài) — Ancient Veins

## Product Spec v1.1 — Part 2: Pipeline, Seed Data & Architecture

---

## Daily Generation Pipeline

### Architecture

```
Vercel Cron (daily at 06:00 UTC) → /api/gumai/generate → Anthropic API → Validate → Write to Neon
```

### Vercel Cron Config

In `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/gumai/generate",
      "schedule": "0 6 * * *"
    }
  ]
}
```

### How the Generation Works

The API route fetches the **full current state** from Neon — all existing nodes and connections — trims it to a compact summary, and sends it to the Anthropic API so Claude can make intelligent, non-duplicate, well-connected decisions about what to add next.

### Step 1: Build Context from DB

```typescript
// Fetch current state
const nodes = await db.query(
  'SELECT id, day_number, node_type, dynasty, title, pinyin, english FROM gumai_nodes ORDER BY day_number'
);
const connections = await db.query(
  'SELECT source_id, target_id, relationship, label FROM gumai_connections'
);
const lastNode = nodes[nodes.length - 1];

// Build trimmed context (compact, one line per node)
const nodeContext = nodes.map(n =>
  `[${n.id}] ${n.title} (${n.pinyin}) — ${n.node_type}, ${n.dynasty}: ${n.english}`
).join('\n');

const connectionContext = connections.map(c =>
  `${c.source_id} → ${c.target_id}: ${c.relationship}${c.label ? ` (${c.label})` : ''}`
).join('\n');

// Track type distribution for rotation
const recentTypes = nodes.slice(-4).map(n => n.node_type);
const typeCounts = { chengyu: 0, figure: 0, character: 0, concept: 0 };
nodes.forEach(n => typeCounts[n.node_type]++);
```

### Step 2: The Generation Prompt

```typescript
const systemPrompt = `You are the content engine for 古脉 (Gǔmài), a daily-growing knowledge map of Chinese cultural history. You generate one new node per day.

RULES:
1. CHRONOLOGICAL: The map expands forward through Chinese dynasties. Current frontier: the dynasty of the most recent node. Add nodes at or slightly ahead of the frontier. Occasionally reach back to an earlier dynasty if a strong connection justifies it.
2. NO DUPLICATES: Never generate a node with the same title as any existing node.
3. NODE TYPE ROTATION: Cycle through types. The last 4 were: [${recentTypes.join(', ')}]. Pick a different type if possible. Overall distribution should be roughly balanced.
4. CONNECTIONS ARE MANDATORY: Every new node MUST connect to at least 1 existing node (ideally 2-3). Connections should be meaningful — shared characters, related meanings, same origin text, teacher/student, same theme. Cross-dynasty connections are especially valuable.
5. CONNECTION TARGETS MUST EXIST: Only reference node IDs from the existing nodes list below.
6. CONTENT QUALITY: Origin stories should be specific and vivid. Figures should highlight fascinating lesser-known details. Characters should trace real etymology. Concepts should connect to lived modern experience.
7. DIFFICULTY CURVE: Day ${lastNode ? lastNode.day_number + 1 : 1}. Days 1-14: accessible, well-known content. Gradually increase obscurity.
8. CHALLENGE DESIGN: Distractors should be plausible but clearly wrong to someone who reads carefully. Never trivially easy or unfairly hard.
9. CHANGELOG: Write a brief, poetic changelog entry (1-3 lines) in the style of a chronicle.

Content and challenge objects must match the schemas for the chosen node_type exactly (see Part 1 of spec for schemas).

Respond ONLY with a JSON object. No markdown, no explanation, no preamble.`;

const userPrompt = `EXISTING NODES:
${nodeContext || '(none — this is Day 1)'}

EXISTING CONNECTIONS:
${connectionContext || '(none yet)'}

CURRENT DAY: ${lastNode ? lastNode.day_number + 1 : 1}
CURRENT DYNASTY FRONTIER: ${lastNode?.dynasty || '夏'}
NODE TYPE DISTRIBUTION: ${JSON.stringify(typeCounts)}

Generate the next node. Respond with ONLY this JSON:

{
  "node": {
    "node_type": "chengyu" | "figure" | "character" | "concept",
    "dynasty": "dynasty name from standard list",
    "title": "Chinese text — the 成语, character, name, or concept",
    "pinyin": "full pinyin with tone marks",
    "english": "brief English meaning (1 sentence)",
    "content": { ... },
    "challenge": { ... }
  },
  "connections": [
    {
      "target_id": number,
      "relationship": "string",
      "label": "string or null"
    }
  ],
  "changelog_entry": "poetic chronicle entry"
}`;
```

### Step 3: Validate

```typescript
function validateGeneration(result: any, existingNodes: any[]): string[] {
  const errors: string[] = [];
  const existingIds = existingNodes.map(n => n.id);
  const existingTitles = new Set(existingNodes.map(n => n.title));

  if (!result.node || !result.connections || !result.changelog_entry)
    errors.push('Missing top-level fields');

  if (!['chengyu', 'figure', 'character', 'concept'].includes(result.node?.node_type))
    errors.push('Invalid node_type');

  if (existingTitles.has(result.node?.title))
    errors.push(`Duplicate title: ${result.node.title}`);

  for (const conn of result.connections || []) {
    if (!existingIds.includes(conn.target_id))
      errors.push(`Invalid connection target: ${conn.target_id}`);
  }

  if (result.connections?.length === 0 && existingNodes.length > 0)
    errors.push('Must have at least 1 connection');

  if (!result.node?.challenge?.type || !result.node?.challenge?.data)
    errors.push('Invalid challenge structure');

  return errors;
}
```

If validation fails, retry once with errors appended to the prompt. If it fails again, skip the day.

### Step 4: Write to DB

```typescript
// Insert node
const newNode = await db.query(
  `INSERT INTO gumai_nodes (date_added, day_number, node_type, dynasty, title, pinyin, english, content, challenge)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
   RETURNING id`,
  [today, dayNumber, node.node_type, node.dynasty, node.title, node.pinyin, node.english, node.content, node.challenge]
);

// Insert connections (source = new node, target = existing node)
for (const conn of connections) {
  await db.query(
    `INSERT INTO gumai_connections (source_id, target_id, relationship, label)
     VALUES ($1, $2, $3, $4)`,
    [newNode.id, conn.target_id, conn.relationship, conn.label]
  );
}

// Insert changelog
await db.query(
  `INSERT INTO gumai_changelog (day_number, date, entry, node_id)
   VALUES ($1, $2, $3, $4)`,
  [dayNumber, today, changelog_entry, newNode.id]
);
```

### Security

```typescript
const authHeader = request.headers.get('authorization');
if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}

// Also check we haven't already generated today
const existing = await db.query(
  'SELECT id FROM gumai_nodes WHERE date_added = $1', [today]
);
if (existing.length > 0) {
  return Response.json({ message: 'Already generated today' }, { status: 200 });
}
```

---

## Seed Data

Pre-insert these three nodes so the game launches with a small cluster.

### Day 1: 守株待兔

```json
{
  "id": 1,
  "date_added": "2025-06-01",
  "day_number": 1,
  "node_type": "chengyu",
  "dynasty": "春秋",
  "title": "守株待兔",
  "pinyin": "shǒu zhū dài tù",
  "english": "To guard a tree stump waiting for rabbits — relying on luck instead of effort.",
  "content": {
    "origin_story": "A farmer in the state of Song was plowing his field when a rabbit ran headlong into a tree stump and broke its neck. Delighted by this free meal, the farmer abandoned his plow and sat by the stump day after day, waiting for another rabbit to appear. His fields went to ruin, and he became the laughingstock of Song. The Legalist philosopher 韩非子 recorded this story to argue against clinging to old methods in a changing world.",
    "source_text": "韩非子·五蠹",
    "modern_usage": "Used to describe someone who relies on a past stroke of luck instead of putting in real effort. Often used as gentle criticism.",
    "example_sentence": "你不能守株待兔，要主动去找工作机会。",
    "example_pinyin": "Nǐ bù néng shǒuzhūdàitù, yào zhǔdòng qù zhǎo gōngzuò jīhuì.",
    "example_english": "You can't just sit around waiting for luck — go actively look for job opportunities."
  },
  "challenge": {
    "type": "reconstruct",
    "data": {
      "characters": ["守", "株", "待", "兔"],
      "distractors": ["树", "免", "寺", "朱"],
      "hint": "A farmer waits by a tree stump for a rabbit that will never come..."
    }
  }
}
```

**Changelog:** "守株待兔 emerged from the mists of 春秋. A farmer, a tree stump, and a rabbit — the first node takes root on the map."

**Connections:** None (origin point).

---

### Day 2: 韩非子

```json
{
  "id": 2,
  "date_added": "2025-06-02",
  "day_number": 2,
  "node_type": "figure",
  "dynasty": "战国",
  "title": "韩非子",
  "pinyin": "Hán Fēizǐ",
  "english": "Legalist philosopher who synthesized political theory around law, power, and statecraft.",
  "content": {
    "bio": "韩非子 was a prince of the declining state of Han during the Warring States period. A student of the great Confucian scholar 荀子, he ultimately rejected Confucian idealism in favor of a hard-nosed philosophy of governance through strict law and institutional power. His writings so impressed the king of Qin that he was summoned to the Qin court — but political rivalry led to his imprisonment and death by forced suicide.",
    "key_contribution": "Synthesized the three strands of Legalist thought — 法 (law), 术 (statecraft), and 势 (authority) — into a unified political philosophy that became the blueprint for Qin dynasty governance.",
    "fun_fact": "He had a severe stutter that made public speaking nearly impossible. His inability to speak drove him to become one of the most brilliant and prolific writers of the ancient world.",
    "related_works": ["韩非子·五蠹", "韩非子·说难", "韩非子·孤愤"]
  },
  "challenge": {
    "type": "match_achievement",
    "data": {
      "question": "What is 韩非子 best known for?",
      "correct": "Unifying Legalist thought into a system of law, statecraft, and authority",
      "distractors": [
        "Writing the first Chinese dictionary",
        "Establishing the Confucian academy system"
      ]
    }
  }
}
```

**Connection:** `{ source: 2, target: 1, relationship: "author_of_source", label: "Recorded the story of 守株待兔 in 韩非子·五蠹" }`

**Changelog:** "韩非子 appeared in the gathering storm of 战国. The stuttering prince who couldn't speak — so he wrote the book that would reshape an empire. A brushstroke connects him to 守株待兔, the tale he immortalized."

---

### Day 3: 木

```json
{
  "id": 3,
  "date_added": "2025-06-03",
  "day_number": 3,
  "node_type": "character",
  "dynasty": "商",
  "title": "木",
  "pinyin": "mù",
  "english": "Tree; wood. One of the oldest pictographs and a foundational radical.",
  "content": {
    "modern_meaning": "tree, wood, timber; wooden; numb",
    "radical": "木 (radical 75 — it is its own radical)",
    "stroke_count": 4,
    "etymology": "One of the most recognizable pictographs in Chinese writing. The oracle bone form from the Shang dynasty clearly depicts a tree — a vertical trunk with branches spreading above and roots reaching below. Over millennia it simplified, but the tree is still visible.",
    "evolution": [
      "Oracle bone (商): A tree with spreading branches above and roots below",
      "Bronze script (周): Branches and roots simplified to diagonal strokes",
      "Seal script (秦): Further abstracted, tree form still recognizable",
      "Modern (楷书): The familiar 木 — horizontal stroke for branches, downward strokes for roots"
    ],
    "derived_characters": [
      "林 (lín) — two trees: a grove, forest",
      "森 (sēn) — three trees: dense forest, dark, strict",
      "本 (běn) — tree with a mark at the root: origin, root, basis",
      "末 (mò) — tree with a mark at the top: tip, end",
      "果 (guǒ) — fruit hanging on a tree: fruit, result"
    ],
    "cultural_note": "木 is one of the Five Elements (五行). It represents growth, spring, the east, and the color green. In traditional Chinese medicine, it governs the liver."
  },
  "challenge": {
    "type": "match_radical",
    "data": {
      "question": "In its earliest oracle bone form, 木 was a pictograph of what?",
      "correct": "A tree with branches above and roots below",
      "distractors": [
        "A person standing with arms outstretched",
        "A house with a peaked roof"
      ]
    }
  }
}
```

**Connection:** `{ source: 3, target: 1, relationship: "shared_character_component", label: "株 contains the 木 radical — a tree stump is literally a wooden stump" }`

**Changelog:** "木 took root in the ancient soil of 商. Before there were words, there were pictures — and 木 was a picture of a tree. A vein of ink connects it to 守株待兔, for what is a 株 but a 木 that stands alone?"

---

## File Structure

```
gumai/
├── page.tsx                       # Main page — map + daily flow
├── components/
│   ├── Map.tsx                    # d3-force SVG map with pan/zoom (touch-first)
│   ├── Node.tsx                   # Individual node rendering (ink dot + label)
│   ├── Connection.tsx             # Brushstroke SVG path between nodes
│   ├── FogOfWar.tsx               # SVG filter fog layer
│   ├── ChallengePanel.tsx         # Slide-up challenge panel
│   ├── NodeDetail.tsx             # Slide-up detail view for completed nodes
│   ├── Changelog.tsx              # Chronicle panel
│   ├── ReconstructChallenge.tsx   # 成语 character reconstruction UI
│   ├── MatchChallenge.tsx         # Multiple choice challenge UI
│   ├── ScenarioChallenge.tsx      # Scenario-based challenge UI
│   └── Onboarding.tsx             # First-visit overlay
├── lib/
│   ├── types.ts                   # TypeScript types
│   ├── db.ts                      # Neon queries
│   ├── generation.ts              # Anthropic API generation logic + prompt
│   ├── validation.ts              # Generation output validation
│   ├── dynasties.ts               # Dynasty timeline config + position mapping
│   └── progress.ts                # localStorage read/write helpers
├── api/
│   └── gumai/
│       ├── generate/route.ts      # Daily cron generation endpoint
│       ├── nodes/route.ts         # GET all nodes + connections
│       └── changelog/route.ts     # GET changelog entries
└── EVOLUTION_RULES.md             # Human-readable rules (referenced by generation prompt)
```

---

## API Routes

### `GET /api/gumai/nodes`

Returns all nodes and connections. Called on page load.

```typescript
{
  nodes: GumaiNode[],
  connections: GumaiConnection[],
  today: number | null  // today's node ID
}
```

### `GET /api/gumai/changelog`

Returns all changelog entries, newest first.

```typescript
{
  entries: {
    day_number: number,
    date: string,
    entry: string,
    node_title: string
  }[]
}
```

### `POST /api/gumai/generate` (cron only)

Protected by `CRON_SECRET`. Generates next node, validates, writes to DB.

---

## Growth Trajectory

### Week 1-2 (夏/商/西周)

Foundation. Major 成语 with ancient origins, foundational characters (木, 水, 人, 山, 日, 月), legendary figures (大禹, 周公, 姜子牙), bedrock concepts (天命, 礼). Sparse but rich — 7-14 nodes. Connections mostly within-dynasty.

### Week 3-6 (东周: 春秋/战国)

Golden age. 成语 source material explodes. Hundred Schools of Thought (孔子, 老子, 孙子, 墨子, 庄子). Concepts like 仁, 义, 道, 法. Cross-connections form densely. The map comes alive.

### Month 2-3 (秦/汉/三国)

Empire-scale. Unification, bureaucracy, Silk Road. 三国 brings beloved figures and dramatic 成语. Buddhist concepts arrive. Long-range bridges back to 春秋战国 foundations.

### Month 4+ (晋 → 唐 → 宋 → ...)

100+ nodes. New nodes bridge distant eras. Poetry, Buddhist/Daoist synthesis, technological innovation. The map becomes a genuine reference resource.

---

## Open Questions

1. **Sound:** Ink-drop or brush-stroke sounds on connection reveal? Beautiful but adds complexity. Consider as future enhancement.
2. **Sharing:** "I just uncovered 卧薪尝胆 on 古脉" — social sharing for growth. Future feature.
3. **Missed days:** If a user skips 5 days, they have 5 uncompleted nodes. Recommendation: let them complete in any order — free exploration.
4. **Mobile performance:** d3-force on 100+ nodes — profile early. Freeze simulation after layout settles, only re-run when new nodes added.
5. **Scaling context:** As the map grows past ~200 nodes, the generation context will get large. Consider trimming to: last 20 nodes in full detail + all older nodes as just `[id] title — type, dynasty` + all connections. This keeps the prompt under token limits while preserving connection awareness.
