#!/usr/bin/env python3
"""Derive two artifacts from CC-CEDICT: missing idioms, and a reading table.

Source: CC-CEDICT, https://www.mdbg.net/chinese/dictionary?page=cc-cedict
        CC BY-SA 4.0. Only headwords and their readings are taken — no English
        definitions — so what ships is a word list and a pronunciation table.

Solves two problems.

The corpus came from one dictionary and lacked entries that plainly belong:
重色轻友 among them. CC-CEDICT tags idioms explicitly, which separates them
from the four-character compounds that would otherwise flood the list —
有限公司, 马来西亚 and 高速公路 are all four Han characters and none is an idiom.

And readings were being guessed. The old guesser took a majority vote over the
first character, so 重色轻友 was filed under chong (61 corpus entries read 重 as
chóng) when it is zhòng — as every 重X轻Y idiom is. CC-CEDICT states the reading
outright, which removes the guess for any word it knows.

Usage:
    curl -sL -o cedict.txt.gz \\
      https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz
    gunzip cedict.txt.gz
    python3 longku/scripts/build-cedict.py cedict.txt
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
IDIOMS_OUT = ROOT / "data" / "cedict-idioms.txt"
READINGS_OUT = ROOT / "data" / "readings.txt"

LINE = re.compile(r"^(\S+) (\S+) \[([^\]]*)\] /(.*)/$")
HAN_ONLY = re.compile(r"^[一-鿿]+$")
# Longer idioms are written with a comma in CC-CEDICT (不入虎穴，焉得虎子) but
# typed without one, so headwords are matched on their characters alone.
PUNCT = re.compile(r"[，,。、；;：:！!？?\s]")


def syllables(pinyin: str) -> list[str]:
    """CC-CEDICT pinyin ("zhong4 se4 qing1 you3") to toneless syllables."""
    out = []
    for tok in pinyin.split():
        s = re.sub(r"\d+$", "", tok).lower().replace("u:", "v")
        if s and s.isascii() and s.isalpha():
            out.append(s)
    return out


def main(path: str) -> None:
    idioms: dict[str, list[str]] = {}
    readings: dict[str, list[str]] = {}

    for line in pathlib.Path(path).read_text(encoding="utf8").splitlines():
        if line.startswith("#"):
            continue
        m = LINE.match(line)
        if not m:
            continue
        _, simp, pinyin, gloss = m.groups()
        word = PUNCT.sub("", simp)
        if not HAN_ONLY.match(word):
            continue
        syls = syllables(pinyin)
        if len(syls) != len(word):
            continue  # reading and characters disagree; can't chain it safely

        # Readings for anything idiom-shaped, used when a word isn't in the
        # corpus. Bounded to the lengths the resolver treats as a plausible
        # chengyu, which keeps the shipped table to the words that can be
        # looked up rather than the whole dictionary.
        if 3 <= len(word) <= 9:
            readings.setdefault(word, syls)
        if "(idiom" in gloss:
            idioms.setdefault(word, syls)

    IDIOMS_OUT.write_text(
        "".join(f"{w}\t{' '.join(s)}\n" for w, s in sorted(idioms.items())),
        encoding="utf8",
    )
    # Only the first and last syllable matter for chaining, so the table stores
    # those rather than the full reading.
    READINGS_OUT.write_text(
        "".join(f"{w}\t{s[0]}\t{s[-1]}\n" for w, s in sorted(readings.items())),
        encoding="utf8",
    )
    print(f"  idioms   -> {IDIOMS_OUT.name}: {len(idioms):,}")
    print(f"  readings -> {READINGS_OUT.name}: {len(readings):,}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: build-cedict.py <path to cedict.txt>")
    main(sys.argv[1])
