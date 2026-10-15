-- Words the owner removed from 龙库 that are still chengyu in their 重复习 deck.
--
-- 龙库 now lives in 重复习's database, and every deck chengyu belongs to it
-- (app/api/chongfuxi/longku.ts). Removing one in 龙库 only unlinks it; this is
-- what keeps it from being linked straight back. Adding it again in 龙库
-- clears the row.

create table if not exists longku_excluded (
  owner_email text        not null,
  w           text        not null,
  at          timestamptz not null default now(),
  primary key (owner_email, w)
);
