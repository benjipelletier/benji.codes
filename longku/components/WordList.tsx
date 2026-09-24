"use client";

import { useMemo, useState } from "react";
import { removeWord, type BankEntry, type State } from "@longku/lib/store";
import { TierPill } from "./AddChengyu";
import { DueHeatmap } from "./DueHeatmap";
import { daysOverdue, daysUntilDue, dueAt } from "@longku/lib/srs";

interface Props {
  state: State;
  onChange: (s: State) => void;
  onPickSyllable: (syl: string) => void;
  readOnly?: boolean;
}

interface Row extends BankEntry {
  dueMs: number;
  /** Whole days until due; 0 when due now. */
  inDays: number;
  /** Whole days past due. */
  late: number;
  /** Bank words that could lead into this one — they end where it starts. */
  into: number;
  /** Bank words this one could lead to — they start where it ends. */
  onward: number;
}

type SortKey = "due" | "strength" | "recalls" | "misses" | "links" | "added" | "word";

const COLUMNS: Array<{ key: SortKey; label: string; hint: string }> = [
  { key: "word", label: "chengyu", hint: "alphabetical by pinyin" },
  { key: "due", label: "due", hint: "when the chain game next asks for it" },
  { key: "links", label: "links", hint: "words that lead in, and words it leads to" },
  { key: "recalls", label: "recalls", hint: "times produced in play" },
  { key: "misses", label: "misses", hint: "times available under a prompt and not produced" },
  { key: "added", label: "added", hint: "when it entered the bank" },
  { key: "strength", label: "strength", hint: "how well it's known, from evidence" },
];

/**
 * Every word, ranked.
 *
 * A bank grows past the point where the syllable wall can tell you anything
 * about individual words, and the thing you want then is an ordering: what is
 * weakest, what is isolated, what has never come up. Defaults to weakest first,
 * because that is the list worth acting on.
 *
 * "Links" is how connected a word is — how many of your other words end where
 * it starts, and how many start where it ends. A word with none of either can
 * only ever be a chain of one, which is what keeps the chain count high.
 */
export function WordList({ state, onChange, onPickSyllable, readOnly = false }: Props) {
  // Soonest due first: what the game will ask for next is the list to act on.
  const [sort, setSort] = useState<SortKey>("due");
  const [desc, setDesc] = useState(false);
  const [q, setQ] = useState("");
  const [dueOnly, setDueOnly] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const bank = Object.values(state.bank);
    const endsOn = new Map<string, number>();
    const startsAt = new Map<string, number>();
    for (const e of bank) {
      if (e.ls) endsOn.set(e.ls, (endsOn.get(e.ls) ?? 0) + 1);
      startsAt.set(e.fs, (startsAt.get(e.fs) ?? 0) + 1);
    }
    const now = Date.now();
    return bank.map((e) => {
      // A word doesn't count as its own predecessor or successor.
      const into = (endsOn.get(e.fs) ?? 0) - (e.ls === e.fs ? 1 : 0);
      const onward = e.ls ? (startsAt.get(e.ls) ?? 0) - (e.fs === e.ls ? 1 : 0) : 0;
      return {
        ...e,
        into: Math.max(0, into),
        onward: Math.max(0, onward),
        dueMs: dueAt(e),
        inDays: daysUntilDue(e, now),
        late: daysOverdue(e, now),
      };
    });
  }, [state]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (!dueOnly || r.inDays === 0) &&
        (!needle ||
          r.w.includes(needle) ||
          r.fs.startsWith(needle) ||
          (r.ls ?? "").startsWith(needle)),
    );
    const dir = desc ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      switch (sort) {
        case "word":
          return dir * a.fs.localeCompare(b.fs);
        case "due":
          // Weakest first within a day, so a day's list leads with its hardest.
          return dir * (a.dueMs - b.dueMs) || (a.strength ?? 0) - (b.strength ?? 0);
        case "links":
          return dir * (a.into + a.onward - (b.into + b.onward));
        case "recalls":
          return dir * (a.recalls - b.recalls);
        case "misses":
          return dir * ((a.misses ?? 0) - (b.misses ?? 0));
        case "added":
          return dir * (a.added - b.added);
        default:
          return dir * ((a.strength ?? 0) - (b.strength ?? 0));
      }
    });
    return sorted;
  }, [rows, sort, desc, q, dueOnly]);

  const isolated = rows.filter((r) => r.into === 0 && r.onward === 0).length;
  const dueNow = rows.filter((r) => r.inDays === 0).length;

  if (rows.length === 0) {
    return <p className="longku-wall-empty">Nothing banked yet.</p>;
  }

  return (
    <section className="longku-words" aria-label="Every word">
      <DueHeatmap state={state} />

      <div className="longku-words-head">
        <button
          type="button"
          className={`longku-words-due-toggle ${dueOnly ? "is-on" : ""}`}
          onClick={() => setDueOnly((d) => !d)}
          aria-pressed={dueOnly}
          title={dueOnly ? "Show every word" : "Show only the words due now"}
        >
          <b>{dueNow}</b> due now
        </button>
        <input
          className="longku-input longku-words-filter"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter by characters or syllable"
          aria-label="Filter words"
          spellCheck={false}
        />
        <span className="longku-hint">
          {shown.length} of {rows.length}
          {isolated > 0 && (
            <>
              {" · "}
              <strong className="longku-words-isolated">{isolated} isolated</strong>
              {" — nothing joins them, so each is a chain of one"}
            </>
          )}
        </span>
      </div>

      <div className="longku-words-table" role="table">
        <div className="longku-words-row is-head" role="row">
          {COLUMNS.map((c) => (
            <button
              key={c.key}
              role="columnheader"
              className={`longku-words-th col-${c.key} ${sort === c.key ? "is-sorted" : ""}`}
              title={c.hint}
              onClick={() => {
                if (sort === c.key) setDesc((d) => !d);
                else {
                  setSort(c.key);
                  // Strength and due read weakest- and soonest-first; the
                  // counting columns read largest-first, which is what you
                  // want to see of each.
                  setDesc(c.key !== "strength" && c.key !== "word" && c.key !== "due");
                }
              }}
            >
              {c.label}
              {sort === c.key && <span aria-hidden>{desc ? " ↓" : " ↑"}</span>}
            </button>
          ))}
          <span className="longku-words-th col-drop" />
        </div>

        {shown.map((r) => (
          <div className="longku-words-row" role="row" key={r.w}>
            <div className="longku-words-td col-word">
              <span className="longku-words-w">{r.w}</span>
              <TierPill f={r.f} offCorpus={r.offCorpus} />
            </div>

            <div
              className={`longku-words-td col-due ${r.inDays === 0 ? "is-due" : ""}`}
              title={new Date(r.dueMs).toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            >
              {dueLabel(r.inDays, r.late)}
            </div>

            <div className="longku-words-td col-links">
              <button
                className="longku-words-syl"
                onClick={() => onPickSyllable(r.fs)}
                title={`${r.into} of your words end on ${r.fs}`}
              >
                {r.into} → {r.fs}
              </button>
              <button
                className="longku-words-syl"
                onClick={() => r.ls && onPickSyllable(r.ls)}
                title={
                  r.ls
                    ? `${r.onward} of your words start with ${r.ls}`
                    : "no ending syllable — it can only close a chain"
                }
              >
                {r.ls ?? "?"} → {r.onward}
              </button>
            </div>

            <div className="longku-words-td col-recalls">{r.recalls}</div>
            <div className={`longku-words-td col-misses ${(r.misses ?? 0) > 0 ? "is-miss" : ""}`}>
              {r.misses ?? 0}
            </div>
            <div className="longku-words-td col-added">{since(r.lastSeen, r.added)}</div>

            <div className="longku-words-td col-strength">
              <span className="longku-words-pct">
                {Math.round((r.strength ?? 0) * 100)}%
              </span>
              <span className="longku-strength" aria-hidden>
                <span
                  className="longku-strength-fill"
                  style={{ width: `${Math.round((r.strength ?? 0) * 100)}%` }}
                />
              </span>
            </div>

            <div className="longku-words-td col-drop">
              {!readOnly && (
                <button
                  className="longku-bucket-drop"
                  onClick={() => onChange(removeWord(r.w))}
                  title={`Remove ${r.w}`}
                  aria-label={`Remove ${r.w}`}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function dueLabel(inDays: number, late: number): string {
  if (inDays === 0) return late > 0 ? `due · ${late}d late` : "due";
  if (inDays === 1) return "tomorrow";
  return `in ${inDays}d`;
}

/** Last time it came up, falling back to when it was banked. */
function since(lastSeen: number | undefined, added: number): string {
  const ms = lastSeen ?? added;
  const days = (Date.now() - ms) / 86_400_000;
  if (days < 1) return lastSeen ? "today" : "added today";
  if (days < 30) return `${Math.round(days)}d`;
  return `${Math.round(days / 30)}mo`;
}
