// The session log, as a forest rather than a line.
//
// A sweep used to be drawn as a row of chains, which only made sense while the
// prompt followed each word's ending syllable. Draining a bucket breaks that:
// the words in one bucket all start at the same syllable, so they don't chain
// to each other, and a single row can't say what connects to what.
//
// So the log draws what the words you have played actually form. A word lands
// at depth 1 when nothing played before it ends where it starts, and otherwise
// hangs under *every* earlier word it could follow — the same word appearing
// in as many places as there are ways to reach it. That makes the log a record
// of every chain your session contains rather than the one chain you happened
// to walk.
//
// Edges only ever point forward in time, because a word can only attach to
// something already played. The structure is acyclic by construction, so the
// unfolding terminates without a visited set — and a word drilled later can't
// silently re-parent what came before it.

import type { BankEntry } from "./store";

export interface ForestNode {
  w: string;
  /** Position in the played order. The same word can appear at several nodes. */
  index: number;
  /** 1 for a word that starts a chain, 2 for one hanging off it, and so on. */
  depth: number;
  children: ForestNode[];
  /** Set when this occurrence's continuations were cut rather than drawn. */
  cut?: "depth" | "repeat" | "budget";
  /** How many continuations the cut hid. */
  hidden?: number;
}

export interface Forest {
  roots: ForestNode[];
  /** Occurrences a limit kept off the page. */
  suppressed: number;
  /** Deepest chain drawn, in words. */
  deepest: number;
}

export interface ForestLimits {
  /** Longest chain drawn before a node is cut. */
  maxDepth: number;
  /** Times one word may be drawn before further occurrences are cut. */
  maxPerWord: number;
  /** Total nodes drawn, as a backstop. */
  maxNodes: number;
}

/**
 * Bounds, because occurrences multiply.
 *
 * Draining a bucket means every word in it hangs under the same set of
 * parents, so three played words ending in `bu` and a four-word `bu` bucket is
 * twelve nodes at one level — and the next bucket multiplies that again. The
 * count is the number of distinct paths to a word, which is exponential in the
 * worst case. These keep a session's log a page rather than a phone book;
 * what they hide is counted and reported rather than dropped silently.
 */
export const DEFAULT_LIMITS: ForestLimits = {
  maxDepth: 7,
  maxPerWord: 6,
  maxNodes: 220,
};

/**
 * Build the forest for `played` — the words worked through this session, in
 * the order they were produced.
 *
 * Words no longer in the bank are skipped: one can be removed mid-session, and
 * a hole in the middle of a chain would be worse than its absence.
 */
export function buildForest(
  played: string[],
  bank: Record<string, BankEntry>,
  limits: ForestLimits = DEFAULT_LIMITS,
): Forest {
  const words = played.filter((w) => bank[w]);
  const n = words.length;
  if (n === 0) return { roots: [], suppressed: 0, deepest: 0 };

  // Who can follow whom. j follows i when i ends on the syllable j starts, and
  // j was played after i. A word with no ending syllable leads nowhere.
  const children: number[][] = Array.from({ length: n }, () => []);
  const hasParent = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const end = bank[words[i]].ls;
    if (end === null) continue;
    for (let j = i + 1; j < n; j++) {
      if (bank[words[j]].fs !== end) continue;
      children[i].push(j);
      hasParent[j] = true;
    }
  }

  const drawn = new Map<string, number>();
  let nodes = 0;
  let suppressed = 0;
  let deepest = 0;

  function expand(index: number, depth: number): ForestNode {
    nodes += 1;
    deepest = Math.max(deepest, depth);
    const w = words[index];
    drawn.set(w, (drawn.get(w) ?? 0) + 1);

    const node: ForestNode = { w, index, depth, children: [] };
    const onward = children[index];
    if (onward.length === 0) return node;

    if (depth >= limits.maxDepth) {
      node.cut = "depth";
      node.hidden = onward.length;
      suppressed += onward.length;
      return node;
    }

    for (const next of onward) {
      if (nodes >= limits.maxNodes) {
        node.cut = "budget";
        node.hidden = (node.hidden ?? 0) + 1;
        suppressed += 1;
        continue;
      }
      if ((drawn.get(words[next]) ?? 0) >= limits.maxPerWord) {
        node.cut = "repeat";
        node.hidden = (node.hidden ?? 0) + 1;
        suppressed += 1;
        continue;
      }
      node.children.push(expand(next, depth + 1));
    }
    return node;
  }

  const roots: ForestNode[] = [];
  for (let i = 0; i < n; i++) {
    if (hasParent[i]) continue;
    if (nodes >= limits.maxNodes) {
      suppressed += 1;
      continue;
    }
    roots.push(expand(i, 1));
  }

  return { roots, suppressed, deepest };
}

/**
 * Where a word just played landed, for the line under the input.
 *
 * "It went on three chains" is the feedback the forest is there to give, and
 * reading it off the rendered tree would count the occurrences a limit hid.
 * Counted from the graph instead, so the number is true even when the drawing
 * is abridged.
 */
export function placements(
  played: string[],
  bank: Record<string, BankEntry>,
  word: string,
): number {
  const words = played.filter((w) => bank[w]);
  const at = words.indexOf(word);
  if (at < 0 || !bank[word]) return 0;
  const start = bank[word].fs;
  let parents = 0;
  for (let i = 0; i < at; i++) if (bank[words[i]].ls === start) parents += 1;
  return parents;
}
