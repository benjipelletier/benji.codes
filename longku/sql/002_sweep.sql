-- The current sweep's chains.
--
-- `longku_bank.in_sweep` records which words have been used, but not how they
-- grouped into chains — and the grouping is the part worth looking at. One row
-- per owner holding the whole sweep is enough: a sweep is tens of words, it is
-- always read and written whole, and it is discarded on reset.

create table if not exists longku_sweep (
  owner_email text        primary key,
  chains      jsonb       not null default '[]'::jsonb,
  updated     timestamptz not null default now()
);
