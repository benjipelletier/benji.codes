-- 龙库 bank storage.
--
-- Single-tenant in practice (one owner writes, everyone else reads), but rows
-- are keyed by owner_email anyway so the table doesn't have to be rewritten if
-- that ever changes.

create table if not exists longku_bank (
  owner_email   text        not null,
  w             text        not null,
  fs            text        not null,
  ls            text,                        -- null when no reading is known
  f             integer,                     -- corpus frequency; null off-corpus
  recalls       integer     not null default 0,
  off_corpus    boolean     not null default false,
  added         timestamptz not null default now(),
  last_recalled timestamptz,
  -- Words used in the current sweep. Kept on the row rather than in a side
  -- table so resetting a sweep is one statement and a word can't outlive it.
  in_sweep      boolean     not null default false,
  primary key (owner_email, w)
);

-- The wall groups by starting syllable on every render.
create index if not exists longku_bank_owner_fs_idx on longku_bank (owner_email, fs);
