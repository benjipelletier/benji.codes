// Puzzle shape:
// {
//   date: "YYYY-MM-DD",
//   chengyu: ["字","字","字","字"],
//   pinyin: "...",
//   meaning: "...",
//   origin: "...",
//   story: [ { before, char, after }, x4 ]    ← narrative canvas
//   riddles: [ { emoji, witnesses: [{speaker, text, translation}], type, text, translation, hint }, x4 ]
//   grid: ["字", ...16 chars shuffled]
//   slotMap: [0..3 x16]
// }

export const HARDCODED_PUZZLES = [
  {
    date: "2026-02-26",
    chengyu: ["马", "到", "成", "功"],
    pinyin: "mǎ dào chéng gōng",
    meaning: "Immediate success upon arrival — achieving your goal the moment you begin.",
    origin: "A Song dynasty phrase describing a cavalry charge so swift and decisive that victory came the instant the horses arrived.",
    origin_zh: "宋朝时，人们用这句话形容骑兵冲锋，战马一到，胜利就来了。",
    story: [
      { before: '将军骑着', char: '马', after: '，一路疾驰，' },
      { before: '', char: '到', after: '达前线，敌军闻风丧胆，' },
      { before: '大获全', char: '成', after: '，凯旋而归，' },
      { before: '此乃盖世之', char: '功', after: '。' },
    ],
    riddles: [
      {
        emoji: '🐎',
        type: "场景谜",
        text: "皇帝出征，骑着我才能打天下。",
        translation: "The emperor rides me to conquer the realm.",
        hint: "A powerful animal ridden by warriors and emperors into battle",
        witnesses: [
          {
            speaker: '将军 · General Wei',
            text: '「凡我出征，必携此物。无它，如虎无翼。」',
            translation: 'Every time I rode to battle, I brought this. Without it, I was a tiger with no wings.',
          },
          {
            speaker: '史书 · The Chronicle',
            text: '「四蹄踏破云烟，一声嘶鸣破敌胆。」',
            translation: 'Four hooves tore through the morning mist. One cry shattered the enemy\'s will.',
          },
          {
            speaker: '将士们 · The Soldiers',
            text: '「将军的战🐎来了！冲啊！」',
            translation: 'The general\'s 🐎 has arrived! Charge!',
          },
        ],
      },
      {
        emoji: '🏁',
        type: "字谜",
        text: "持刀而至，方才到达。",
        translation: "Carry a blade beside 'arrive' — and you've gotten there.",
        hint: "至 (to reach) + 刂 (knife radical) = 到",
        witnesses: [
          {
            speaker: '信使 · The Messenger',
            text: '「三日三夜，未曾歇息，终于……」',
            translation: 'Three days and three nights, without rest, until finally…',
          },
          {
            speaker: '城门守卫 · Gate Guard',
            text: '「将军的旗帜出现在地平线上——他🏁了！」',
            translation: 'The general\'s banner appeared on the horizon — he has 🏁!',
          },
        ],
      },
      {
        emoji: '⚔️',
        type: "场景谜",
        text: "万事开头难，坚持到最后，空白变成了我。",
        translation: "Everything is hard at first — persist to the end, and emptiness becomes me.",
        hint: "What happens when a task is finally finished — accomplished, complete",
        witnesses: [
          {
            speaker: '皇帝 · The Emperor',
            text: '「百战百胜，此乃真英雄也。」',
            translation: 'A hundred battles, a hundred victories — this is a true hero.',
          },
          {
            speaker: '老将 · The Veteran',
            text: '「年轻时我问，何为⚔️？如今我知，乃万苦归一。」',
            translation: 'As a young man I asked: what is ⚔️? Now I know — ten thousand hardships become one.',
          },
        ],
      },
      {
        emoji: '🌟',
        type: "字谜",
        text: "出力又出工，缺一不可。",
        translation: "Effort and labor — neither can be missing.",
        hint: "工 (work) + 力 (strength/effort) = 功",
        witnesses: [
          {
            speaker: '百姓 · The People',
            text: '「将军之名，千古流传。」',
            translation: 'The general\'s name will echo through the ages.',
          },
          {
            speaker: '老母亲 · His Mother',
            text: '「我儿啊，这一生的🌟，是你的，也是天下人的。」',
            translation: 'My son — this 🌟 belongs to you, and to all under heaven.',
          },
        ],
      },
    ],
    grid: ["龙", "来", "成", "果", "马", "为", "去", "绩", "虎", "到", "变", "行", "牛", "做", "功", "效"],
    slotMap: [0, 1, 2, 3, 0, 2, 1, 3, 0, 1, 2, 1, 0, 2, 3, 3],
  },
  {
    date: "2026-02-27",
    chengyu: ["一", "石", "二", "鸟"],
    pinyin: "yī shí èr niǎo",
    meaning: "Kill two birds with one stone — achieving two goals with a single action.",
    origin: "A universal idiom describing elegant efficiency, found across many cultures. In Chinese it paints a vivid image of a single thrown stone felling two birds.",
    origin_zh: "用一块石头打下两只鸟，比喻一个行动同时达到两个目的。",
    story: [
      { before: '猎人举起', char: '一', after: '块石，' },
      { before: '那块光滑的', char: '石', after: '头破空而去，' },
      { before: '竟同时打落', char: '二', after: '只，' },
      { before: '两只', char: '鸟', after: '同时落地，众人叫绝。' },
    ],
    riddles: [
      {
        emoji: '🪨',
        type: "形谜",
        text: "万物之始，我只有一笔，横贯天地。",
        translation: "The beginning of all things — just one stroke, crossing heaven and earth.",
        hint: "A single horizontal line — the simplest character",
        witnesses: [
          {
            speaker: '猎人 · The Hunter',
            text: '「只用了这🪨次，便成了。」',
            translation: 'Just this 🪨 throw — that\'s all it took.',
          },
          {
            speaker: '老哲人 · The Sage',
            text: '「万物始于此，🪨笔划开天地。」',
            translation: 'All things begin here — 🪨 stroke parts heaven from earth.',
          },
        ],
      },
      {
        emoji: '🗿',
        type: "字谜",
        text: "山崖下藏着一张嘴，坚硬千年。",
        translation: "A mouth hidden beneath a cliff — hard for a thousand years.",
        hint: "厂 (cliff/overhang) + 口 (mouth) = 石",
        witnesses: [
          {
            speaker: '田里的农夫 · The Farmer',
            text: '「那块🗿头，我都记得它的形状。」',
            translation: 'I still remember the shape of that 🗿.',
          },
          {
            speaker: '河边孩子 · The Riverside Child',
            text: '「我每天在河里摸🗿头，它又冷又硬，却握着我。」',
            translation: 'Every day I felt for 🗿s in the river — cold and hard, yet they held me.',
          },
        ],
      },
      {
        emoji: '✌️',
        type: "形谜",
        text: "比一多一笔，比三少一笔，两横平行。",
        translation: "One more stroke than one, one fewer than three — two parallel lines.",
        hint: "Two horizontal strokes, one above the other",
        witnesses: [
          {
            speaker: '旁观者 · The Bystander',
            text: '「不是一只，是✌️只！我亲眼见到！」',
            translation: 'Not one — ✌️! I saw it with my own eyes!',
          },
          {
            speaker: '集市商人 · The Market Merchant',
            text: '「他用一枚铜钱换到了✌️件好货，这才叫本事。」',
            translation: 'He traded one coin for ✌️ fine goods — now that\'s skill.',
          },
        ],
      },
      {
        emoji: '🐦',
        type: "场景谜",
        text: "春天清晨，我在树梢叫醒你。",
        translation: "On a spring morning, I wake you from the treetop.",
        hint: "A feathered creature that sings at dawn — look for it in the spring sky",
        witnesses: [
          {
            speaker: '树上的鸦 · The Crow',
            text: '「那天我也在场，风声变了，然后——」',
            translation: 'I was there that day. The wind shifted, and then—',
          },
          {
            speaker: '猎人的妻 · The Hunter\'s Wife',
            text: '「他每次出门，总说要打只🐦回来。那次回来了两只。」',
            translation: 'Every time he left, he said he\'d bring back a 🐦. That day he came back with two.',
          },
        ],
      },
    ],
    grid: ["一", "石", "二", "鸟", "三", "木", "三", "鱼", "七", "土", "两", "蝶", "万", "水", "双", "虫"],
    slotMap: [0, 1, 2, 3, 0, 3, 0, 3, 0, 1, 2, 3, 0, 1, 2, 3],
  },
]

function isValidPuzzle(p) {
  return p?.story && p?.riddles?.[0]?.witnesses && p?.riddles?.[0]?.emoji
}

export async function getPuzzleForDate(dateStr) {
  if (import.meta.env.DEV) {
    return HARDCODED_PUZZLES.find(p => p.date === dateStr) || HARDCODED_PUZZLES[0]
  }
  try {
    const res = await fetch(`/api/puzzle?date=${dateStr}`)
    const puzzle = await res.json()
    if (isValidPuzzle(puzzle)) return puzzle
  } catch {}
  // KV has stale/old-format data — fall back to hardcoded until cron regenerates
  return HARDCODED_PUZZLES[0]
}

export function getTodayString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}
