import { syllables, bySyllable, entries, commonCounts } from "@longku/lib/data";
import { LongkuApp } from "@longku/components/LongkuApp";
import { freqTierOf, type TierCount, type TierMass } from "@longku/lib/frequency";

export default function LongkuPage() {
  const sylls = syllables();
  const buckets = bySyllable();
  const all = entries();
  const common = commonCounts();
  // Corpus words ending on each syllable — every way a chain could arrive —
  // and their usage, for how often a chain actually does.
  const ending: Record<string, number> = {};
  const endingMass: Record<string, number> = {};
  // The commonest of them: the one a game most often lands you on it with.
  const endTop: Record<string, { w: string; f: number }> = {};
  for (const e of all) {
    if (!e.ls) continue;
    ending[e.ls] = (ending[e.ls] ?? 0) + 1;
    endingMass[e.ls] = (endingMass[e.ls] ?? 0) + e.f;
    if (!endTop[e.ls] || e.f > endTop[e.ls].f) endTop[e.ls] = { w: e.w, f: e.f };
  }
  const sylSummary = sylls.map((s) => {
    const ids = buckets[s] ?? [];
    return {
      syl: s,
      count: ids.length,
      ending: ending[s] ?? 0,
      endTop: endTop[s]?.w ?? "",
      common: common[s] ?? 0,
      top: ids[0] !== undefined ? all[ids[0]].w : "",
    };
  });
  // Frequency mass drives usage coverage. Summing 30k numbers here keeps it off
  // the client; the per-tier split gives each progress bar its denominator.
  const tierMass: TierMass = { core: 0, common: 0, uncommon: 0, rare: 0 };
  const tierWords: TierCount = { core: 0, common: 0, uncommon: 0, rare: 0 };
  let corpusMass = 0;
  for (const e of all) {
    corpusMass += e.f;
    const t = freqTierOf(e.f);
    tierMass[t] += e.f;
    tierWords[t] += 1;
  }
  return (
    <LongkuApp
      syllables={sylSummary}
      corpusMass={corpusMass}
      endingMass={endingMass}
      tierMass={tierMass}
      tierWords={tierWords}
    />
  );
}
