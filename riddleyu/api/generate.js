import Anthropic from '@anthropic-ai/sdk'
import { kv } from '@vercel/kv'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a Chinese language educator specializing in 成语 (chéngyǔ — four-character idioms).
You generate daily puzzles for a deduction game called RiddleYu.
You will output ONLY valid JSON, no markdown, no explanation, no preamble.`

const PUZZLE_PROMPT = (date, usedChengyu, forceChengyu) => `Generate a RiddleYu puzzle for ${date}.
${usedChengyu.length > 0 ? `\nDo NOT use any of these 成语 (already used):\n${usedChengyu.join('、')}\n` : ''}
${forceChengyu ? `\nYou MUST use this specific 成语: ${forceChengyu}\n` : ''}

## Game overview

A 4×4 grid of 16 Chinese characters. 4 form a 成语 (in order), grouped into 4 clusters of 4 characters each. Each cluster contains 1 correct character + 3 semantically related distractors.

The player finds clusters one at a time (in 成语 order). For each cluster:
1. A hint describes the shared theme of the 4 characters
2. Player selects the 4 matching characters from the grid
3. A lesson sentence explains what makes the correct character unique
4. Player picks the correct one

## How to construct the puzzle

**Step 1: Choose a 成语.**
Pick a well-known 成语 suitable for intermediate learners.

**Step 2: For each of the 4 characters, create a cluster of 4.**
Each cluster = 1 correct character + 3 distractors that share a semantic field:
- All 4 should genuinely relate to the same concept
- The distractors should be close enough that the player needs the lesson to distinguish
- All 16 characters across all clusters must be distinct

**Step 3: Write hints (one per cluster).**
Each hint is one sentence in Chinese describing what all 4 characters in the cluster have in common. Should be clear enough to find them in the grid.

**Step 4: Write lessons (one per cluster).**
Each lesson is one sentence in Chinese explaining what makes the correct character the right one. This teaches a real semantic distinction — not a riddle, a mini lesson. It should help the learner understand the difference between similar characters.

**Step 5: Write a story summary.**
1–2 sentences in Chinese explaining the idiom's origin and meaning.

## Output format

Output this exact JSON shape (no markdown, no extra text):
{
  "date": "${date}",
  "chengyu": {
    "chars": ["字","字","字","字"],
    "pinyin": "pīnyīn",
    "meaning": "English meaning"
  },
  "story": "Chinese story summary",
  "grid": ["字",...16 chars shuffled...],
  "clusters": [
    {
      "hint": "一句话描述这四个字的共同主题",
      "chars": ["字","字","字","字"],
      "answer": "字",
      "lesson": "一句话解释为什么这个字是正确的"
    },
    ...4 clusters total...
  ]
}`

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  let existing = null
  try {
    existing = await kv.get(`puzzle:${date}`)
    if (existing && req.query.force !== 'true') {
      return res.status(200).json({ status: 'already cached', date })
    }
  } catch (e) {
    console.error('KV read error:', e)
  }

  const forceChengyu = (req.query.force === 'true' && existing?.chengyu)
    ? existing.chengyu.chars.join('')
    : null

  let usedChengyu = []
  try {
    usedChengyu = (await kv.get('used_chengyu')) || []
  } catch (e) {
    console.error('KV read error (used_chengyu):', e)
  }

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: PUZZLE_PROMPT(date, usedChengyu, forceChengyu) }],
    })
    const puzzle = JSON.parse(msg.content[0].text.trim())

    // Validation
    if (!puzzle.chengyu?.chars || puzzle.chengyu.chars.length !== 4) {
      throw new Error('Invalid chengyu structure')
    }
    if (!puzzle.clusters || puzzle.clusters.length !== 4) {
      throw new Error('Need exactly 4 clusters')
    }
    if (!puzzle.grid || puzzle.grid.length !== 16) {
      throw new Error('Grid must have exactly 16 characters')
    }
    if (new Set(puzzle.grid).size !== 16) {
      throw new Error('Grid has duplicate characters')
    }
    for (let i = 0; i < 4; i++) {
      const c = puzzle.clusters[i]
      if (!c.chars || c.chars.length !== 4) {
        throw new Error(`Cluster ${i} must have exactly 4 characters`)
      }
      if (!c.chars.includes(c.answer)) {
        throw new Error(`Cluster ${i} answer must be in its chars`)
      }
      if (c.answer !== puzzle.chengyu.chars[i]) {
        throw new Error(`Cluster ${i} answer must match chengyu position ${i}`)
      }
    }

    await kv.set(`puzzle:${date}`, puzzle)

    const newEntry = puzzle.chengyu.chars.join('')
    if (!usedChengyu.includes(newEntry)) {
      await kv.set('used_chengyu', [...usedChengyu, newEntry])
    }

    return res.status(200).json({ status: 'generated', date, chengyu: newEntry })
  } catch (e) {
    console.error('Generation error:', e)
    return res.status(500).json({ error: 'Failed to generate puzzle', detail: e.message })
  }
}
