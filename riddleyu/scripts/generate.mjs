#!/usr/bin/env node
import { config } from 'dotenv'
config({ path: '.env.local' })
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@vercel/kv'
import { createInterface } from 'readline'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
})

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
- All 4 should genuinely relate to the same concept — they must ALL be valid examples of the category
- The distractors should be close enough that the player needs the lesson to distinguish
- Distractors must be REAL, convincing members of the category — never filler characters that obviously don't belong
- CRITICAL: All 16 characters across all 4 clusters must be completely distinct — no character may appear in more than one cluster. Double-check this before outputting.

**Step 3: Write hints (one per cluster).**
Use first-person riddle style from the perspective of the characters: "我们都能___" or "我们都是___" or "我们都和___有关".
The hint should be a playful one-sentence riddle that describes what all 4 characters in the cluster share. It must be clear enough to find them in the grid.
Examples: "我们都能在天上飞。" / "我们都是人体的一部分。" / "我们都和水有关。"

**Step 4: Write lessons (one per cluster).**
Use first-person style from the perspective of the correct character: "我是___" or "我能___" or "我的特点是___".
The lesson is one sentence explaining what makes this character unique among the 4. It teaches a real semantic distinction — not obvious, but educational. It should help the learner understand the difference between similar characters.
Examples: "我专指远处的眺望，还带着期盼的心情。" / "我是冬天开花的那一个，果实又酸又甜。"

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
      "hint": "我们都能/都是/都和___有关（第一人称谜语）",
      "chars": ["字","字","字","字"],
      "answer": "字",
      "lesson": "我是/我能/我的特点是___（第一人称，解释正确字的独特之处）"
    },
    ...4 clusters total...
  ]
}`

function validate(puzzle) {
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
  // Check all cluster chars are in grid
  const gridSet = new Set(puzzle.grid)
  for (const c of puzzle.clusters) {
    for (const ch of c.chars) {
      if (!gridSet.has(ch)) {
        throw new Error(`Cluster char "${ch}" not found in grid`)
      }
    }
  }
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans) }))
}

async function main() {
  const args = process.argv.slice(2)
  const date = args[0] || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const forceChengyu = args[1] || null // optional: pass a specific 成语

  console.log(`\n📅 Generating puzzle for ${date}...`)

  let usedChengyu = []
  try {
    usedChengyu = (await kv.get('used_chengyu')) || []
    console.log(`📋 ${usedChengyu.length} previously used 成语`)
  } catch (e) {
    console.error('⚠️  Could not read used_chengyu from KV:', e.message)
  }

  const MAX_ATTEMPTS = 5
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`\n🎲 Attempt ${attempt}/${MAX_ATTEMPTS}...`)
    try {
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: PUZZLE_PROMPT(date, usedChengyu, forceChengyu) }],
      })
      const raw = msg.content[0].text.trim()
      const puzzle = JSON.parse(raw)
      validate(puzzle)

      console.log(`\n✅ Valid puzzle generated!`)
      console.log(`   成语: ${puzzle.chengyu.chars.join('')} (${puzzle.chengyu.pinyin})`)
      console.log(`   Meaning: ${puzzle.chengyu.meaning}`)
      console.log(`   Grid: ${puzzle.grid.join(' ')}`)
      for (let i = 0; i < 4; i++) {
        const c = puzzle.clusters[i]
        console.log(`   Cluster ${i + 1}: [${c.chars.join(', ')}] → ${c.answer}`)
        console.log(`     Hint: ${c.hint}`)
        console.log(`     Lesson: ${c.lesson}`)
      }
      console.log(`   Story: ${puzzle.story}`)

      const answer = await ask(`\n💾 Save to KV as puzzle:${date}? (y/n) `)
      if (answer.toLowerCase() === 'y') {
        await kv.set(`puzzle:${date}`, puzzle)
        const newEntry = puzzle.chengyu.chars.join('')
        if (!usedChengyu.includes(newEntry)) {
          await kv.set('used_chengyu', [...usedChengyu, newEntry])
        }
        console.log('✅ Saved to KV!')
      } else {
        console.log('❌ Skipped.')
      }
      return
    } catch (e) {
      console.error(`❌ Attempt ${attempt} failed: ${e.message}`)
    }
  }
  console.error(`\n💀 All ${MAX_ATTEMPTS} attempts failed.`)
  process.exit(1)
}

main()
