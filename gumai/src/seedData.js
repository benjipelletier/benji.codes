// Seed data for local dev (no DB required).
// Matches the 3 launch nodes from the spec.

export const SEED_NODES = [
  {
    id: 1,
    date_added: "2025-06-01",
    day_number: 1,
    node_type: "chengyu",
    dynasty: "春秋",
    title: "守株待兔",
    pinyin: "shǒu zhū dài tù",
    english: "To guard a tree stump waiting for rabbits — relying on luck instead of effort.",
    content: {
      origin_story: "A farmer in the state of Song was plowing his field when a rabbit ran headlong into a tree stump and broke its neck. Delighted by this free meal, the farmer abandoned his plow and sat by the stump day after day, waiting for another rabbit to appear. His fields went to ruin, and he became the laughingstock of Song. The Legalist philosopher 韩非子 recorded this story to argue against clinging to old methods in a changing world.",
      source_text: "韩非子·五蠹",
      modern_usage: "Used to describe someone who relies on a past stroke of luck instead of putting in real effort. Often used as gentle criticism.",
      example_sentence: "你不能守株待兔，要主动去找工作机会。",
      example_pinyin: "Nǐ bù néng shǒuzhūdàitù, yào zhǔdòng qù zhǎo gōngzuò jīhuì.",
      example_english: "You can't just sit around waiting for luck — go actively look for job opportunities."
    },
    challenge: {
      type: "reconstruct",
      data: {
        characters: ["守", "株", "待", "兔"],
        distractors: ["树", "免", "寺", "朱"],
        hint: "A farmer waits by a tree stump for a rabbit that will never come..."
      }
    }
  },
  {
    id: 2,
    date_added: "2025-06-02",
    day_number: 2,
    node_type: "figure",
    dynasty: "战国",
    title: "韩非子",
    pinyin: "Hán Fēizǐ",
    english: "Legalist philosopher who synthesized political theory around law, power, and statecraft.",
    content: {
      bio: "韩非子 was a prince of the declining state of Han during the Warring States period. A student of the great Confucian scholar 荀子, he ultimately rejected Confucian idealism in favor of a hard-nosed philosophy of governance through strict law and institutional power. His writings so impressed the king of Qin that he was summoned to the Qin court — but political rivalry led to his imprisonment and death by forced suicide.",
      key_contribution: "Synthesized the three strands of Legalist thought — 法 (law), 术 (statecraft), and 势 (authority) — into a unified political philosophy that became the blueprint for Qin dynasty governance.",
      fun_fact: "He had a severe stutter that made public speaking nearly impossible. His inability to speak drove him to become one of the most brilliant and prolific writers of the ancient world.",
      related_works: ["韩非子·五蠹", "韩非子·说难", "韩非子·孤愤"]
    },
    challenge: {
      type: "match_achievement",
      data: {
        question: "What is 韩非子 best known for?",
        correct: "Unifying Legalist thought into a system of law, statecraft, and authority",
        distractors: [
          "Writing the first Chinese dictionary",
          "Establishing the Confucian academy system"
        ]
      }
    }
  },
  {
    id: 3,
    date_added: "2025-06-03",
    day_number: 3,
    node_type: "character",
    dynasty: "商",
    title: "木",
    pinyin: "mù",
    english: "Tree; wood. One of the oldest pictographs and a foundational radical.",
    content: {
      modern_meaning: "tree, wood, timber; wooden; numb",
      radical: "木 (radical 75 — it is its own radical)",
      stroke_count: 4,
      etymology: "One of the most recognizable pictographs in Chinese writing. The oracle bone form from the Shang dynasty clearly depicts a tree — a vertical trunk with branches spreading above and roots reaching below. Over millennia it simplified, but the tree is still visible.",
      evolution: [
        "Oracle bone (商): A tree with spreading branches above and roots below",
        "Bronze script (周): Branches and roots simplified to diagonal strokes",
        "Seal script (秦): Further abstracted, tree form still recognizable",
        "Modern (楷书): The familiar 木 — horizontal stroke for branches, downward strokes for roots"
      ],
      derived_characters: [
        "林 (lín) — two trees: a grove, forest",
        "森 (sēn) — three trees: dense forest, dark, strict",
        "本 (běn) — tree with a mark at the root: origin, root, basis",
        "末 (mò) — tree with a mark at the top: tip, end",
        "果 (guǒ) — fruit hanging on a tree: fruit, result"
      ],
      cultural_note: "木 is one of the Five Elements (五行). It represents growth, spring, the east, and the color green. In traditional Chinese medicine, it governs the liver."
    },
    challenge: {
      type: "match_radical",
      data: {
        question: "In its earliest oracle bone form, 木 was a pictograph of what?",
        correct: "A tree with branches above and roots below",
        distractors: [
          "A person standing with arms outstretched",
          "A house with a peaked roof"
        ]
      }
    }
  }
];

export const SEED_CONNECTIONS = [
  {
    id: 1,
    source_id: 2,
    target_id: 1,
    relationship: "author_of_source",
    label: "Recorded the story of 守株待兔 in 韩非子·五蠹"
  },
  {
    id: 2,
    source_id: 3,
    target_id: 1,
    relationship: "shared_character_component",
    label: "株 contains the 木 radical — a tree stump is literally a wooden stump"
  }
];

export const SEED_CHANGELOG = [
  {
    day_number: 3,
    date: "2025-06-03",
    entry: "木 took root in the ancient soil of 商. Before there were words, there were pictures — and 木 was a picture of a tree. A vein of ink connects it to 守株待兔, for what is a 株 but a 木 that stands alone?",
    node_title: "木"
  },
  {
    day_number: 2,
    date: "2025-06-02",
    entry: "韩非子 appeared in the gathering storm of 战国. The stuttering prince who couldn't speak — so he wrote the book that would reshape an empire. A brushstroke connects him to 守株待兔, the tale he immortalized.",
    node_title: "韩非子"
  },
  {
    day_number: 1,
    date: "2025-06-01",
    entry: "守株待兔 emerged from the mists of 春秋. A farmer, a tree stump, and a rabbit — the first node takes root on the map.",
    node_title: "守株待兔"
  }
];
