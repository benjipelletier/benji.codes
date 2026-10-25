// Reading word breaks out of pinyin written with tone marks and no gaps
// between a word's syllables: "Zhèngfǔ guānyuán shòu rénmín de jiāndū."
//
// The spaces say where the words are. To carry that over to the characters,
// each pinyin word has to be cut into syllables — one per character — and
// pinyin run together is ambiguous ("xian" is 先 or 西安). So every way of
// cutting each word is tried, and the one kept is the one whose syllable
// count fits the characters and whose syllables are readings those
// characters actually have.

const PLAIN: Record<string, string> = {
  ā: "a", á: "a", ǎ: "a", à: "a",
  ē: "e", é: "e", ě: "e", è: "e",
  ī: "i", í: "i", ǐ: "i", ì: "i",
  ō: "o", ó: "o", ǒ: "o", ò: "o",
  ū: "u", ú: "u", ǔ: "u", ù: "u",
  ü: "v", ǖ: "v", ǘ: "v", ǚ: "v", ǜ: "v",
  ń: "n", ň: "n", ǹ: "n", ḿ: "m",
};

/** Pinyin with its tone marks and capitals taken off, ü written v; apostrophes kept as syllable breaks. */
export function plainPinyin(s: string): string {
  return [...s.normalize("NFC").toLowerCase()].map((c) => PLAIN[c] ?? c).join("");
}

/** Every way of cutting a run of letters into syllables, fewest pieces first. */
function cuts(word: string, valid: ReadonlySet<string>): string[][] {
  const out: string[][] = [];
  const walk = (at: number, sofar: string[]) => {
    if (out.length >= 12) return;
    if (at === word.length) {
      out.push(sofar);
      return;
    }
    for (let end = Math.min(word.length, at + 6); end > at; end--) {
      const piece = word.slice(at, end);
      if (valid.has(piece)) walk(end, [...sofar, piece]);
    }
  };
  walk(0, []);
  return out;
}

/**
 * The characters grouped into the words the pinyin marks, or null when the
 * pinyin doesn't fit them: a different number of syllables than characters, or
 * too many syllables the characters can't be read as (pinyin belonging to
 * some other sentence).
 *
 * @param han       the sentence's Chinese characters, in order, nothing else
 * @param pinyin    as written, tone marks and punctuation included
 * @param syllables every syllable there is
 * @param readings  the toneless readings each character has
 */
export function wordsByPinyin(
  han: string[],
  pinyin: string,
  syllables: ReadonlySet<string>,
  readings: ReadonlyMap<string, ReadonlySet<string>>,
): string[] | null {
  const tokens = plainPinyin(pinyin)
    .split(/[^a-zv']+/)
    .filter((t) => /[a-zv]/.test(t));
  if (!tokens.length || !han.length) return null;

  // For each token, the ways it can be cut; an apostrophe forces a cut.
  const options = tokens.map((t) => {
    const parts = t.split("'").filter(Boolean).map((p) => cuts(p, syllables));
    if (parts.some((p) => !p.length)) return [] as string[][];
    return parts.reduce<string[][]>((acc, p) => acc.flatMap((a) => p.slice(0, 4).map((b) => [...a, ...b])), [[]]).slice(0, 8);
  });
  if (options.some((o) => !o.length)) return null;

  // Walk the tokens, keeping for each position in the characters the best way of having got there.
  type Path = { hits: number; lens: number[] };
  let at = new Map<number, Path>([[0, { hits: 0, lens: [] }]]);
  for (const ways of options) {
    const next = new Map<number, Path>();
    for (const [pos, path] of at) {
      for (const way of ways) {
        const end = pos + way.length;
        if (end > han.length) continue;
        let hits = path.hits;
        way.forEach((s, i) => {
          const can = readings.get(han[pos + i]);
          // 儿 written as a bare r on the end of a word.
          if (can?.has(s) || (s === "r" && han[pos + i] === "儿")) hits++;
        });
        const had = next.get(end);
        if (!had || hits > had.hits) next.set(end, { hits, lens: [...path.lens, way.length] });
      }
    }
    at = next;
    if (!at.size) return null;
  }
  const done = at.get(han.length);
  if (!done || done.hits / han.length < 0.8) return null;

  const words: string[] = [];
  let i = 0;
  for (const len of done.lens) {
    words.push(han.slice(i, i + len).join(""));
    i += len;
  }
  return words;
}

/** Every toneless syllable CC-CEDICT reads a single character as (ü written v), for telling typed pinyin from English. */
const SYLLABLES = new Set("a ai an ang ao ba bai baike baimi baiwa ban bang bao bei ben beng bi bia bian biao bie bin bing bo bu ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo e ei en eng er fa fan fang fei fen feng fenke fenwa fiao fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ha hai han hang hao haoke haowa he hei hen heng hong hou hu hua huai huan huang hui hun huo ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le lei leng li lia lian liang liao lie like lin ling liu liwa lo long lou lu luan lun luo lv lve ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nun nuo nv nve o ou pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu qi qia qian qiang qianke qianwa qiao qie qin qing qiong qiu qu quan que qun ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shike shiwa shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ta tai tan tang tao te tei teng ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai wan wang wei wen weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo".split(" "));
const LONGEST_SYLLABLE = 6;

/**
 * Whether what was typed is pinyin: letters (tone marks, ü or v, spaces,
 * tone numbers and apostrophes allowed) that split wholly into syllables
 * ("huilü", "hui lv", "hui4lv4"). English that happens to spell pinyin
 * ("hang", "fan") is pinyin too.
 */
export function isPinyin(typed: string): boolean {
  const s = typed
    .toLowerCase()
    .replace(/ü|u:/g, "v")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s\d'’-]/g, "");
  if (!s || !/^[a-z]+$/.test(s)) return false;
  const ok: boolean[] = [true];
  for (let i = 1; i <= s.length; i++) {
    ok[i] = false;
    for (let n = 1; n <= Math.min(LONGEST_SYLLABLE, i) && !ok[i]; n++) ok[i] = ok[i - n] && SYLLABLES.has(s.slice(i - n, i));
  }
  return ok[s.length];
}
