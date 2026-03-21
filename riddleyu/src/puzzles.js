export const HARDCODED_PUZZLES = [
  {
    date: "2026-03-21",
    chengyu: {
      chars: ["马", "到", "成", "功"],
      pinyin: "mǎ dào chéng gōng",
      meaning: "to achieve immediate success",
    },
    story: "出自元代无名氏的杂剧。形容一到达就立刻取得成功，比喻事情顺利，一开始就取得好成绩。",
    grid: ["马", "骑", "驰", "牛", "到", "达", "至", "进", "成", "完", "终", "毕", "功", "胜", "赢", "果"],
    clusters: [
      {
        hint: "这些字都与动物或骑乘有关。",
        chars: ["马", "骑", "驰", "牛"],
        answer: "马",
        lesson: "马是这个成语的起点——古代将领骑马出征，马一到就意味着行动开始。",
      },
      {
        hint: "这些字都表示到达或前进。",
        chars: ["到", "达", "至", "进"],
        answer: "到",
        lesson: "到强调具体地到达一个地方——马到了战场，不是抽象地'达到'目标。",
      },
      {
        hint: "这些字都与完成或变化有关。",
        chars: ["成", "完", "终", "毕"],
        answer: "成",
        lesson: "成表示'变成'或'达成'——是转变的过程，不是事情的终结。",
      },
      {
        hint: "这些字都与成果或胜利有关。",
        chars: ["功", "胜", "赢", "果"],
        answer: "功",
        lesson: "功由'工'和'力'组成——是靠劳动和力量获得的成就，不是竞争中的胜利。",
      },
    ],
  },
]

// In dev, track whether to use hardcoded or backend data (persisted across reloads)
export function getDevUseBackend() { return localStorage.getItem('dev_use_backend') === 'true' }
export function setDevUseBackend(val) { localStorage.setItem('dev_use_backend', val ? 'true' : 'false') }

export async function getPuzzleForDate(dateStr) {
  if (import.meta.env.DEV && !getDevUseBackend()) {
    return HARDCODED_PUZZLES.find(p => p.date === dateStr) || HARDCODED_PUZZLES[0]
  }
  try {
    const res = await fetch(`/api/puzzle?date=${dateStr}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const puzzle = await res.json()
    try { localStorage.setItem(`puzzle:${dateStr}`, JSON.stringify(puzzle)) } catch {}
    return puzzle
  } catch (e) {
    try {
      const cached = localStorage.getItem(`puzzle:${dateStr}`)
      if (cached) return JSON.parse(cached)
    } catch {}
    throw e
  }
}

export function getTodayString() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}
