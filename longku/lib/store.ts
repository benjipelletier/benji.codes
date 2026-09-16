// Client-side bank state.
//
// v3 moves the bank to the server so it survives a cleared browser and follows
// the owner between devices. The synchronous interface from v2 is kept on
// purpose: every mutation applies to an in-memory copy immediately and is
// written through in the background, so the UI never waits on a round trip and
// no component had to learn about promises.
//
// Three modes:
//   server    — bank storage is configured and this viewer owns it; writes persist
//   spectator — configured, but this viewer is not the owner; writes stay local
//   local     — not configured (or the fetch failed); localStorage, as in v2
//
// Spectators can still chain and recall against the owner's corpus; those
// changes simply don't outlive the tab. That's deliberate — the app is worth
// looking at, and a read-only wall you can't play with isn't.

const STORAGE_KEY = "longku:v2";
/** Earlier keys, newest first. Read once each, then folded in. */
const LEGACY_KEYS = ["longku:v1", "lianlong:v1"];

export interface BankEntry {
  w: string;
  fs: string;
  /** Last syllable. Null when no reading is known — such a word ends a chain. */
  ls: string | null;
  /** Corpus frequency, for tiering and usage coverage. Absent off-corpus. */
  f?: number;
  /** Times produced in play. 0 means banked but never recalled. */
  recalls: number;
  added: number;
  lastRecalled?: number;
  offCorpus?: boolean;
}

export interface State {
  bank: Record<string, BankEntry>;
  /** Words already used in the current sweep through the bank. */
  sweep: string[];
}

export type Mode = "server" | "spectator" | "local";

const EMPTY: State = { bank: {}, sweep: [] };

let _state: State = { ...EMPTY };
let _mode: Mode = "local";

export function getMode(): Mode {
  return _mode;
}

/** True when a change made here will outlive the tab. */
export function canPersist(): boolean {
  return _mode === "server" || _mode === "local";
}

/* ----------------------------------------------------------- local store -- */

function isV2(o: unknown): o is State {
  return !!o && typeof o === "object" && "bank" in (o as Record<string, unknown>);
}

interface V1Entry {
  counts: Record<string, number>;
  taught: string[];
  lastSeen?: number;
}

/**
 * Fold a v1 state into the bank.
 *
 * v1's `counts` were "times typed during play", which is exactly the new recall
 * count. `taught` words were surfaced by the app when the user was stuck — they
 * belong in the bank too, at zero recalls, where a freshly added word starts.
 * `ls` and `f` are unknown here; both are backfilled from the corpus on load.
 */
function migrateV1(raw: unknown): State | null {
  const syllables = (raw as { syllables?: Record<string, V1Entry> })?.syllables;
  if (!syllables || typeof syllables !== "object") return null;
  const bank: Record<string, BankEntry> = {};
  for (const [fs, e] of Object.entries(syllables)) {
    const added = e.lastSeen ?? Date.now();
    for (const [w, n] of Object.entries(e.counts ?? {})) {
      bank[w] = { w, fs, ls: null, recalls: n, added, lastRecalled: e.lastSeen };
    }
    for (const w of e.taught ?? []) {
      if (!bank[w]) bank[w] = { w, fs, ls: null, recalls: 0, added };
    }
  }
  return Object.keys(bank).length > 0 ? { bank, sweep: [] } : null;
}

function readKey(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadLocal(): State {
  if (typeof window === "undefined") return { ...EMPTY };
  const current = readKey(STORAGE_KEY);
  if (isV2(current)) return { bank: current.bank ?? {}, sweep: current.sweep ?? [] };
  // Adopt the newest legacy state we can find. Legacy keys are left in place
  // rather than deleted, so nothing is lost if this needs to be undone.
  for (const key of LEGACY_KEYS) {
    const migrated = migrateV1(readKey(key));
    if (migrated) return migrated;
  }
  return { ...EMPTY };
}

function saveLocal(): void {
  if (typeof window === "undefined" || _mode !== "local") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {
    // Quota or private mode; the in-memory copy is still correct.
  }
}

/* --------------------------------------------------------- server writes -- */

type Op = Record<string, unknown> & { op: string };

/**
 * Fire a write at the server without blocking the caller.
 *
 * Failures are swallowed on purpose: the optimistic local state is already
 * correct for this session, and a reload re-reads the server, so a dropped
 * write shows up as the change not having stuck rather than as a broken UI.
 */
function push(op: Op): void {
  if (_mode !== "server") return;
  void fetch("/api/longku/bank", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(op),
  }).catch(() => {});
}

/* -------------------------------------------------------------- lifecycle -- */

export interface Bootstrap {
  state: State;
  mode: Mode;
  /** Signed-in address, if any — for the spectator banner. */
  email: string | null;
}

/**
 * Decide where the bank lives and load it. Call once on mount.
 *
 * If the server has storage configured we use it, owner or not. Otherwise we
 * fall back to localStorage so the app still works on an unconfigured deploy
 * and in local development.
 */
export async function bootstrap(): Promise<Bootstrap> {
  try {
    const res = await fetch("/api/longku/bank", { cache: "no-store" });
    if (res.ok) {
      const d = await res.json();
      if (d?.configured) {
        _mode = d.isOwner ? "server" : "spectator";
        const bank: Record<string, BankEntry> = {};
        for (const e of d.bank ?? []) bank[e.w] = e as BankEntry;
        _state = { bank, sweep: d.sweep ?? [] };
        return { state: _state, mode: _mode, email: d.email ?? null };
      }
    }
  } catch {
    // Offline or the route is missing; local storage is a fine fallback.
  }
  _mode = "local";
  _state = loadLocal();
  saveLocal();
  return { state: _state, mode: _mode, email: null };
}

export function getState(): State {
  return _state;
}

export function bankList(state: State): BankEntry[] {
  return Object.values(state.bank);
}

/* -------------------------------------------------------------- mutations -- */

export interface ImportWord {
  w: string;
  fs: string;
  ls: string | null;
  f?: number;
  offCorpus?: boolean;
}

export interface ImportSummary {
  added: string[];
  duplicate: string[];
  buckets: string[];
}

/** Snapshot so React sees a new object and re-renders. */
function commit(): State {
  _state = { bank: { ..._state.bank }, sweep: [..._state.sweep] };
  saveLocal();
  return _state;
}

/**
 * Add chengyus to the bank.
 *
 * New words enter at zero recalls: adding a word says you're learning it, not
 * that you can produce it. An existing word is reported as a duplicate and left
 * alone, so re-adding never inflates a recall count.
 */
export function importWords(words: ImportWord[]): {
  state: State;
  summary: ImportSummary;
} {
  const added: string[] = [];
  const duplicate: string[] = [];
  const buckets = new Set<string>();
  const now = Date.now();

  for (const { w, fs, ls, f, offCorpus } of words) {
    const existing = _state.bank[w];
    if (existing) {
      if (existing.ls === null && ls) existing.ls = ls;
      if (existing.f === undefined && f !== undefined) existing.f = f;
      duplicate.push(w);
      continue;
    }
    _state.bank[w] = {
      w,
      fs,
      ls,
      recalls: 0,
      added: now,
      ...(f !== undefined ? { f } : {}),
      ...(offCorpus ? { offCorpus } : {}),
    };
    added.push(w);
    buckets.add(fs);
  }

  if (added.length > 0 || duplicate.length > 0) push({ op: "add", words });
  return { state: commit(), summary: { added, duplicate, buckets: [...buckets].sort() } };
}

/** Fill in readings for entries that lack them (words migrated from v1). */
export function hydrate(
  readings: Array<{ w: string; fs: string; ls: string | null; f?: number }>,
): State {
  const touched: typeof readings = [];
  for (const r of readings) {
    const e = _state.bank[r.w];
    if (!e) continue;
    let changed = false;
    if (e.ls === null && r.ls) {
      e.ls = r.ls;
      changed = true;
    }
    if (e.f === undefined && r.f !== undefined) {
      e.f = r.f;
      changed = true;
    }
    if (r.fs && e.fs !== r.fs) {
      e.fs = r.fs;
      changed = true;
    }
    if (changed) touched.push(r);
  }
  if (touched.length > 0) push({ op: "hydrate", readings: touched });
  return commit();
}

/** Record that the user produced `word` in play, and mark it used this sweep. */
export function recordRecall(word: string): State {
  const e = _state.bank[word];
  if (!e) return _state;
  e.recalls += 1;
  e.lastRecalled = Date.now();
  if (!_state.sweep.includes(word)) _state.sweep.push(word);
  push({ op: "recall", w: word });
  return commit();
}

export function removeWord(word: string): State {
  delete _state.bank[word];
  _state.sweep = _state.sweep.filter((w) => w !== word);
  push({ op: "remove", w: word });
  return commit();
}

/** Begin a fresh pass over the bank. */
export function resetSweep(): State {
  _state.sweep = [];
  push({ op: "resetSweep" });
  return commit();
}
