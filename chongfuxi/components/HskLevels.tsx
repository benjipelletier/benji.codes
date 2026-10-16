"use client";

// The deck against the HSK word lists, on the Stats page: how much of each
// level is in it, by how strong, and which words of a level are still
// missing. A missing word is one tap from Pleco, where words are added.

import { useEffect, useState } from "react";
import type { Coverage, LevelCoverage, MissingWord } from "@chongfuxi/lib/api";
import { get } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { AiPill, fmt, message, plecoHref, type Shell } from "./shared";

const PAGE = 60;
const share = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);

/** Where a word's card stands, lightest to deepest. What is left of the bar is words not in the deck. */
const STAGES = [
  { key: "waiting", label: "Waiting", note: "not answered here yet" },
  { key: "young", label: "Young", note: "under 3 weeks" },
  { key: "mature", label: "Mature", note: "3 weeks to 6 months" },
  { key: "strong", label: "Strong", note: "6 months or more" },
] as const;

function Level({ level }: { level: LevelCoverage }) {
  const missing = level.total - level.inDeck;
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState<MissingWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (offset: number) => {
    get<{ words: MissingWord[] }>("levels", { list: level.list, offset, limit: PAGE })
      .then((r) => setWords((prev) => (offset ? [...(prev ?? []), ...r.words] : r.words)))
      .catch((e) => setError(message(e)));
  };
  useEffect(() => {
    if (open && words === null && missing > 0) load(0);
    // Loaded once, the first time the level is opened.
  }, [open]);

  const pct = share(level.inDeck, level.total);
  // "Level 5" → 5, "Level 7-9" → 7: which of the HSK colours the bar takes.
  const n = level.name.match(/\d/)?.[0] ?? "0";
  return (
    <li className={`cf-level is-l${n}${open ? " is-open" : ""}`}>
      <button className="cf-level-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="cf-level-name">{level.name}</span>
        <span
          className="cf-level-bar"
          role="img"
          aria-label={`${pct}% in the deck: ${STAGES.map((s) => `${level[s.key]} ${s.label.toLowerCase()}`).join(", ")}`}
          title={[...STAGES.map((s) => `${s.label}: ${fmt(level[s.key])}`), `Not in deck: ${fmt(missing)}`].join("\n")}
        >
          {STAGES.map((s) =>
            level[s.key] > 0 ? (
              <i
                key={s.key}
                className={`is-${s.key}`}
                style={{ width: `${(100 * level[s.key]) / level.total}%` }}
                title={`${fmt(level[s.key])} ${s.label.toLowerCase()} (${s.note})`}
              />
            ) : null,
          )}
        </span>
        <span className="cf-level-n">
          <b>{pct}%</b>
          <small>
            {fmt(level.inDeck)} of {fmt(level.total)}
          </small>
        </span>
      </button>
      {open && (
        <div className="cf-level-body">
          {/* The bar in numbers: each stage, and what is left out of the deck. */}
          <dl className="cf-level-split">
            {[
              ...STAGES.map((s) => ({
                key: s.key,
                label: s.label,
                note: s.note,
                n: level[s.key],
              })),
              { key: "missing", label: "Not in deck", note: "", n: missing },
            ].map((s) => (
              <div key={s.key}>
                <dt>
                  <i className={`is-${s.key}`} />
                  {s.label}
                </dt>
                <dd>
                  <b>{fmt(s.n)}</b> {share(s.n, level.total)}%
                </dd>
              </div>
            ))}
          </dl>
          {error && <p className="cf-error">{error}</p>}
          {missing > 0 && words === null && !error && <p className="cf-muted">Finding the missing ones…</p>}
          {words && (
            <>
              <p className="cf-muted">{fmt(missing)} not in the deck yet. Tap one to open it in Pleco.</p>
              <ul className="cf-missing">
                {words.map((w) => (
                  <li key={w.word}>
                    <a href={plecoHref(w.word)}>
                      <span className="cf-word">{w.word}</span>
                      <span className="cf-pinyin">
                        {w.pinyin ? displayPinyin(w.pinyin) : ""}
                        {w.gloss ? ` · ${w.gloss}` : ""}
                        {w.gloss && (
                          <>
                            {" "}
                            <AiPill word={w.word} still />
                          </>
                        )}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              {words.length < missing && (
                <button className="cf-more" onClick={() => load(words.length)}>
                  Show more ({fmt(missing - words.length)} left)
                </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function HskLevels({ shell }: { shell: Shell }) {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    get<Coverage>("levels")
      .then(setCoverage)
      .catch((e) => setError(message(e)));
  }, []);

  if (error) return <p className="cf-error">{error}</p>;
  if (!coverage) return <p className="cf-muted cf-pad">Counting the lists…</p>;

  return (
    <>
      {coverage.groups.map((g) => {
        const total = g.levels.reduce((n, l) => n + l.total, 0);
        const have = g.levels.reduce((n, l) => n + l.inDeck, 0);
        return (
          <section key={g.label} className="cf-section">
            <h2 className="cf-h2">{g.label}</h2>
            <p className="cf-lede">
              {g.note} {share(have, total)}% of it is in {shell.canWrite ? "your" : "the"} deck.
            </p>
            <ul className="cf-levels">
              {g.levels.map((l) => (
                <Level key={l.list} level={l} />
              ))}
            </ul>
            <p className="cf-level-key">
              {STAGES.map((s) => (
                <span key={s.key} title={s.note}>
                  <i className={`is-${s.key}`} />
                  {s.label}
                </span>
              ))}
              <span>
                <i className="is-missing" />
                Not in deck
              </span>
            </p>
          </section>
        );
      })}
      <p className="cf-muted cf-pad">
        {fmt(coverage.deck)} words in the deck. {fmt(coverage.unlisted)} of them are on neither list.
      </p>
    </>
  );
}
