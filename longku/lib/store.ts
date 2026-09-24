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
  /**
   * How well the word is known, 0 to 1, from evidence alone.
   *
   * `recalls` counts how often a word came up and went well, which favours
   * words starting with common syllables regardless of whether they're known,
   * and can only ever rise. Strength is a moving average over outcomes: a
   * recall pulls it toward 1, a miss toward 0, and nothing else moves it.
   */
  strength: number;
  /** Times the word was available under a prompt and not produced. */
  misses: number;
  /** When it was last available under a prompt — not the same as recalled. */
  lastSeen?: number;
  added: number;
  lastRecalled?: number;
  offCorpus?: boolean;
}

export interface State {
  bank: Record<string, BankEntry>;
  /**
   * Words played this session, oldest first.
   *
   * The order is load-bearing now: the log draws a word under every earlier
   * word it can follow, so "earlier" has to mean when it was produced. It used
   * to come back from the server as a set — one boolean per bank row, read in
   * the order the words were added — which was fine while the log was a line
   * the client kept for itself, and wrong the moment the order meant anything.
   */
  sweep: string[];
  /**
   * The words this session set out to ask for, chosen when it was planned.
   *
   * Held rather than recomputed from what is due: pressing Stuck? stamps
   * lastSeen on every unplayed word in the bucket, which pushes them past
   * their due date, so a session derived live from due-ness would drop the
   * rest of a bucket the moment you asked to see it — exactly when you most
   * need to be asked again.
   */
  session: string[];
  /** When the session was planned, for the roll over to a new day. */
  started: number | null;
}

// There is no linear chain state here any more. Drilling a bucket means
// consecutive words share a starting syllable and don't chain to each other,
// so there is no walk to record — the log derives what connects to what from
// `sweep` instead. longku_sweep.chains keeps whatever the last chain-walking
// session wrote; nothing reads or overwrites it, and the jielong game can pick
// it up when it is built.

export type Mode = "server" | "spectator" | "local";

const EMPTY: State = { bank: {}, sweep: [], session: [], started: null };

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
      bank[w] = {
        w,
        fs,
        ls: null,
        recalls: n,
        // What the moving average would have reached given that many successes.
        strength: 1 - Math.pow(1 - LEARNING_RATE, Math.min(n, 12)),
        misses: 0,
        added,
        lastRecalled: e.lastSeen,
      };
    }
    for (const w of e.taught ?? []) {
      if (!bank[w]) bank[w] = { w, fs, ls: null, recalls: 0, strength: 0, misses: 0, added };
    }
  }
  return Object.keys(bank).length > 0
    ? { bank, sweep: [], session: [], started: null }
    : null;
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
  if (isV2(current)) {
    return {
      bank: current.bank ?? {},
      sweep: current.sweep ?? [],
      session: current.session ?? [],
      started: current.started ?? null,
    };
  }
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
/**
 * The whole session row, which the server stores as one blob.
 *
 * It is small, always read and written whole, and discarded together — the
 * same reasoning that put the chains there in the first place. Sending it with
 * every write means the played order survives a reload, which a per-row
 * in_sweep flag could never express.
 */
function envelope() {
  return {
    played: _state.sweep,
    session: _state.session,
    started: _state.started,
  };
}

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
        _state = {
          bank,
          sweep: d.sweep ?? [],
          session: d.session ?? [],
          started: d.started ?? null,
        };
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

/**
 * How far one outcome moves a word's strength.
 *
 * At 0.4 a first recall reaches 0.4 and a third about 0.78, while a miss on a
 * well-known word drops it to roughly 0.47 — enough to resurface it without
 * discarding everything the earlier recalls established.
 */
const LEARNING_RATE = 0.4;

/**
 * Hours over which a repeat observation regains its full weight.
 *
 * Producing a word twice in a minute is one piece of evidence recorded twice:
 * the second attempt is answered from working memory, not from having learned
 * anything, so crediting it in full lets a word be drilled to a high strength
 * in a single sitting without the knowledge lasting past it.
 *
 * This is not the strength decaying with time — nothing erodes while you're
 * away. It's how much a new observation is worth given how recently the last
 * one happened: near zero immediately after, about 12% at an hour, 63% at
 * eight, and effectively full after a day.
 */
const SPACING_HOURS = 8;

function spacing(last: number | undefined): number {
  if (!last) return 1;
  const hours = Math.max(0, (Date.now() - last) / 3_600_000);
  return 1 - Math.exp(-hours / SPACING_HOURS);
}

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
  _state = {
    bank: { ..._state.bank },
    sweep: [..._state.sweep],
    session: [..._state.session],
    started: _state.started,
  };
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
      strength: 0,
      misses: 0,
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

/**
 * Play `word` into the current chain.
 *
 * `recalled` is false when the word was revealed first — clicked out of the
 * "Stuck?" list rather than produced from memory. Those still advance the
 * sweep and join the chain, but they don't increment the recall count, because
 * that number is the whole progress model and "times I was shown it" is not
 * the same claim as "times I produced it".
 */
export function playWord(word: string, recalled: boolean): State {
  const e = _state.bank[word];
  if (!e) return _state;
  const now = Date.now();
  e.lastSeen = now;
  if (recalled) {
    // Weighed before lastRecalled moves, or the gap would always read as zero.
    const weight = spacing(e.lastRecalled);
    e.recalls += 1;
    e.lastRecalled = now;
    e.strength = e.strength + LEARNING_RATE * weight * (1 - e.strength);
  }
  // A prompted play records nothing: the miss was already taken when the list
  // was revealed, and crediting the click would cancel it out.
  if (!_state.sweep.includes(word)) _state.sweep.push(word);
  push({
    op: "play",
    w: word,
    recalled,
    strength: e.strength,
    sweep: envelope(),
  });
  return commit();
}

/**
 * Record that the bank's words for `syl` were shown rather than recalled.
 *
 * Asking to see the options is evidence about every word that was sitting
 * there: each was available under the prompt and none was produced. Without
 * this a word could be failed indefinitely and still look strong, because
 * nothing but success was ever written down.
 */
export function recordMiss(syl: string): State {
  const used = new Set(_state.sweep);
  const now = Date.now();
  const hit: string[] = [];
  for (const e of Object.values(_state.bank)) {
    if (e.fs !== syl || used.has(e.w)) continue;
    e.misses += 1;
    // Damped the same way: pressing Stuck? twice on one syllable in a minute
    // is the same gap in knowledge, not two of them.
    e.strength = e.strength * (1 - LEARNING_RATE * spacing(e.lastSeen));
    e.lastSeen = now;
    hit.push(e.w);
  }
  if (hit.length === 0) return _state;
  push({
    op: "miss",
    words: hit.map((w) => ({ w, strength: _state.bank[w].strength })),
  });
  return commit();
}

export function removeWord(word: string): State {
  delete _state.bank[word];
  _state.sweep = _state.sweep.filter((w) => w !== word);
  // Dropped from the plan as well as the log: a session waiting on a word that
  // no longer exists could never reach its end.
  _state.session = _state.session.filter((w) => w !== word);
  push({ op: "remove", w: word, sweep: envelope() });
  return commit();
}

/**
 * Begin a session over `words`, discarding whatever the last one had going.
 *
 * The plan is stored rather than recomputed so that what the session asks for
 * doesn't move under it — see State.session. `started` is what rolls the
 * session over to a new day; it's stamped here and nowhere else.
 */
export function startSession(words: string[], now: number = Date.now()): State {
  _state.sweep = [];
  _state.session = [...words];
  _state.started = now;
  push({ op: "startSession", sweep: envelope() });
  return commit();
}

/** Is `started` from an earlier day than `now`, in the viewer's own timezone? */
export function isStale(started: number | null, now: number = Date.now()): boolean {
  if (started === null) return true;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return started < midnight.getTime();
}
