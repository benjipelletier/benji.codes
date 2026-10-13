"use client";

// The machine itself: the state you're looking at, broken down, and every
// event that produced it with what each one did. Any event can be opened to
// see the state as it stood right after it.

import type { Counts } from "@chongfuxi/lib/machine";
import type { LoggedEvent } from "@chongfuxi/lib/store";
import { EffectChips, type AppApi } from "./shared";

const fmt = (n: number) => n.toLocaleString("en-US");

function describe(l: LoggedEvent): string {
  const e = l.event;
  switch (e.kind) {
    case "import":
      return `Imported ${e.fileName}`;
    case "settings":
      return "Changed what the categories mean";
    case "mark":
      return `Marked ${e.word} as ${e.as === "name" ? "a name" : "known"}`;
    case "unmark":
      return `Unmarked ${e.word}`;
  }
}

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function StateTable({ counts, stats }: { counts: Counts; stats: Record<string, number> | null }) {
  const rows: Array<[string, number, string?]> = [
    ["Known words", counts.knownWords],
    ["· from a known category", counts.knownByCategory, "sub"],
    ["· from a Pleco score", counts.knownByScore, "sub"],
    ["· marked known here", counts.markedKnown, "sub"],
    ["· marked as names", counts.names, "sub"],
    ["Sentences", counts.texts],
    ["· readable", counts.unlocked, "sub"],
    ["· one word away", counts.oneAway, "sub"],
    ["· locked", counts.locked, "sub"],
    ["· already studied in Pleco", counts.studied, "sub"],
  ];
  if (stats) {
    rows.push(
      ["Pleco cards read", stats.cards],
      ["· word cards", stats.wordCards, "sub"],
      ["· sentence cards", stats.textCards, "sub"],
      ["· duplicate sentences merged", stats.duplicateTexts, "sub"],
      ["· split by dictionary (pinyin didn't fit)", stats.dictionarySplit, "sub"],
    );
  }
  return (
    <table className="cf-table">
      <tbody>
        {rows.map(([label, n, kind]) => (
          <tr key={label} className={kind === "sub" ? "cf-sub" : undefined}>
            <th scope="row">{label}</th>
            <td>{fmt(n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LogPanel({
  api,
  log,
  viewSeq,
  onView,
}: {
  api: AppApi;
  log: LoggedEvent[];
  viewSeq: number | null;
  onView: (seq: number | null) => void;
}) {
  const { derived, corpus } = api.state;
  const latest = log[log.length - 1]?.seq ?? null;

  return (
    <div className="cf-panel">
      <section className="cf-section">
        <h2 className="cf-h2">{viewSeq === null ? "State now" : `State after event ${viewSeq}`}</h2>
        {derived ? (
          <StateTable counts={derived.counts} stats={corpus ? (corpus.stats as unknown as Record<string, number>) : null} />
        ) : (
          <p className="cf-muted">Empty — nothing has happened yet.</p>
        )}
      </section>

      <section className="cf-section">
        <h2 className="cf-h2">Events</h2>
        <p className="cf-lede">
          Everything the state above is made of, newest first. Each line shows what that event changed when it
          happened; open one to see the state right after it.
        </p>
        <ol className="cf-timeline">
          {[...log].reverse().map((l) => {
            const viewing = viewSeq === l.seq || (viewSeq === null && l.seq === latest);
            return (
              <li key={l.seq} className={`cf-event${viewing ? " is-on" : ""}`}>
                <div className="cf-event-head">
                  <span className="cf-event-seq">{l.seq}</span>
                  <span className="cf-event-what">{describe(l)}</span>
                </div>
                <div className="cf-event-meta">
                  <span className="cf-muted">{when(l.event.at)}</span>
                  <EffectChips fx={l.effects} />
                </div>
                {!viewing && (
                  <button className="cf-link" onClick={() => onView(l.seq === latest ? null : l.seq)}>
                    {l.seq === latest ? "Back to now" : "View state after this"}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
