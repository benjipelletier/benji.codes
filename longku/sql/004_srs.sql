-- Spaced repetition: a due date per word, and a log of outcomes by day.
--
-- `due` is null for words not played since this arrived; the client places
-- those from strength and last_recalled (see longku/lib/srs.ts), so there is
-- nothing to backfill here.

alter table longku_bank add column if not exists due timestamptz;

-- One row per outcome in play: recall, hint (recalled from its meaning),
-- shown (played after being revealed), miss (revealed and not played). Kept
-- apart from the bank so removing a word doesn't rewrite what happened on a day.
create table if not exists longku_review (
  owner_email text        not null,
  w           text        not null,
  at          timestamptz not null default now(),
  outcome     text        not null
);

create index if not exists longku_review_owner_at_idx on longku_review (owner_email, at);

-- Seed the history with the one recall per word we already know the date of.
-- Guarded per word so re-running the migrations never duplicates it.
insert into longku_review (owner_email, w, at, outcome)
select b.owner_email, b.w, b.last_recalled, 'recall'
from longku_bank b
where b.last_recalled is not null
  and not exists (
    select 1 from longku_review r where r.owner_email = b.owner_email and r.w = b.w
  );
