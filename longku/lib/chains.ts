// Chain analysis over the user's own word bank.
//
// The bank is a directed multigraph: syllables are nodes, and each chengyu is
// an edge from its first syllable to its last. A chain is a trail — a walk
// that never reuses a chengyu — so "work through everything" means covering
// every edge with as few trails as possible.
//
// That is Eulerian path decomposition, and the minimum is exact rather than
// heuristic: for each connected component holding edges, you need
// Σ max(0, outdeg − indeg) trails, or 1 if the component is balanced.
//
// The number matters because it is the app's score. Adding an arbitrary word
// tends to raise it; adding one that starts where a chain dead-ends lowers it
// by exactly one, merging two chains into a longer one.

import type { BankEntry, State } from "./store";

export interface BankStats {
  /** Words in the bank. */
  total: number;
  /** Words recalled at least once. */
  recalled: number;
  /** Sum of every recall. */
  totalRecalls: number;
  /** Minimum chains needed to use every word once. */
  chains: number;
  /** Syllables the bank can reach but never leave. */
  deadEnds: string[];
  /** Distinct syllables the bank can land on — the set deadEnds is drawn from. */
  endings: number;
  /** Words with no usable ending syllable — they can close a chain only. */
  danglers: number;
  /** Longest chain found (words). See longestChain — a search, not a proof. */
  longest: number;
  /** Independent loops in the bank. See cycleCount. */
  cycles: number;
}

/** Index the bank by starting syllable. */
export function byFirstSyllable(bank: BankEntry[]): Map<string, BankEntry[]> {
  const m = new Map<string, BankEntry[]>();
  for (const e of bank) {
    const list = m.get(e.fs) ?? [];
    list.push(e);
    m.set(e.fs, list);
  }
  return m;
}

/**
 * Minimum chains to cover every word, via Eulerian decomposition.
 * Words without a known ending syllable still consume a chain slot, since a
 * chain cannot continue past them.
 */
export function minChains(bank: BankEntry[]): number {
  const outdeg = new Map<string, number>();
  const indeg = new Map<string, number>();
  const adj = new Map<string, Set<string>>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };

  let dangling = 0;
  for (const e of bank) {
    if (e.ls === null) {
      // No outgoing edge to model; it terminates whatever chain reaches it.
      dangling++;
      bump(outdeg, e.fs);
      if (!adj.has(e.fs)) adj.set(e.fs, new Set());
      continue;
    }
    bump(outdeg, e.fs);
    bump(indeg, e.ls);
    link(e.fs, e.ls);
  }

  const seen = new Set<string>();
  let total = 0;
  for (const node of adj.keys()) {
    if (seen.has(node)) continue;
    const stack = [node];
    const comp: string[] = [];
    while (stack.length) {
      const c = stack.pop()!;
      if (seen.has(c)) continue;
      seen.add(c);
      comp.push(c);
      for (const n of adj.get(c) ?? []) if (!seen.has(n)) stack.push(n);
    }
    const hasEdges = comp.some((v) => (outdeg.get(v) ?? 0) > 0);
    if (!hasEdges) continue;
    let surplus = 0;
    for (const v of comp) surplus += Math.max(0, (outdeg.get(v) ?? 0) - (indeg.get(v) ?? 0));
    total += Math.max(1, surplus);
  }
  return total;
}

/**
 * The longest chain the bank can produce, as far as a bounded search can tell.
 *
 * This is the longest trail in a directed multigraph, which is NP-hard, so the
 * number is a floor rather than a maximum: a best-effort depth-first search
 * with a step budget. At a few hundred words it explores the space thoroughly;
 * past that it returns the best it found before the budget ran out, which never
 * overstates — a chain of that length demonstrably exists.
 */
export function longestChain(bank: BankEntry[], budget = 60_000): number {
  const byStart = byFirstSyllable(bank);
  let best = 0;
  let steps = 0;

  function walk(from: string, used: Set<string>, depth: number) {
    if (steps++ > budget) return;
    if (depth > best) best = depth;
    for (const e of byStart.get(from) ?? []) {
      if (used.has(e.w) || e.ls === null) continue;
      used.add(e.w);
      walk(e.ls, used, depth + 1);
      used.delete(e.w);
    }
  }

  for (const e of bank) {
    if (steps > budget) break;
    // A word with no ending syllable is a chain of one and can't be extended.
    if (e.ls === null) {
      best = Math.max(best, 1);
      continue;
    }
    walk(e.ls, new Set([e.w]), 1);
  }
  return best;
}

/**
 * How many independent loops the bank contains — its circuit rank, E − V + C
 * over the syllable graph.
 *
 * Loops are what let a chain come back on itself instead of running off the
 * end, so this is the structural counterpart to the dead-end count: dead ends
 * say where chains die, cycles say how much room they have to keep going.
 * Counting every distinct cycle would be exponential; the circuit rank is the
 * number of genuinely independent ones and is exact.
 */
export function cycleCount(bank: BankEntry[]): number {
  const adj = new Map<string, Set<string>>();
  const touch = (k: string) => {
    if (!adj.has(k)) adj.set(k, new Set());
    return adj.get(k)!;
  };
  let edges = 0;
  for (const e of bank) {
    if (e.ls === null) {
      touch(e.fs);
      continue;
    }
    touch(e.fs).add(e.ls);
    touch(e.ls).add(e.fs);
    edges++;
  }

  const seen = new Set<string>();
  let components = 0;
  for (const node of adj.keys()) {
    if (seen.has(node)) continue;
    components++;
    const stack = [node];
    while (stack.length) {
      const c = stack.pop()!;
      if (seen.has(c)) continue;
      seen.add(c);
      for (const n of adj.get(c) ?? []) if (!seen.has(n)) stack.push(n);
    }
  }
  return Math.max(0, edges - adj.size + components);
}

export function stats(state: State): BankStats {
  const bank = Object.values(state.bank);
  const starts = new Set(bank.map((e) => e.fs));
  const ends = new Set(bank.map((e) => e.ls).filter((s): s is string => s !== null));
  return {
    total: bank.length,
    recalled: bank.filter((e) => e.recalls > 0).length,
    totalRecalls: bank.reduce((n, e) => n + e.recalls, 0),
    chains: minChains(bank),
    deadEnds: [...ends].filter((s) => !starts.has(s)).sort(),
    endings: ends.size,
    danglers: bank.filter((e) => e.ls === null).length,
    longest: longestChain(bank),
    cycles: cycleCount(bank),
  };
}

/** Words in the bank starting with `syl` that this sweep hasn't used yet. */
export function available(state: State, syl: string): BankEntry[] {
  const used = new Set(state.sweep);
  return Object.values(state.bank).filter((e) => e.fs === syl && !used.has(e.w));
}

/** Every word this sweep hasn't used yet. */
export function unused(state: State): BankEntry[] {
  const used = new Set(state.sweep);
  return Object.values(state.bank).filter((e) => !used.has(e.w));
}

/**
 * Pick where the next chain should start.
 *
 * Prefers a word whose starting syllable nothing else reaches, since those
 * can only ever open a chain — spending them first leaves the well-connected
 * words free to form longer chains later.
 */
export function pickChainStart(state: State): BankEntry | null {
  const remaining = unused(state);
  if (remaining.length === 0) return null;
  const reachable = new Set(remaining.map((e) => e.ls).filter((s): s is string => s !== null));
  const openers = remaining.filter((e) => !reachable.has(e.fs));
  const pool = openers.length > 0 ? openers : remaining;
  return pool[Math.floor(Math.random() * pool.length)];
}
