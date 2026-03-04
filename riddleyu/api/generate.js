// api/generate.js — called by Vercel cron job daily at midnight ET
// Also callable manually: GET /api/generate?date=YYYY-MM-DD&force=true
// Protected by CRON_SECRET env var (set in Vercel dashboard)

import Anthropic from '@anthropic-ai/sdk'
import { kv } from '@vercel/kv'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `You are a Chinese language educator specializing in 成语 (chéngyǔ — four-character idioms).
Your job is to generate a daily puzzle for a game called RiddleYu.

You will output ONLY valid JSON, no markdown, no explanation, no preamble.`

const USER_PROMPT = (date, usedChengyu, fixedChengyu) => `Generate a RiddleYu puzzle for ${date}.
${fixedChengyu ? `\nYou MUST use this exact 成语: ${fixedChengyu.join('')} (${fixedChengyu.join('、')}). Do not choose a different one.\n` : ''}${!fixedChengyu && usedChengyu.length > 0 ? `\nDo NOT use any of these 成语, they have already been used: ${usedChengyu.join('、')}\n` : ''}
Rules:
1. ${fixedChengyu ? `Use the 成语 ${fixedChengyu.join('')} specified above.` : 'Choose a 成语 that is interesting, learnable, and not too obscure. Suitable for beginners to intermediate learners.'}
2. For each of the 4 characters, choose exactly 3 imposter characters. Imposters must:
   - Be common, recognizable Chinese characters
   - NOT appear elsewhere in the 成语
   - For TYPE C (场景谜): same semantic category as the real character
   - For TYPE A (字谜) / TYPE B (形谜): visually similar to the real character (shared components, similar stroke count, or easily confused shape)
3. Write a riddle for each character using ONE of these three types:

TYPE A: 字谜 (Character Composition)
Use when: the character has 2+ clearly decomposable components (radicals/parts).
Format: a short poetic sentence describing how the parts combine — without naming the character.
Examples:
  - 告 (gào): text="一口吃掉牛尾巴。" translation="One mouth eats the cow's tail." hint="牛 (without its last stroke) + 口 = 告"
  - 功 (gōng): text="出力又出工，缺一不可。" translation="Effort and labor — neither can be missing." hint="工 (work) + 力 (strength) = 功"
  - 明 (míng): text="日月同辉，照亮天地。" translation="Sun and moon shine together, lighting heaven and earth." hint="日 (sun) + 月 (moon) = 明"
  - 好 (hǎo): text="女子相伴，其乐无穷。" translation="A woman and child together — boundless joy." hint="女 (woman) + 子 (child) = 好"
  - 休 (xiū): text="人倚木而眠，停下了脚步。" translation="A person leans against a tree and rests, pausing their steps." hint="亻(person) + 木 (tree) = 休"
  - 石 (shí): text="山崖下藏着一张嘴，坚硬千年。" translation="A mouth hidden beneath a cliff — hard for a thousand years." hint="厂 (cliff/overhang) + 口 (mouth) = 石"
  - 到 (dào): text="持刀而至，方才到达。" translation="Carry a blade beside 'arrive' — and you've gotten there." hint="至 (to reach) + 刂 (knife radical) = 到"

TYPE B: 形谜 (Visual/Shape Riddle)
Use when: the character is visually simple — few strokes, geometric, or iconic in shape.
Format: describe what you see when looking at the character — without naming it.
Examples:
  - 一 (yī): text="万物之始，我只有一笔，横贯天地。" translation="The beginning of all things — just one stroke, crossing heaven and earth." hint="A single horizontal line — the simplest character"
  - 三 (sān): text="三根横骨叠起来，一根比一根长。" translation="Three horizontal bones stacked, each longer than the last." hint="Three horizontal strokes"
  - 二 (èr): text="比一多一笔，比三少一笔，两横平行。" translation="One more stroke than one, one fewer than three — two parallel lines." hint="Two horizontal strokes, one above the other"
  - 山 (shān): text="中间高，两边低，三峰并立。" translation="High in the middle, low on both sides — three peaks standing together." hint="Three peaks, the center one tallest"
  - 口 (kǒu): text="四面有墙，中间是空的，是个方框。" translation="Walls on all four sides, empty in the middle — a square frame." hint="A simple square shape"
  - 人 (rén): text="两腿叉开站稳了，撑起天地。" translation="Two legs spread apart, standing firm, holding up heaven and earth." hint="Two diagonal strokes, like a person standing"

TYPE C: 场景谜 (Scene Riddle)
Use when: the character doesn't decompose cleanly, or TYPE A/B don't produce an interesting riddle.
Format: a vivid, specific scenario that points to the character — NOT a broad category. "我是一种动物" is forbidden. The scene must require real inference.
Examples:
  - 马 (mǎ): text="皇帝出征，骑着我才能打天下。" translation="The emperor rides me to conquer the realm." hint="A powerful animal ridden by warriors and emperors into battle"
  - 鸟 (niǎo): text="春天清晨，我在树梢叫醒你。" translation="On a spring morning, I wake you from the treetop." hint="A feathered creature that sings at dawn"
  - 成 (chéng): text="万事开头难，坚持到最后，空白变成了我。" translation="Everything is hard at first — persist to the end, and emptiness becomes me." hint="What happens when a task is finally finished — accomplished, complete"
  - 功 (gōng, if not using 字谜): text="十年苦读，才能得到我。" translation="Ten years of hard study — only then can you earn me." hint="What you gain after long effort — merit, achievement"
  - 石 (shí, if not using 字谜): text="山里沉睡千年，斧头也奈我不何。" translation="Asleep in the mountains for a thousand years — even an axe struggles with me." hint="A hard, ancient natural material found in mountains and riverbeds"

4. For each riddle the hint (shown only when player taps the hint button) must be:
   - TYPE A: the component breakdown, e.g. "工 (work) + 力 (strength) = 功"
   - TYPE B: a plain visual description, e.g. "Two horizontal strokes, one above the other"
   - TYPE C: a direct English clue pointing to the semantic category
5. The grid array must contain all 16 characters (4 real + 12 imposters) shuffled randomly.

Output this exact JSON shape:
{
  "date": "${date}",
  "chengyu": ["字","字","字","字"],
  "pinyin": "xxx xxx xxx xxx",
  "meaning": "English meaning of the idiom",
  "origin": "One sentence about the origin or historical context in English",
  "origin_zh": "同一个故事，用简单的中文写，一到两句话",
  "riddles": [
    { "type": "字谜|形谜|场景谜", "text": "Chinese riddle for char 1", "translation": "English translation of the riddle", "hint": "English hint" },
    { "type": "字谜|形谜|场景谜", "text": "Chinese riddle for char 2", "translation": "English translation of the riddle", "hint": "English hint" },
    { "type": "字谜|形谜|场景谜", "text": "Chinese riddle for char 3", "translation": "English translation of the riddle", "hint": "English hint" },
    { "type": "字谜|形谜|场景谜", "text": "Chinese riddle for char 4", "translation": "English translation of the riddle", "hint": "English hint" }
  ],
  "grid": ["字",...16 chars shuffled...]
}`

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  // Check for existing puzzle
  let fixedChengyu = null
  let usedChengyu = []

  try {
    const existing = await kv.get(`puzzle:${date}`)
    if (existing) {
      if (req.query.force !== 'true') {
        return res.status(200).json({ status: 'already cached', date })
      }
      // Force regen — reuse same 成语
      fixedChengyu = existing.chengyu
    }
  } catch (e) {
    console.error('KV read error:', e)
  }

  // Fetch used 成语 to avoid duplicates (only needed when picking a new one)
  if (!fixedChengyu) {
    try {
      usedChengyu = (await kv.get('used_chengyu')) || []
    } catch (e) {
      console.error('KV read error (used_chengyu):', e)
    }
  }

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: USER_PROMPT(date, usedChengyu, fixedChengyu) }],
    })

    const puzzle = JSON.parse(message.content[0].text.trim())

    await kv.set(`puzzle:${date}`, puzzle)
    if (!fixedChengyu) {
      await kv.set('used_chengyu', [...usedChengyu, puzzle.chengyu.join('')])
    }

    return res.status(200).json({ status: 'generated', date })
  } catch (e) {
    console.error('Generation error:', e)
    return res.status(500).json({ error: 'Failed to generate puzzle', detail: e.message })
  }
}
