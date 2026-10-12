#!/usr/bin/env python3
"""Generate longku/data/frequency.txt — how common each chengyu actually is.

Replaces the previous JioNLP list, which had two defects that made the tiers
misleading:

  1. 23,123 of its 30,896 entries carried the value 1, and nothing at all sat
     between 1 and 21. That gap is impossible in a real frequency distribution,
     so 1 was a placeholder for "not counted" rather than a measurement — three
     quarters of the corpus was unmeasured and displayed as rare. 不好意思, one
     of the commonest expressions in spoken Mandarin, sat at 1.

  2. What it did measure was news and official register. Median frequency for
     journalistic set phrases (坚定不移, 实事求是, 因地制宜) ran about twelve
     times that of colloquial ones, so the ranking answered "how often does this
     appear in Chinese newspapers", not "how common is this".

wordfreq blends subtitles, web text, books, news and social media, so spoken
register is represented. Values are stored per billion — an integer, keeping
the downstream `f` field and all the usage-mass arithmetic unchanged.

Each idiom is looked up whole in wordfreq's Chinese list, not passed through
word_frequency(). That function first splits Chinese text with its own
segmenter, whose vocabulary is far smaller than the list's. It broke 31,070
of our ~31,600 idioms apart, estimated each from its pieces, and divided by 10
per break, so a value depended on how an idiom happened to be split rather
than how often it is used:

  画龙点睛  282 in the list, 1 as four characters: core-worthy, filed rare
  卧薪尝胆  794 in the list, 1 as four characters
  文章经济  not in the list at all, 13,800 as 文章 + 经济: filed core

The list stops at about 10 per billion, so an idiom missing from it is rarer
than that, and its split estimate says more about how common its characters
are than about the idiom. Measured idioms run at about 1,100 per doubling of
frequency all the way down to the floor; carried on below it, the ~24,500
unlisted ones come to about 0.7% of all usage, under 1 per billion each. So
they keep the split estimate only as a coarse order, capped at 1 per billion:
0 or 1 once rounded, rare by any cutoff, and together about 0.8% of usage.
Capping at the floor instead would have credited them with 4.4%, most of it
from idioms the segmenter happened to split into common words.

Usage:
    python3 -m venv .venv && .venv/bin/pip install wordfreq jieba
    .venv/bin/python longku/scripts/build-frequency.py
then rerun build-data.mjs to fold the result into chengyu.json.
"""

import json
import pathlib
import sys

try:
    from wordfreq import get_frequency_dict, word_frequency
except ImportError:
    sys.exit("wordfreq is not installed — see the usage note at the top of this file.")

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO = ROOT.parent
DICT = REPO / "riddleyu" / "data" / "idiom.json"
CEDICT_IDIOMS = ROOT / "data" / "cedict-idioms.txt"
OUT = ROOT / "data" / "frequency.txt"

words = []
seen = set()
for entry in json.loads(DICT.read_text(encoding="utf8")):
    w = entry.get("word")
    if w and w not in seen:
        seen.add(w)
        words.append(w)

# The idioms CC-CEDICT contributes need frequencies too, or they would all
# arrive at zero and read as the rarest words in the corpus.
if CEDICT_IDIOMS.exists():
    for line in CEDICT_IDIOMS.read_text(encoding="utf8").splitlines():
        w = line.split("\t")[0]
        if w and w not in seen:
            seen.add(w)
            words.append(w)

LISTED = get_frequency_dict("zh")
# The rarest value the list holds. Anything rarer was left out of it.
FLOOR = min(LISTED.values())
# What an unlisted idiom can be worth at most — see the note at the top.
UNLISTED_CAP = 1e-9

rows = []
listed = 0
for w in words:
    if w in LISTED:
        freq = LISTED[w]
        listed += 1
    else:
        # Below the floor by definition; the split estimate only orders these
        # among themselves.
        freq = min(word_frequency(w, "zh"), UNLISTED_CAP)
    # Per billion: wordfreq returns a proportion, and the rest of the pipeline
    # wants an integer it can sum into usage mass.
    rows.append((w, round(freq * 1e9)))

rows.sort(key=lambda r: (-r[1], r[0]))
OUT.write_text("".join(f"{w}\t{f}\n" for w, f in rows), encoding="utf8")

measured = sum(1 for _, f in rows if f > 0)
print(f"wrote {OUT.relative_to(REPO)}")
print(f"  words          : {len(rows):,}")
print(f"  in the list    : {listed:,} ({100 * listed / len(rows):.0f}%), the rest under {FLOOR * 1e9:.1f}/billion")
print(f"  with a value   : {measured:,} ({100 * measured / len(rows):.0f}%)")
print(f"  top            : {', '.join(w for w, _ in rows[:6])}")
