-- Per-word strength, from evidence only.
--
-- `recalls` counts how often a word was produced, which conflates knowing it
-- with how often it came up: a word starting with a common syllable is prompted
-- far more than one starting with a rare syllable, and accumulates recalls it
-- hasn't earned. It also only ever rises, so there was nowhere to record that a
-- word was available and you couldn't retrieve it.
--
-- strength is an exponential moving average over outcomes, 0 to 1. A recall
-- moves it toward 1, a miss toward 0, and nothing else moves it — no decay with
-- time, so the number always reflects something that actually happened.

alter table longku_bank add column if not exists strength real not null default 0;
alter table longku_bank add column if not exists misses integer not null default 0;
-- When the word was last *available* under a prompt, which is not the same as
-- when it was last recalled — a word can be offered repeatedly and missed.
alter table longku_bank add column if not exists last_seen timestamptz;

-- Seed strength from the recalls already recorded, so existing words aren't
-- reset to "unknown". This is what the moving average would have produced from
-- zero given that many successes.
update longku_bank
set strength = 1 - power(0.6, least(recalls, 12))
where strength = 0 and recalls > 0;
