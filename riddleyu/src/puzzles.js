// Puzzle shape:
// {
//   date: "YYYY-MM-DD",
//   chengyus: [
//     { chars, pinyin, meaning, riddle, riddle_translation, hint },  // x4
//   ],
//   hidden: { chars, pinyin, meaning },   // the 5th chengyu formed by sliding
//   hiddenPositions: [0,0,0,1],           // which index in each chengyu's chars contributes to hidden
//   grid: [...16 chars shuffled],         // all 4 chengyus' chars mixed
//   gridGroups: [...16 group indices],    // parallel to grid: which chengyu (0-3) each char belongs to
// }

export const HARDCODED_PUZZLES = [
  {
    date: "2026-03-19",
    chengyus: [
      {
        chars: ["一", "石", "二", "鸟"],
        pinyin: "yī shí èr niǎo",
        meaning: "Kill two birds with one stone — one action, two results.",
        riddle: "旅人投一石，双鸟齐落。一举，两获。",
        riddle_translation: "A traveler throws one stone — two birds fall. One move, two gains.",
        hint: "One action achieves two goals at once",
      },
      {
        chars: ["马", "到", "成", "功"],
        pinyin: "mǎ dào chéng gōng",
        meaning: "Immediate success upon arrival — victory the moment you begin.",
        riddle: "将旗未落，战马蹄声中城门已开。",
        riddle_translation: "The battle flag still raised — city gates open to the sound of approaching hooves.",
        hint: "Success arrives the moment you do — no delay, no struggle",
      },
      {
        chars: ["当", "仁", "不", "让"],
        pinyin: "dāng rén bù ràng",
        meaning: "When righteousness calls, yield to no one — step forward without hesitation.",
        riddle: "皇帝问谁敢直言。一位大臣迈步向前，不让他人。",
        riddle_translation: "The emperor asks who dares speak truth. One minister steps forward, yielding to no one.",
        hint: "When duty calls, a person of integrity steps up without waiting",
      },
      {
        chars: ["争", "先", "恐", "后"],
        pinyin: "zhēng xiān kǒng hòu",
        meaning: "Everyone scrambles to be first, terrified of falling behind.",
        riddle: "城门一开，百人蜂拥，人人唯恐落于人后。",
        riddle_translation: "The gates open — a hundred people surge forward, each terrified of falling even one step behind.",
        hint: "A frantic rush where everyone fears being last",
      },
    ],
    hidden: {
      chars: ["一", "马", "当", "先"],
      pinyin: "yī mǎ dāng xiān",
      meaning: "To charge ahead of all others — to take the lead without hesitation.",
    },
    // hiddenPositions[i] = index within chengyus[i].chars that contributes to hidden
    // 一石二鸟[0]=一, 马到成功[0]=马, 当仁不让[0]=当, 争先恐后[1]=先
    hiddenPositions: [0, 0, 0, 1],
    grid: ["一","石","二","鸟","马","到","成","功","当","仁","不","让","争","先","恐","后"],
    gridGroups: [0,0,0,0, 1,1,1,1, 2,2,2,2, 3,3,3,3],
  },
]

export async function getPuzzleForDate(dateStr) {
  if (import.meta.env.DEV) {
    const puzzle = HARDCODED_PUZZLES.find(p => p.date === dateStr) || HARDCODED_PUZZLES[0]
    // Shuffle grid and gridGroups together using Fisher-Yates
    const indices = puzzle.grid.map((_, i) => i)
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]]
    }
    return {
      ...puzzle,
      grid: indices.map(i => puzzle.grid[i]),
      gridGroups: indices.map(i => puzzle.gridGroups[i]),
    }
  }
  const res = await fetch(`/api/puzzle?date=${dateStr}`)
  return res.json()
}

export function getTodayString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}
