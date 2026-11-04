// Names in an episode's lines, read as names (the owner: "a lot of the
// characters I got were part of character names, which I feel like
// shouldn't be weighted heavily, or not included"). The word splitter often
// cuts a name into pieces (张东升 as 张 + 东升, 严良 as 严 + 良), and a piece
// never matched the name, so each piece counted as a word not known. Here a
// run of words that spells a listed name becomes that one name; and a name
// nobody listed is found the way a reader spots one: a common surname, or
// 小 / 老 / 阿, then a character or two, the whole not a dictionary word,
// said at least NAME_SEEN times in the episode.

import type { TextToken } from "./api";

/** Common surnames (and the 小 / 老 / 阿 that make a name of one), each one character. */
const SURNAMES = new Set(
  [..."王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷盛曲翁冉骆蓝路游辛靳管柴蒙鲍华喻祁蒲房滕屈饶解牟艾尤阳时穆农司卓古吉缪简车项连芦麦褚娄窦戚岑景党宫费卜冷晏席卫米柏宗瞿桂全佟应臧闵苟邬边卞姬师和仇栾隋商刁沙荣巫寇桑郎甄丛仲虞敖巩明佘池查麻苑迟邝"],
);
const PREFIXES = new Set([..."小老阿"]);
/** A surname followed by one of these is a surname word in a sentence (王说, 张的), not a name. */
const NOT_GIVEN = new Set([..."的了是在说和也都不就又把被给跟让吗呢吧啊呀们个这那有没对很太要会能去来到上下里你我他她它"]);
/** A name nobody listed must be said at least this many times before it is read as one. */
export const NAME_SEEN = 2;

const isWord = (t: TextToken | undefined) => !!t?.k;
const len = (s: string) => [...s].length;

/**
 * Runs of words in a line that spell one of `names` (two to four tokens,
 * the longest first), each made one token of the name.
 */
function joinNames(line: TextToken[], names: Set<string>): TextToken[] {
  if (!names.size) return line;
  const out: TextToken[] = [];
  for (let k = 0; k < line.length; ) {
    let hit: { end: number; text: string } | null = null;
    if (isWord(line[k])) {
      let text = line[k].t;
      for (let j = k + 1; j < line.length && j < k + 4 && isWord(line[j]); j++) {
        text += line[j].t;
        if (len(text) > 6) break;
        if (names.has(text)) hit = { end: j, text };
      }
    }
    if (hit) {
      out.push({ t: hit.text, k: "known" });
      k = hit.end + 1;
    } else out.push(line[k++]);
  }
  return out;
}

/** The runs in a line that read as a name nobody listed: surname (or 小 / 老 / 阿) and a given name of one or two characters. */
function nameRuns(line: TextToken[], isHeadword: (w: string) => boolean): string[] {
  const found: string[] = [];
  for (let k = 0; k + 1 < line.length; k++) {
    const head = line[k];
    if (!isWord(head) || len(head.t) !== 1 || !(SURNAMES.has(head.t) || PREFIXES.has(head.t))) continue;
    const next = line[k + 1];
    if (!isWord(next) || NOT_GIVEN.has(next.t)) continue;
    const runs: TextToken[][] = [];
    if (len(next.t) <= 2) runs.push([head, next]);
    const third = line[k + 2];
    if (len(next.t) === 1 && isWord(third) && len(third.t) === 1 && !NOT_GIVEN.has(third.t)) runs.push([head, next, third]);
    // Both lengths are counted; which one is the name is settled over the episode (readNames).
    for (const run of runs) {
      const text = run.map((t) => t.t).join("");
      // Something in it not known, or it's no trouble anyway; and not a word the dictionary has (老师, 小心, 王子).
      if (!run.some((t) => t.k === "unknown") || isHeadword(text)) continue;
      found.push(text);
    }
  }
  return found;
}

/**
 * An episode's lines with its names read as names: the listed ones (Muse's
 * names and cast) joined back together where the splitter cut them, then
 * any name nobody listed that is said at least NAME_SEEN times. Every name
 * is a known token. Returns the lines and the names found unlisted.
 */
export function readNames(lines: TextToken[][], listed: string[], isHeadword: (w: string) => boolean): { lines: TextToken[][]; found: string[] } {
  const names = new Set(listed.filter((n) => len(n) >= 2));
  let out = lines.map((l) => joinNames(l, names));
  const seen = new Map<string, number>();
  for (const l of out) for (const n of new Set(nameRuns(l, isHeadword))) seen.set(n, (seen.get(n) ?? 0) + 1);
  const counted = [...seen].filter(([n, c]) => c >= NAME_SEEN && !names.has(n));
  // A two-character run and a three-character one starting with it: the one said more is the name
  // (严良 said five times, 严良你 twice: 严良), the longer on a tie (张东升 cut 张 + 东 + 升 counts 张东 as often).
  const count = new Map(counted);
  const found = counted
    .filter(([n, c]) => {
      if (len(n) === 2) return !counted.some(([m, d]) => len(m) === 3 && m.startsWith(n) && d >= c);
      return !((count.get([...n].slice(0, 2).join("")) ?? 0) > c);
    })
    .map(([n]) => n);
  if (found.length) out = out.map((l) => joinNames(l, new Set(found)));
  return { lines: out, found };
}
