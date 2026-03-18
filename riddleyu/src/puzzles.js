// Puzzle shape:
// {
//   date: "YYYY-MM-DD",
//   chengyu: ["字","字","字","字"],
//   pinyin: "...",
//   meaning: "...",
//   origin: "...",
//   riddles: [ { text: "...", hint: "..." }, x4 ],
//   grid: ["字", ...16 chars shuffled]  // 4 real + 12 imposters, any can go in any slot
// }

export const HARDCODED_PUZZLES = [
  {
    date: "2026-02-26",
    chengyu: ["马", "到", "成", "功"],
    pinyin: "mǎ dào chéng gōng",
    meaning: "Immediate success upon arrival — achieving your goal the moment you begin.",
    origin: "A Song dynasty phrase describing a cavalry charge so swift and decisive that victory came the instant the horses arrived.",
    origin_zh: "宋朝时，人们用这句话形容骑兵冲锋，战马一到，胜利就来了。",
    riddles: [
      {
        type: "场景谜",
        text: "皇帝出征，骑着我才能打天下。",
        translation: "The emperor rides me to conquer the realm.",
        hint: "A powerful animal ridden by warriors and emperors into battle",
      },
      {
        type: "字谜",
        text: "持刀而至，方才到达。",
        translation: "Carry a blade beside 'arrive' — and you've gotten there.",
        hint: "至 (to reach) + 刂 (knife radical) = 到",
      },
      {
        type: "场景谜",
        text: "万事开头难，坚持到最后，空白变成了我。",
        translation: "Everything is hard at first — persist to the end, and emptiness becomes me.",
        hint: "What happens when a task is finally finished — accomplished, complete",
      },
      {
        type: "字谜",
        text: "出力又出工，缺一不可。",
        translation: "Effort and labor — neither can be missing.",
        hint: "工 (work) + 力 (strength/effort) = 功",
      },
    ],
    // 4 real chars + 3 imposters each, shuffled together (16 total)
    // Slot 0 (马): imposters 龙,虎,牛
    // Slot 1 (到): imposters 来,去,行
    // Slot 2 (成): imposters 为,变,做
    // Slot 3 (功): imposters 果,绩,效
    grid: ["龙", "来", "成", "果", "马", "为", "去", "绩", "虎", "到", "变", "行", "牛", "做", "功", "效"],
  },
  {
    date: "2026-02-27",
    chengyu: ["一", "石", "二", "鸟"],
    pinyin: "yī shí èr niǎo",
    meaning: "Kill two birds with one stone — achieving two goals with a single action.",
    origin: "A universal idiom describing elegant efficiency, found across many cultures. In Chinese it paints a vivid image of a single thrown stone felling two birds.",
    origin_zh: "用一块石头打下两只鸟，比喻一个行动同时达到两个目的。",
    riddles: [
      {
        type: "形谜",
        text: "万物之始，我只有一笔，横贯天地。",
        translation: "The beginning of all things — just one stroke, crossing heaven and earth.",
        hint: "A single horizontal line — the simplest character",
      },
      {
        type: "字谜",
        text: "山崖下藏着一张嘴，坚硬千年。",
        translation: "A mouth hidden beneath a cliff — hard for a thousand years.",
        hint: "厂 (cliff/overhang) + 口 (mouth) = 石",
      },
      {
        type: "形谜",
        text: "比一多一笔，比三少一笔，两横平行。",
        translation: "One more stroke than one, one fewer than three — two parallel lines.",
        hint: "Two horizontal strokes, one above the other",
      },
      {
        type: "场景谜",
        text: "春天清晨，我在树梢叫醒你。",
        translation: "On a spring morning, I wake you from the treetop.",
        hint: "A feathered creature that sings at dawn — look for it in the spring sky",
      },
    ],
    grid: ["一", "石", "二", "鸟", "三", "木", "三", "鱼", "七", "土", "两", "蝶", "万", "水", "双", "虫"],
  },
]

export async function getPuzzleForDate(dateStr) {
  if (import.meta.env.DEV) {
    return HARDCODED_PUZZLES.find(p => p.date === dateStr) || HARDCODED_PUZZLES[0]
  }
  const res = await fetch(`/api/puzzle?date=${dateStr}`)
  return res.json()
}

export function getTodayString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}
