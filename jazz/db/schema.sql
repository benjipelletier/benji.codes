-- Jazz practice logging schema.
-- Auth is handled by Neon Auth (Stack Auth). User identities live in
-- neon_auth.users_sync (managed by Neon). We FK against that table loosely
-- by storing the Stack user id as TEXT — no actual FK constraint, per Neon's
-- recommendation, because users_sync rows can be deleted when accounts are
-- removed.
--
-- Keys are integers 0-11 (semitones from C). 0=C, 1=Db, 2=D, 3=Eb, 4=E, 5=F,
-- 6=Gb, 7=G, 8=Ab, 9=A, 10=Bb, 11=B.

CREATE TABLE IF NOT EXISTS standards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    composer        TEXT,
    style           TEXT,
    home_key        INT NOT NULL CHECK (home_key BETWEEN 0 AND 11),
    is_minor        BOOLEAN NOT NULL DEFAULT FALSE,
    source_bpm      INT,
    target_bpm      INT NOT NULL,
    bpm_source      TEXT NOT NULL CHECK (bpm_source IN ('ireal', 'style_heuristic', 'manual')),
    time_signature  TEXT NOT NULL DEFAULT '4/4',
    form            TEXT,
    chart_data      JSONB NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (title, composer)
);
CREATE INDEX IF NOT EXISTS idx_standards_title ON standards(title);

CREATE TABLE IF NOT EXISTS checklist_skills (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL UNIQUE,
    sort_order   INT NOT NULL DEFAULT 0,
    description  TEXT,
    tracks_bpm   BOOLEAN NOT NULL DEFAULT TRUE,
    -- Matrix-shape skill cell. LH × RH pair within a mode.
    -- lh_group ∈ ('shells'|'chords'|'bass'), lh_part ∈ ('3-7s'|'stock'|'willy'|'sustained-bass'|'half-bass'|'quarter-bass'),
    -- rh_part ∈ ('3-7s'|'stock'|'melody'|'solo'), mode ∈ ('trio') for now.
    lh_group     TEXT,
    lh_part      TEXT,
    rh_part      TEXT,
    mode         TEXT NOT NULL DEFAULT 'trio'
);

CREATE TABLE IF NOT EXISTS practice_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       TEXT NOT NULL,
    standard_id   UUID NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
    practice_key  INT CHECK (practice_key BETWEEN 0 AND 11),
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at      TIMESTAMPTZ,
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_standard ON practice_sessions(user_id, standard_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON practice_sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS practice_session_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id        UUID NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
    skill_id          UUID NOT NULL REFERENCES checklist_skills(id) ON DELETE CASCADE,
    bpm               INT,
    duration_seconds  INT,
    notes             TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_items_session ON practice_session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_items_skill_session ON practice_session_items(skill_id, session_id);

CREATE TABLE IF NOT EXISTS target_bpm_changes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    standard_id   UUID NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL,
    old_value     INT,
    new_value     INT NOT NULL,
    changed_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tbc_standard ON target_bpm_changes(standard_id, changed_at DESC);

-- Saved voicings for individual chord symbols (e.g. "Cmaj7", "F-7", "Bb7/D").
-- Globally addressable across standards: a Cmaj7 voicing saved while practicing
-- Sunny Side surfaces on any other standard that contains Cmaj7. Voicings are
-- absolute (MIDI numbers, not chord-relative) per user spec — Cmaj7 ≠ Fmaj7.
CREATE TABLE IF NOT EXISTS chord_voicings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chord_symbol        TEXT NOT NULL,
    -- chord_symbol with alterations stripped (E7b9 → E7). Lets us share
    -- voicings bidirectionally across an altered-dominant family. Computed
    -- in the app on insert; see jazz/lib/chord-symbol.ts.
    base_symbol         TEXT NOT NULL,
    voicing_type        TEXT NOT NULL DEFAULT 'willy',
    notes               INT[] NOT NULL,
    label               TEXT,
    sort_order          INT NOT NULL DEFAULT 0,
    origin_standard_id  UUID REFERENCES standards(id) ON DELETE SET NULL,
    created_by          TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chord_voicings_symbol ON chord_voicings(chord_symbol, voicing_type);
CREATE INDEX IF NOT EXISTS idx_chord_voicings_base   ON chord_voicings(base_symbol, voicing_type);
