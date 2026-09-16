import { syllables, bySyllable, entries, commonCounts } from "@longku/lib/data";
import { LongkuApp } from "@longku/components/LongkuApp";
import { tierOf, type TierCount, type TierMass } from "@longku/lib/frequency";

export default function LongkuPage() {
  const sylls = syllables();
  const buckets = bySyllable();
  const all = entries();
  const common = commonCounts();
  const sylSummary = sylls.map((s) => {
    const ids = buckets[s] ?? [];
    return {
      syl: s,
      count: ids.length,
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
    const t = tierOf(e.f);
    tierMass[t] += e.f;
    tierWords[t] += 1;
  }
  return (
    <LongkuApp
      syllables={sylSummary}
      corpusMass={corpusMass}
      tierMass={tierMass}
      tierWords={tierWords}
    />
  );
}
