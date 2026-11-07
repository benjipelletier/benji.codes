-- Voiceshed tables. Also run on first use by app/api/voiceshed/schema.ts
-- (ensureTrainer), which seeds the library from voiceshed/lib/theory.ts
-- (SHAPE_SETS) and the ii–V–I progressions when they are empty.
--
-- voicings.notes are spelled, bottom to top, with octave: {Eb3,Bb3,F4,G4}.
-- lowest_register is a MIDI number (51 = Eb3). attempts / srs_state /
-- voicing_runs.user_id is the owner's email. srs_state: one schedule per
-- voicing per mode. contexts.tune_id is a jazz standards id (no FK: it may
-- live in another database).

CREATE TABLE IF NOT EXISTS voicings (
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
);

CREATE INDEX IF NOT EXISTS idx_voicings_label ON voicings(chord_label);

ALTER TABLE voicings ADD COLUMN IF NOT EXISTS top_move TEXT;

CREATE TABLE IF NOT EXISTS contexts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL CHECK (type IN ('progression', 'tune')),
  name        TEXT NOT NULL,
  key         INT NOT NULL CHECK (key BETWEEN 0 AND 11),
  tune_id     UUID,
  steps       JSONB NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (type, name)
);

CREATE TABLE IF NOT EXISTS attempts (
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
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_created ON attempts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS srs_state (
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
);

CREATE TABLE IF NOT EXISTS voicing_runs (
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
);

CREATE INDEX IF NOT EXISTS idx_voicing_runs_user ON voicing_runs(user_id, set_key, finished_at DESC);

CREATE TABLE IF NOT EXISTS voiceshed_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
