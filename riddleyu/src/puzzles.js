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
        lesson: "我们都跟骑乘或动物有关，但我是古代战争和行动的核心意象。'骑'是动词（骑的动作），'驰'描述奔跑的状态，'牛'象征力气而非速度——只有我代表那种一到就能开始行动的气势。",
        breakdown: "这四个字都跟骑乘或动物有关。'骑'是动词，指骑马的动作本身；'驰'描述马快速奔跑的状态；'牛'虽是常见牲畜，象征力气而非速度与行动。'马'是古代战争的核心意象——将领骑马出征，马一踏上战场就意味着行动展开，所以成语选了'马'作为整个叙事的起点。",
      },
      {
        hint: "这些字都表示到达或前进。",
        chars: ["到", "达", "至", "进"],
        answer: "到",
        lesson: "我们都能表示抵达，但我专指具体踏上某处。'达'更侧重抽象目标的实现（达成、达到），'至'偏书面古语，'进'强调向前的过程而非抵达的结果——马踏上战场那一刻，用的正是我。",
        breakdown: "这四个字都表示抵达或移动。'达'偏抽象，常用于目标的实现（达成目标、达到效果）；'至'是书面语，多见于古文（至今、至于）；'进'强调向前的动作过程，而非抵达的瞬间。'到'最直接，专指具体踏上某处——马到了战场，就是这种具体、有力的到达感。",
      },
      {
        hint: "这些字都与完成或变化有关。",
        chars: ["成", "完", "终", "毕"],
        answer: "成",
        lesson: "我们都跟完成有关，但我表示'变成'或'达成某种状态'，是一种积极的转化。'完'是中性地做完，'终'有终结之感，'毕'偏书面——只有我既能独立成词，又携带'成就'的积极含义。",
        breakdown: "这四个字都与事情的完结或转变有关。'完'表示彻底做完，语气中性；'终'强调结束，常带有终点或终结之感；'毕'也表示完结，多用于书面（毕业、完毕）。'成'独特之处在于它表示'变成'或'达成某种状态'，是一种从无到有的积极转化——成功、成就都用'成'，因为它带着实现与创造的意味。",
      },
      {
        hint: "这些字都与成果或胜利有关。",
        chars: ["功", "胜", "赢", "果"],
        answer: "功",
        lesson: "我们都跟好结果有关，但我由'工'（劳动）和'力'（力量）构成，是靠努力获得的成就。'胜'和'赢'都是竞争中打败对手，'果'是中性的结果——而这个成语说的不是竞争的胜利，是努力的回报，所以用的是我。",
        breakdown: "这四个字都和成果或成功有关。'胜'是比较中的胜出，强调打败对手；'赢'同样是竞争性的，偏口语；'果'更抽象，指结果或成效，不一定正面。'功'由'工'（劳动）和'力'（力量）构成，专指通过努力和付出获得的成就——功劳、功绩。成语用'功'而非'胜'，是因为马到成功讲的是行动带来的回报，而非击败对手的胜利。",
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
