"use client";

// What a batch of new words brought: the deck's size, sentences unlocked, new
// cards, each word with its pinyin, meaning and HSK levels, and a few of the
// sentences now readable. Shown on a sync's page (SyncPage).

import type { Addition } from "@chongfuxi/lib/api";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { Highlighted, fmt } from "./shared";

export function AdditionDetails({ addition }: { addition: Addition }) {
  const a = addition;
  const n = a.words.length;
  return (
    <>
      <dl className="cf-arrival-stats">
        <div>
          <dt>Words in the deck</dt>
          <dd>{fmt(a.deck)}</dd>
        </div>
        <div className={a.unlocked ? "is-up" : undefined}>
          <dt>Sentences unlocked</dt>
          <dd>{a.unlocked ? `+${fmt(a.unlocked)}` : "0"}</dd>
        </div>
        <div>
          <dt>New Read cards</dt>
          <dd>{fmt(n)}</dd>
        </div>
      </dl>

      <ul className="cf-arrival-words">
        {a.words.map((w) => (
          <li key={w.word}>
            <span className="cf-arrival-zh">{w.word}</span>
            <span className="cf-arrival-what">
              <span className="cf-arrival-py">{w.pinyin ? displayPinyin(w.pinyin) : "no reading on file"}</span>
              <span className="cf-arrival-gloss">{w.gloss ?? "No definition on file."}</span>
              <span className="cf-arrival-tags">
                {w.hsk.old && <span className={`cf-tag cf-hsk cf-level is-l${w.hsk.old}`}>HSK {w.hsk.old}</span>}
                {w.hsk.v3 && (
                  <span className={`cf-tag cf-hsk cf-level is-l${w.hsk.v3.split("-")[0]}`}>
                    HSK 3.0: {w.hsk.v3.replace("-", "–")}
                  </span>
                )}
                {!w.hsk.old && !w.hsk.v3 && <span className="cf-tag cf-hsk is-none">not HSK</span>}
                {w.was === "listed" && <span className="cf-tag">was on a list</span>}
                {w.was === "name" && <span className="cf-tag">was a name</span>}
                <span className="cf-arrival-in">
                  in {fmt(w.readable)} readable {w.readable === 1 ? "sentence" : "sentences"}
                </span>
              </span>
            </span>
          </li>
        ))}
      </ul>

      {a.examples.length > 0 && (
        <section className="cf-arrival-sentences">
          <h3>Now readable</h3>
          <ul>
            {a.examples.map((s) => (
              <li key={s.zh}>
                <p className="cf-zh">{s.by ? <Highlighted text={s.zh} word={s.by} /> : s.zh}</p>
                {s.en && <p className="cf-en">{s.en}</p>}
              </li>
            ))}
          </ul>
          {a.unlocked > a.examples.length && <p className="cf-muted">and {fmt(a.unlocked - a.examples.length)} more</p>}
        </section>
      )}
    </>
  );
}
