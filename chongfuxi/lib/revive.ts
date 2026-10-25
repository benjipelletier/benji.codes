// Words that need reviving, by why: each word whose latest result was wrong
// is put in the one category that best explains its recent results. The
// owner asked for categories, since three misses in a row, a strong word
// slipping, and a word failing only in sentences or only on Recall are
// different troubles needing different help (app/api/chongfuxi/rescue.ts
// writes each category its own kind of rescue). Pure, so it can be tested.

/** One result of a word: its Read or Recall card answered, or lapsed by being tapped in a forgotten sentence. */
export interface ReviveEvent {
  kind: "read" | "produce";
  cause: "answer" | "tapped";
  grade: "good" | "forgot";
  at: number;
  /** The card's FSRS strength (days) just before. */
  stability: number | null;
}

export type ReviveCategory = "mixed" | "produce" | "context" | "slipping" | "stuck" | "leech";

/** In order of precedence: a word goes in the first that fits. */
export const CATEGORIES: Array<{ key: ReviveCategory; label: string; about: string }> = [
  { key: "mixed", label: "Mixed up", about: "Confused with one particular word, by your notes, lookups or taps." },
  { key: "produce", label: "Can't produce", about: "Recognised fine, but Recall keeps failing." },
  { key: "context", label: "Breaks in context", about: "Known alone, but trips you in sentences." },
  { key: "slipping", label: "Slipping", about: "Was strong, and is now being forgotten." },
  { key: "stuck", label: "Won't stick", about: "Wrong every time lately." },
  { key: "leech", label: "Leech", about: "Forgotten again and again, never settling." },
];

/** The thresholds, shown on Settings › Algorithm. */
export const REVIVE = {
  /** Won't stick: this many wrong in a row. */
  streak: 3,
  /** Slipping: strong means this many right in a row, or this strength (days), before the trouble began… */
  strongRun: 4,
  strongDays: 30,
  /** …and now wrong this many of the last three. */
  slipMisses: 2,
  /** Breaks in context: tripped this many sentences within this many days, while Read is mostly right. */
  trips: 2,
  tripDays: 30,
  /** Can't produce: Recall wrong this many of its last three, while Read is mostly right. */
  produceMisses: 2,
  /** Mixed up: wrong this many of the last six, with a word it is confused with. */
  mixedMisses: 2,
  /** Leech: wrong this many times in all. */
  leechMisses: 6,
} as const;

const DAY = 86_400_000;

/**
 * The category and a short reason for a word, from its results newest first,
 * its misses in all, and the word it is confused with (if the evidence names
 * one); null when its latest result was right or nothing fits.
 */
export function classify(
  events: ReviveEvent[],
  misses: number,
  partner: string | null,
  now = Date.now(),
): { category: ReviveCategory; why: string } | null {
  if (!events.length || events[0].grade !== "forgot") return null;
  const wrong = (n: number) => events.slice(0, n).filter((e) => e.grade === "forgot").length;
  let streak = 0;
  while (streak < events.length && events[streak].grade === "forgot") streak++;
  const answers = (kind: ReviveEvent["kind"]) => events.filter((e) => e.kind === kind && e.cause === "answer").slice(0, 3);
  const reads = answers("read");
  const readFine = reads.length > 0 && reads.filter((e) => e.grade === "good").length >= Math.min(2, reads.length);

  if (partner && wrong(6) >= REVIVE.mixedMisses) return { category: "mixed", why: `Mixed up with ${partner}` };

  const recalls = answers("produce");
  const recallMisses = recalls.filter((e) => e.grade === "forgot").length;
  if (recallMisses >= REVIVE.produceMisses && readFine) {
    return { category: "produce", why: `Recall wrong ${recallMisses} of its last ${recalls.length}; Read fine` };
  }

  const trips = events.filter((e) => e.cause === "tapped" && now - e.at <= REVIVE.tripDays * DAY).length;
  if (trips >= REVIVE.trips && readFine) return { category: "context", why: `Tripped ${trips} sentences in ${REVIVE.tripDays} days` };

  if (wrong(3) >= REVIVE.slipMisses) {
    // Before the trouble began: the right answers in a row just older than the oldest of the recent misses.
    const oldest = Math.max(...[0, 1, 2].filter((i) => events[i]?.grade === "forgot"));
    let run = 0;
    for (let i = oldest + 1; i < events.length && events[i].grade === "good"; i++) run++;
    const peak = Math.max(0, ...events.slice(0, 3).filter((e) => e.grade === "forgot").map((e) => e.stability ?? 0));
    if (run >= REVIVE.strongRun) return { category: "slipping", why: `${run} right in a row, then forgotten` };
    if (peak >= REVIVE.strongDays) return { category: "slipping", why: `Was ${Math.round(peak)} days strong` };
  }

  if (streak >= REVIVE.streak) return { category: "stuck", why: `Wrong ${streak} times in a row` };
  if (misses >= REVIVE.leechMisses) return { category: "leech", why: `Forgotten ${misses} times in all` };
  return null;
}

/**
 * Whether two words of a lookup are both parts of one longer word in it: a
 * question about 不着痕迹 names 不 and 着 without comparing them, so it is
 * no sign the two are mixed up. `isWord` says whether a run is a dictionary
 * headword.
 */
export function inOneWord(query: string, a: string, b: string, isWord: (w: string) => boolean): boolean {
  for (const run of query.match(/\p{Script=Han}+/gu) ?? []) {
    const c = [...run];
    for (let i = 0; i < c.length; i++) {
      for (let j = i + 2; j <= Math.min(c.length, i + 8); j++) {
        const w = c.slice(i, j).join("");
        if (w !== a && w !== b && w.includes(a) && w.includes(b) && isWord(w)) return true;
      }
    }
  }
  return false;
}
