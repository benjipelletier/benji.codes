// Canonical toneless Mandarin pinyin syllables (~410 total).
// Used to filter out data-typo buckets like "i", "fe", "sh", "xua" from the
// source dictionary, where the leading initial was dropped or mangled.
//
// Note: ü is written as `v` after l/n (lv, lve, nv, nve), and as `u` after
// j/q/x/y (ju, qu, xu, yu, jue, que, xue, yue, juan, quan, xuan, yuan).

export const CANONICAL_SYLLABLES = new Set([
  // Standalone vowels
  "a", "ai", "an", "ang", "ao",
  "e", "ei", "en", "eng", "er",
  "o", "ou",
  // b
  "ba", "bai", "ban", "bang", "bao", "bei", "ben", "beng",
  "bi", "bian", "biao", "bie", "bin", "bing", "bo", "bu",
  // p
  "pa", "pai", "pan", "pang", "pao", "pei", "pen", "peng",
  "pi", "pian", "piao", "pie", "pin", "ping", "po", "pou", "pu",
  // m
  "ma", "mai", "man", "mang", "mao", "me", "mei", "men", "meng",
  "mi", "mian", "miao", "mie", "min", "ming", "miu", "mo", "mou", "mu",
  // f
  "fa", "fan", "fang", "fei", "fen", "feng", "fo", "fou", "fu",
  // d
  "da", "dai", "dan", "dang", "dao", "de", "dei", "den", "deng",
  "di", "dia", "dian", "diao", "die", "ding", "diu",
  "dong", "dou", "du", "duan", "dui", "dun", "duo",
  // t
  "ta", "tai", "tan", "tang", "tao", "te", "tei", "teng",
  "ti", "tian", "tiao", "tie", "ting",
  "tong", "tou", "tu", "tuan", "tui", "tun", "tuo",
  // n
  "na", "nai", "nan", "nang", "nao", "ne", "nei", "nen", "neng",
  "ni", "nian", "niang", "niao", "nie", "nin", "ning", "niu",
  "nong", "nou", "nu", "nuan", "nun", "nuo", "nv", "nve",
  // l
  "la", "lai", "lan", "lang", "lao", "le", "lei", "leng",
  "li", "lia", "lian", "liang", "liao", "lie", "lin", "ling", "liu",
  "long", "lou", "lu", "luan", "lun", "luo", "lv", "lve",
  // g
  "ga", "gai", "gan", "gang", "gao", "ge", "gei", "gen", "geng",
  "gong", "gou", "gu", "gua", "guai", "guan", "guang", "gui", "gun", "guo",
  // k
  "ka", "kai", "kan", "kang", "kao", "ke", "kei", "ken", "keng",
  "kong", "kou", "ku", "kua", "kuai", "kuan", "kuang", "kui", "kun", "kuo",
  // h
  "ha", "hai", "han", "hang", "hao", "he", "hei", "hen", "heng",
  "hong", "hou", "hu", "hua", "huai", "huan", "huang", "hui", "hun", "huo",
  // j (ü-as-u)
  "ji", "jia", "jian", "jiang", "jiao", "jie", "jin", "jing", "jiong", "jiu",
  "ju", "juan", "jue", "jun",
  // q
  "qi", "qia", "qian", "qiang", "qiao", "qie", "qin", "qing", "qiong", "qiu",
  "qu", "quan", "que", "qun",
  // x
  "xi", "xia", "xian", "xiang", "xiao", "xie", "xin", "xing", "xiong", "xiu",
  "xu", "xuan", "xue", "xun",
  // zh
  "zha", "zhai", "zhan", "zhang", "zhao", "zhe", "zhei", "zhen", "zheng",
  "zhi", "zhong", "zhou",
  "zhu", "zhua", "zhuai", "zhuan", "zhuang", "zhui", "zhun", "zhuo",
  // ch
  "cha", "chai", "chan", "chang", "chao", "che", "chen", "cheng",
  "chi", "chong", "chou",
  "chu", "chua", "chuai", "chuan", "chuang", "chui", "chun", "chuo",
  // sh
  "sha", "shai", "shan", "shang", "shao", "she", "shei", "shen", "sheng",
  "shi", "shou",
  "shu", "shua", "shuai", "shuan", "shuang", "shui", "shun", "shuo",
  // r
  "ran", "rang", "rao", "re", "ren", "reng",
  "ri", "rong", "rou", "ru", "rua", "ruan", "rui", "run", "ruo",
  // z
  "za", "zai", "zan", "zang", "zao", "ze", "zei", "zen", "zeng",
  "zi", "zong", "zou", "zu", "zuan", "zui", "zun", "zuo",
  // c
  "ca", "cai", "can", "cang", "cao", "ce", "cen", "ceng",
  "ci", "cong", "cou", "cu", "cuan", "cui", "cun", "cuo",
  // s
  "sa", "sai", "san", "sang", "sao", "se", "sen", "seng",
  "si", "song", "sou", "su", "suan", "sui", "sun", "suo",
  // y (ü-as-u after y)
  "ya", "yan", "yang", "yao", "ye", "yi", "yin", "ying", "yo",
  "yong", "you", "yu", "yuan", "yue", "yun",
  // w
  "wa", "wai", "wan", "wang", "wei", "wen", "weng", "wo", "wu",
]);
