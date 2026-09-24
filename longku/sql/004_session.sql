-- Sessions: what today asked for, and in what order it was answered.
--
-- A sweep used to be "the whole bank", so the only state it needed was which
-- words had been used — one boolean per row, read back in whatever order the
-- rows came. Two things broke that.
--
-- The log now draws a word under every earlier word it can follow, so the
-- order words were *played* is part of the record and a per-row flag can't
-- express it. And a session is now the words that came due, chosen once and
-- held: pressing Stuck? stamps last_seen on the rest of the bucket and pushes
-- it past its due date, so a session recomputed from due-ness would shed the
-- words you had just admitted you couldn't produce.
--
-- Both live on the existing one-row-per-owner sweep table, which is already
-- small, always read and written whole, and discarded together.

alter table longku_sweep add column if not exists played  jsonb not null default '[]'::jsonb;
alter table longku_sweep add column if not exists session jsonb not null default '[]'::jsonb;
-- Null means "no session yet"; the client compares it against its own local
-- midnight, since only the viewer knows what day it is where they are.
alter table longku_sweep add column if not exists started timestamptz;

-- Seed the played list from the flags so an in-progress sweep survives the
-- migration. Order is unknowable here — added order is the best guess, and it
-- is what the client was already being handed.
update longku_sweep s
set played = coalesce(
  (select jsonb_agg(b.w order by b.added)
   from longku_bank b
   where b.owner_email = s.owner_email and b.in_sweep),
  '[]'::jsonb
)
where s.played = '[]'::jsonb;
