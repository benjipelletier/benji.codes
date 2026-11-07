// Voiceshed's tables, made on first use (the same statements are in
// voiceshed/db/schema.sql). The first read also seeds the library from the
// owner's shapes (voiceshed/lib/theory.ts, SHAPE_SETS) — again, additively,
// whenever SEED_VERSION goes up — and the ii–V–I progressions when empty.

import type { NeonQueryFunction } from '@neondatabase/serverless';
import { RARE_SPELLINGS, SHAPE_SETS, starterProgressions, starterVoicings } from '@voiceshed/lib/theory';

type Sql = NeonQueryFunction<false, false>;

export const TRAINER_DDL = [
  `CREATE TABLE IF NOT EXISTS voicings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chord_label      TEXT NOT NULL,
    root             INT NOT NULL CHECK (root BETWEEN 0 AND 11),
    quality          TEXT NOT NULL,
    notes            TEXT[] NOT NULL,
    top_note         TEXT NOT NULL,
    family           TEXT NOT NULL,
    tags             TEXT[] NOT NULL DEFAULT '{}',
    lowest_register  INT,
    top_move         TEXT,
    notes_text       TEXT,
    sort_order       INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chord_label, family, notes)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_voicings_label ON voicings(chord_label)`,
  // Added later: a database made before has the table without it.
  `ALTER TABLE voicings ADD COLUMN IF NOT EXISTS top_move TEXT`,
  // A voicing heard in the wild: where (a YouTube or Spotify link), when (seconds in), and what song.
  `ALTER TABLE voicings ADD COLUMN IF NOT EXISTS source_url TEXT`,
  `ALTER TABLE voicings ADD COLUMN IF NOT EXISTS source_time INT`,
  `ALTER TABLE voicings ADD COLUMN IF NOT EXISTS source_label TEXT`,
  // …and the standard (or iFake Pro song) it belongs to: its tune id and title.
  `ALTER TABLE voicings ADD COLUMN IF NOT EXISTS source_tune_id TEXT`,
  `ALTER TABLE voicings ADD COLUMN IF NOT EXISTS source_tune_title TEXT`,
  `CREATE TABLE IF NOT EXISTS contexts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        TEXT NOT NULL CHECK (type IN ('progression', 'tune')),
    name        TEXT NOT NULL,
    key         INT NOT NULL CHECK (key BETWEEN 0 AND 11),
    tune_id     UUID,
    steps       JSONB NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (type, name)
  )`,
  `CREATE TABLE IF NOT EXISTS attempts (
    id            UUID PRIMARY KEY,
    user_id       TEXT NOT NULL,
    voicing_id    UUID NOT NULL REFERENCES voicings(id) ON DELETE CASCADE,
    mode          TEXT NOT NULL CHECK (mode IN ('play', 'spell', 'name')),
    context_type  TEXT NOT NULL CHECK (context_type IN ('isolated', 'progression', 'tune')),
    context_id    UUID,
    run_id        UUID,
    correct       BOOLEAN NOT NULL,
    slow          BOOLEAN NOT NULL DEFAULT FALSE,
    response_ms   INT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_attempts_user_created ON attempts(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS srs_state (
    user_id        TEXT NOT NULL,
    voicing_id     UUID NOT NULL REFERENCES voicings(id) ON DELETE CASCADE,
    mode           TEXT NOT NULL CHECK (mode IN ('play', 'spell', 'name')),
    ease           REAL NOT NULL,
    interval_days  REAL NOT NULL,
    due_at         TIMESTAMPTZ NOT NULL,
    target_ms      INT,
    learned        BOOLEAN NOT NULL DEFAULT FALSE,
    reps           INT NOT NULL DEFAULT 0,
    lapses         INT NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, voicing_id, mode)
  )`,
  `CREATE TABLE IF NOT EXISTS voicing_runs (
    id            UUID PRIMARY KEY,
    user_id       TEXT NOT NULL,
    set_key       TEXT NOT NULL,
    set_label     TEXT NOT NULL,
    mode          TEXT NOT NULL,
    context_type  TEXT NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL,
    finished_at   TIMESTAMPTZ NOT NULL,
    cards         INT NOT NULL,
    correct       INT NOT NULL,
    avg_ms        INT NOT NULL,
    slow          INT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_voicing_runs_user ON voicing_runs(user_id, set_key, finished_at DESC)`,
  `CREATE TABLE IF NOT EXISTS voiceshed_meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  )`,
];

/**
 * Bumped when the generated library changes. A database seeded at an older
 * version gets the new voicings added once; the ones it has, edited or not,
 * are left alone — but for what a version says it changes.
 *   2: black-key roots under both names.
 *   3: the m7♭5 spread is one voicing whose top moves 11 → ♭3: its ♭3 cards
 *      (1 ♭5 ♭7 ♭3) go, answers with them, and the 11 cards get their move.
 *   4: the spread files under drop-2 two-hand (the closed one stays its own
 *      type); its own tags are kept, the set's added.
 *   5: rare spellings go (RARE_SPELLINGS: A♯m7, D♯m7…), answers with them —
 *      generated ones only; a voicing added by hand stays whatever its name.
 *   6: the 6 chord (3 6 9 5, drop-2 two-hand) joins: added, not into the deck.
 *   7: 7♭9 (drop-2 two-hand, 3 ♭7 ♭9 5 and ♭7 3 5 ♭9) joins; D♭7♭9 and
 *      A♭7♭9 spelled with their double flat, as charts write them.
 *   8: altered dominants join (drop-2 two-hand: 3 ♭7 ♯9 ♭13, and ♭7 3 ♭13 ♯9
 *      whose ♯9 moves to ♭9); double accidentals where charts use the name.
 *   9: °7 joins (drop-2 two-hand, R ♭5 𝄫7 ♭3 and ♭5 R ♭3 𝄫7: the 7♭9 shapes).
 *  10: the minor ii–V–i ends on m7 instead of m6 (progressions only).
 *  11: °7 gets all four drop-2 inversions (♭3 𝄫7 R ♭5 and 𝄫7 ♭3 ♭5 R join).
 *  12: the iii's m7 voicings join (8 for 9: drop-2 ♭3 ♭7 1 5 · ♭7 ♭3 5 1,
 *      right-hand 5 ♭7 1 ♭3, block 5 ♭7 1 ♭3 5, tagged iii); "m7b5 closed"
 *      becomes "closed (block)", holding both block chords.
 *  13: right-hand rootless goes, for now (the owner: "keep this as a two-hand
 *      comping thing … get rid of all the right-handed stuff"): its voicings,
 *      with their cards and answers. The shapes stay in SHAPE_SETS, marked later.
 *  14: block chords are tagged two-handed, so two-hand Practice runs play them.
 */
const SEED_VERSION = 14;

const VOICING_COLUMNS = `chord_label text, root int, quality text, notes text[], top_note text, top_move text, family text, tags text[], lowest_register int, sort_order int`;

async function seed(sql: Sql) {
  const rows0 = (await sql`SELECT value FROM voiceshed_meta WHERE key = 'seed_version'`) as { value: string }[];
  const seeded = Number(rows0[0]?.value ?? 0);
  if (seeded < SEED_VERSION) {
    const rows = starterVoicings();
    if (seeded < 3) {
      await sql.query(`DELETE FROM voicings WHERE family = 'm7b5 spread' AND '1-5-7-3' = ANY(tags)`);
    }
    if (seeded < 4) {
      // The spread, from its own type to drop-2 two-hand, with its move (3) — a
      // database at 2 or 3 alike. Tags it has stay; the set's are added.
      await sql.query(
        `UPDATE voicings v SET family = t.family, top_move = t.top_move,
           tags = v.tags || ARRAY(SELECT x FROM unnest(t.tags) x WHERE NOT x = ANY(v.tags)),
           updated_at = NOW()
         FROM jsonb_to_recordset($1::jsonb) AS t(${VOICING_COLUMNS})
         WHERE v.family = 'm7b5 spread' AND v.chord_label = t.chord_label AND v.notes = t.notes AND t.top_move IS NOT NULL`,
        [JSON.stringify(rows)],
      );
    }
    if (seeded < 5) {
      await sql.query(`DELETE FROM voicings WHERE chord_label = ANY($1::text[]) AND family = ANY($2::text[])`, [
        [...RARE_SPELLINGS],
        // Today's families, and the spread's own type from before version 4
        // (a rare spelling of it was never moved, so it's still there).
        [...SHAPE_SETS.map(set => set.family), 'm7b5 spread'],
      ]);
    }
    if (seeded < 14) {
      await sql.query(
        `UPDATE voicings SET tags = array_prepend('two-handed', tags), updated_at = NOW()
         WHERE family = 'closed (block)' AND NOT ('two-handed' = ANY(tags))`,
      );
    }
    if (seeded < 13) {
      await sql.query(`DELETE FROM voicings WHERE family = 'right-hand rootless'`);
    }
    if (seeded < 12) {
      // The m7♭5's block chord's type takes the iii's m7 block too, under a wider name.
      await sql.query(`UPDATE voicings SET family = 'closed (block)', updated_at = NOW() WHERE family = 'm7b5 closed'`);
    }
    await sql.query(
      `INSERT INTO voicings (chord_label, root, quality, notes, top_note, top_move, family, tags, lowest_register, sort_order)
       SELECT chord_label, root, quality, notes, top_note, top_move, family, tags, lowest_register, sort_order
       FROM jsonb_to_recordset($1::jsonb) AS t(${VOICING_COLUMNS})
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(rows)],
    );
    await sql.query(
      `INSERT INTO voiceshed_meta (key, value) VALUES ('seed_version', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(SEED_VERSION)],
    );
  }
  // The progressions: added when missing, and their steps brought up to date
  // with each seed version (nothing edits them by hand yet).
  const [{ n: nc }] = (await sql`SELECT COUNT(*)::int AS n FROM contexts WHERE type = 'progression'`) as { n: number }[];
  if (nc === 0 || seeded < SEED_VERSION) {
    const rows = starterProgressions().map(p => ({
      name: p.name,
      key: p.key,
      sort_order: p.sort_order,
      steps: p.steps.map(s => ({ ...s, voicing_id: null })),
    }));
    await sql.query(
      `INSERT INTO contexts (type, name, key, steps, sort_order)
       SELECT 'progression', name, key, steps, sort_order
       FROM jsonb_to_recordset($1::jsonb) AS t(name text, key int, steps jsonb, sort_order int)
       ON CONFLICT (type, name) DO UPDATE SET steps = EXCLUDED.steps, key = EXCLUDED.key, sort_order = EXCLUDED.sort_order`,
      [JSON.stringify(rows)],
    );
    // One no longer generated (a key that can't be spelled) goes.
    await sql.query(`DELETE FROM contexts WHERE type = 'progression' AND NOT (name = ANY($1::text[]))`, [rows.map(r => r.name)]);
  }
}

let ready: Promise<void> | null = null;

/** Tables made and starter data seeded: once per server instance. */
export function ensureTrainer(sql: Sql): Promise<void> {
  ready ??= (async () => {
    for (const ddl of TRAINER_DDL) await sql.query(ddl);
    await seed(sql);
  })().catch(err => {
    ready = null;
    throw err;
  });
  return ready;
}
