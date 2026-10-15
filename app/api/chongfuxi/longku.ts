// 龙库 (longku), the chengyu chain game, is backed by this app.
//
// Its tables (longku_bank, longku_review, longku_sweep, longku_excluded) live
// in this database, and its words are deck words here: longku_bank holds
// longku's own game state (strength, due, sweeps) for the deck words it
// plays. The two keep separate schedules by the owner's choice; what they
// share is which words exist.
//
// The link, kept by `reconcileLongku` after anything that changes the deck:
// - every deck word that is a chengyu (in longku's idiom list) is in longku,
//   unless the owner removed it there (longku_excluded);
// - a longku word that has left the deck leaves longku.
// Adding in longku puts the word in the deck too (`longkuAdd`); removing in
// longku only unlinks it and remembers that (`longkuRemove`).

import type { Sql } from "./db";
import type { Dict } from "@chongfuxi/lib/dict";
import type { Schedule } from "@chongfuxi/lib/schedule";
import { lookupWord } from "@longku/lib/data";
import { intervalDays } from "@longku/lib/srs";

const DAY = 86_400_000;

/**
 * Bring longku's word set into line with the deck: link deck chengyu it lacks
 * (not ones the owner removed there), unlink words no longer in the deck.
 * Returns what changed.
 */
export async function reconcileLongku(sql: Sql, owner: string): Promise<{ linked: string[]; unlinked: string[] }> {
  const rows = (await sql`
    select w.word,
           exists (select 1 from longku_bank b where b.owner_email = w.owner_email and b.w = w.word) as linked,
           exists (select 1 from longku_excluded x where x.owner_email = w.owner_email and x.w = w.word) as excluded
    from chongfuxi_word w
    where w.owner_email = ${owner} and w.status = 'deck'
  `) as unknown as Array<{ word: string; linked: boolean; excluded: boolean }>;
  const link = rows
    .filter((r) => !r.linked && !r.excluded)
    .map((r) => ({ r, e: lookupWord(r.word) }))
    .filter((x) => x.e !== null)
    .map(({ r, e }) => ({ w: r.word, fs: e!.fs, ls: e!.ls, f: e!.f }));
  if (link.length) {
    await sql`
      insert into longku_bank (owner_email, w, fs, ls, f)
      select ${owner}, e.value->>'w', e.value->>'fs', e.value->>'ls', (e.value->>'f')::int
      from jsonb_array_elements(${JSON.stringify(link)}::jsonb) e
      on conflict (owner_email, w) do nothing
    `;
  }
  const unlinked = (await sql`
    delete from longku_bank b
    where b.owner_email = ${owner}
      and not exists (select 1 from chongfuxi_word w where w.owner_email = b.owner_email and w.word = b.w and w.status = 'deck')
    returning b.w
  `) as unknown as Array<{ w: string }>;
  return { linked: link.map((l) => l.w), unlinked: unlinked.map((u) => u.w) };
}

/** The words of these that are in longku: shown with a 龙库 tag here. */
export async function longkuWords(sql: Sql, owner: string, words: string[]): Promise<Set<string>> {
  if (!words.length) return new Set();
  const rows = (await sql`
    select w from longku_bank where owner_email = ${owner} and w = any(${words}::text[])
  `) as unknown as Array<{ w: string }>;
  return new Set(rows.map((r) => r.w));
}

/** A longku word as its "add" sends it: the word, its first and last syllables, frequency. */
export interface LongkuWord {
  w: string;
  fs: string;
  ls: string | null;
  f?: number;
}

/**
 * Add words from longku: into the deck here (one addition, source "longku",
 * with a new Read card each), and into longku's bank. A word removed from
 * longku before is welcome back. Returns the words longku didn't have.
 */
export async function longkuAdd(sql: Sql, owner: string, words: LongkuWord[], dict: Dict, at = Date.now()): Promise<string[]> {
  if (!words.length) return [];
  // Imported here, not at the top: additions.ts reconciles through this module.
  const { addWords } = await import("./additions");
  const list = words.map((w) => w.w);
  await sql`delete from longku_excluded where owner_email = ${owner} and w = any(${list}::text[])`;
  const added: string[] = [];
  for (const word of words) {
    // A repeat add must not reset longku's record, but may fill in a reading or frequency.
    const res = (await sql`
      insert into longku_bank (owner_email, w, fs, ls, f)
      values (${owner}, ${word.w}, ${word.fs}, ${word.ls ?? null}, ${word.f ?? null})
      on conflict (owner_email, w) do update set
        ls = coalesce(longku_bank.ls, excluded.ls),
        f  = coalesce(longku_bank.f,  excluded.f)
      returning (xmax = 0) as inserted
    `) as unknown as Array<{ inserted: boolean }>;
    if (res[0]?.inserted) added.push(word.w);
  }
  await addWords(sql, owner, "longku", list, dict, at);
  return added;
}

/**
 * Remove a word from longku: its game state goes, and it stays out of longku
 * even though it is still a chengyu in the deck. The deck word and its cards
 * here are untouched.
 */
export async function longkuRemove(sql: Sql, owner: string, word: string): Promise<void> {
  await sql.transaction([
    sql`delete from longku_bank where owner_email = ${owner} and w = ${word}`,
    sql`
      insert into longku_excluded (owner_email, w) values (${owner}, ${word})
      on conflict (owner_email, w) do update set at = now()
    `,
  ]);
}

/** A longku bank row, as much of it as seeding needs. */
export interface LongkuRecord {
  strength: number;
  recalls: number;
  misses: number;
  added: number;
  lastRecalled: number | null;
  lastSeen: number | null;
}

/**
 * Where a word's Read card starts, from what longku knows of it. Never played
 * there: a new card. Otherwise longku's own interval for its strength stands
 * for the stability, counted from when it was last recalled (or seen), and
 * the share of misses sets the difficulty, as Pleco's record does.
 */
export function seedFromLongku(r: LongkuRecord, at: number): Schedule {
  const outcomes = r.recalls + r.misses;
  if (outcomes === 0) {
    return { state: 0, due: at, stability: 0, difficulty: 0, reps: 0, lapses: 0, scheduledDays: 0, lastReview: null };
  }
  const stability = intervalDays(r.strength);
  const last = r.lastRecalled ?? r.lastSeen ?? r.added;
  return {
    state: 2,
    // Already past for most: the card is simply overdue.
    due: last + stability * DAY,
    stability,
    difficulty: Math.min(Math.max(3 + (12 * r.misses) / outcomes, 1), 10),
    reps: r.recalls,
    lapses: r.misses,
    scheduledDays: stability,
    lastReview: last,
  };
}
