// iFake Pro's tables. Every statement is idempotent: the API runs them on a
// fresh database the first time it's used (ensureSchema in app/api/ifakepro/db.ts),
// and ifakepro/scripts/setup-db.ts runs them by hand.

export const SCHEMA = `
-- iFake Pro. Every table is prefixed ifp_. Apply with ifakepro/scripts/setup-db.ts
-- (idempotent). Users come from the site-wide Neon Auth, whose own user table
-- lives in another database, so the people who have used the app are copied
-- into ifp_profiles as they sign in. User ids are Neon Auth ids (TEXT).

CREATE TABLE IF NOT EXISTS ifp_profiles (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    name        TEXT,
    image       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ifp_playlists (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    owner_id     TEXT NOT NULL,
    -- public: listed on the home page. unlisted: anyone with the link.
    visibility   TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted')),
    -- The secret in the invite link. Rotating it stops old links from working.
    edit_token   TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ifp_members (
    playlist_id  UUID NOT NULL REFERENCES ifp_playlists(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (playlist_id, user_id)
);
CREATE INDEX IF NOT EXISTS ifp_members_user ON ifp_members(user_id);

-- A song belongs to one playlist; copying it to another makes a new song.
-- revision goes up by one on every save: a save names the revision it
-- started from and only lands if that is still current.
CREATE TABLE IF NOT EXISTS ifp_songs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id  UUID NOT NULL REFERENCES ifp_playlists(id) ON DELETE CASCADE,
    position     DOUBLE PRECISION NOT NULL,
    meta         JSONB NOT NULL,
    chart        JSONB NOT NULL,
    revision     INT NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   TEXT NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   TEXT NOT NULL,
    deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ifp_songs_playlist ON ifp_songs(playlist_id, position);

-- Version history. Saves by one person within ten minutes of each other fold
-- into one version, the way Google Docs groups them; naming a version
-- (label) keeps later saves from folding into it.
CREATE TABLE IF NOT EXISTS ifp_versions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id      UUID NOT NULL REFERENCES ifp_songs(id) ON DELETE CASCADE,
    revision     INT NOT NULL,
    meta         JSONB NOT NULL,
    chart        JSONB NOT NULL,
    author_id    TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('create', 'import', 'edit', 'restore', 'copy')),
    summary      TEXT NOT NULL DEFAULT '',
    label        TEXT,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ifp_versions_song ON ifp_versions(song_id, created_at DESC);

-- Comments on a bar (bar_id, the chart's own bar id) or on the whole song
-- (bar_id NULL). Replies point at their thread's first comment.
CREATE TABLE IF NOT EXISTS ifp_comments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    song_id      UUID NOT NULL REFERENCES ifp_songs(id) ON DELETE CASCADE,
    bar_id       TEXT,
    parent_id    UUID REFERENCES ifp_comments(id) ON DELETE CASCADE,
    body         TEXT NOT NULL,
    author_id    TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at    TIMESTAMPTZ,
    resolved_at  TIMESTAMPTZ,
    resolved_by  TEXT,
    deleted_at   TIMESTAMPTZ,
    -- Bumped on any change, so a poll can tell the thread list is stale.
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ifp_comments_song ON ifp_comments(song_id, created_at);

-- The edit log, per playlist and across all of them. Edits fold the same
-- way versions do, and point at their version in data.versionId.
CREATE TABLE IF NOT EXISTS ifp_activity (
    id           BIGSERIAL PRIMARY KEY,
    playlist_id  UUID NOT NULL REFERENCES ifp_playlists(id) ON DELETE CASCADE,
    song_id      UUID REFERENCES ifp_songs(id) ON DELETE CASCADE,
    actor_id     TEXT NOT NULL,
    kind         TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    data         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ifp_activity_playlist ON ifp_activity(playlist_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ifp_activity_song ON ifp_activity(song_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ifp_activity_time ON ifp_activity(created_at DESC);

-- Who has a song open, and which bar they're on. Rows older than ~20s are stale.
CREATE TABLE IF NOT EXISTS ifp_presence (
    song_id   UUID NOT NULL REFERENCES ifp_songs(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL,
    bar_id    TEXT,
    editing   BOOLEAN NOT NULL DEFAULT false,
    seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (song_id, user_id)
);
`;

/** One statement at a time, for drivers that take a single statement per query. */
export function schemaStatements(): string[] {
  return SCHEMA.replace(/--.*$/gm, '')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}
