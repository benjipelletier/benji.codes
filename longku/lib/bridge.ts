// Bridges: corpus words that carry a chain to where the bank can answer.
//
// A pass through the bank is a single chain, but a bank is rarely connected
// enough to walk it without help — a word ends on a syllable nothing you hold
// starts with. Rather than breaking the chain there, the app plays a short run
// of corpus words that lands on a syllable where unplayed bank words start.
//
// Finding one is a breadth-first search over the corpus syllable graph, so the
// shortest bridge always wins: every bridge word is something read rather than
// recalled, and the point of the game is still the words you produce. Among
// equally short bridges, the target listed first wins — the caller orders
// targets by how badly their words need practice.

import { COMMON_FREQ_THRESHOLD, bySyllable, entries, type ChengyuEntry } from "./data";

export interface BridgeWord {
  w: string;
  p: string;
  fs: string;
  ls: string;
  f: number;
  /** English gloss, trimmed for display under the chain. */
  e: string;
}

/** Longest bridge worth playing. Past three, the chain is mostly reading. */
export const MAX_HOPS = 3;

function gloss(e: string): string {
  const s = e.replace(/\s*\(idiom\)\s*/g, " ").split(";")[0].trim();
  return s.length > 90 ? `${s.slice(0, 87)}…` : s;
}

function toBridge(c: ChengyuEntry): BridgeWord {
  return { w: c.w, p: c.p, fs: c.fs, ls: c.ls, f: c.f, e: gloss(c.e ?? "") };
}

/**
 * Search from `from` to the nearest syllable in `targets`, using only words
 * accepted by `usable`. Returns the path in play order, or null.
 */
function search(
  from: string,
  rank: Map<string, number>,
  maxHops: number,
  usable: (c: ChengyuEntry) => boolean,
): ChengyuEntry[] | null {
  const all = entries();
  const index = bySyllable();
  const parent = new Map<string, { prev: string; id: number }>();
  const visited = new Set([from]);
  let frontier = [from];

  for (let depth = 1; depth <= maxHops && frontier.length > 0; depth++) {
    // Every syllable first reached at this depth, via the most frequent word
    // that reaches it from anywhere on the frontier.
    const reached = new Map<string, { prev: string; id: number }>();
    for (const syl of frontier) {
      for (const id of index[syl] ?? []) {
        const c = all[id];
        if (!c.ls || visited.has(c.ls) || !usable(c)) continue;
        const had = reached.get(c.ls);
        if (!had || all[had.id].f < c.f) reached.set(c.ls, { prev: syl, id });
      }
    }

    let best: string | null = null;
    for (const [syl, link] of reached) {
      visited.add(syl);
      parent.set(syl, link);
      const r = rank.get(syl);
      if (r !== undefined && (best === null || r < rank.get(best)!)) best = syl;
    }

    if (best !== null) {
      const path: ChengyuEntry[] = [];
      for (let at = best; at !== from; ) {
        const link = parent.get(at)!;
        path.unshift(all[link.id]);
        at = link.prev;
      }
      return path;
    }
    frontier = [...reached.keys()];
  }
  return null;
}

/**
 * The bridge from `from` to the best of `targets`, avoiding `exclude`.
 *
 * Common words are tried first even if a rarer one would be a hop shorter: a
 * bridge is also the app suggesting what to learn, and an obscure idiom makes a
 * poor suggestion. Rare words are the fallback, not the preference.
 */
export function findBridge(
  from: string,
  targets: string[],
  exclude: Set<string>,
  maxHops = MAX_HOPS,
): BridgeWord[] | null {
  if (targets.length === 0) return null;
  const rank = new Map<string, number>();
  targets.forEach((t, i) => {
    if (!rank.has(t)) rank.set(t, i);
  });

  const common = search(
    from,
    rank,
    maxHops,
    (c) => c.f >= COMMON_FREQ_THRESHOLD && !exclude.has(c.w),
  );
  const path = common ?? search(from, rank, maxHops, (c) => !exclude.has(c.w));
  return path ? path.map(toBridge) : null;
}
