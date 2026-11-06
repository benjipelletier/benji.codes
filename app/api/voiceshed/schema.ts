// Voiceshed's tables, made on first use (the same statements are in
// voiceshed/db/schema.sql). The first read also seeds the library from the
// owner's shapes (voiceshed/lib/theory.ts, SHAPE_SETS) and the ii–V–I
// progressions when they are empty.

import type { NeonQueryFunction } from '@neondatabase/serverless';
import { starterProgressions, starterVoicings } from '@voiceshed/lib/theory';

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
    notes_text       TEXT,
    sort_order       INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chord_label, family, notes)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_voicings_label ON voicings(chord_label)`,
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
];

const VOICING_COLUMNS = `chord_label text, root int, quality text, notes text[], top_note text, family text, tags text[], lowest_register int, sort_order int`;

async function seed(sql: Sql) {
  const [{ n: nv }] = (await sql`SELECT COUNT(*)::int AS n FROM voicings`) as { n: number }[];
  if (nv === 0) {
    const rows = starterVoicings();
    await sql.query(
      `INSERT INTO voicings (chord_label, root, quality, notes, top_note, family, tags, lowest_register, sort_order)
       SELECT chord_label, root, quality, notes, top_note, family, tags, lowest_register, sort_order
       FROM jsonb_to_recordset($1::jsonb) AS t(${VOICING_COLUMNS})
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(rows)],
    );
  }
  const [{ n: nc }] = (await sql`SELECT COUNT(*)::int AS n FROM contexts`) as { n: number }[];
  if (nc === 0) {
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
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(rows)],
    );
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
