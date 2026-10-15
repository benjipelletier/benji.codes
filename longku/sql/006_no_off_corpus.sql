-- 龙库 holds only words from its idiom list (longku/data/chengyu.json): the
-- notion of an off-corpus word is gone. Words already banked keep their
-- record; one with no frequency counts as rare.

alter table longku_bank drop column if exists off_corpus;
