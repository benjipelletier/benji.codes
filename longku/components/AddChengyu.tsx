"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { importWords, type State } from "@longku/lib/store";
import { tierOf, tierSpec } from "@longku/lib/frequency";

interface Hit {
  w: string;
  p: string;
  fs: string;
  ls: string;
  f: number;
  e: string;
  via: "chars" | "pinyin" | "initials";
  /** Rarer spellings of the same idiom, folded into this row. */
  variants?: string[];
}

interface OffCorpus {
  w: string;
  fs: string;
  ls: string | null;
  ambiguous: boolean;
}

interface Props {
  state: State;
  onChange: (s: State) => void;
}

/** Row in the dropdown: either a corpus hit or the off-corpus fallback. */
type Row = { kind: "hit"; hit: Hit } | { kind: "off"; off: OffCorpus };

export function AddChengyu({ state, onChange }: Props) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  /** Set when Enter lands before results arrive; consumed when they do. */
  const pendingEnter = useRef(false);

  // Debounced lookup. A stale-response guard keeps a slow early query from
  // overwriting the results of a later, faster one.
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setRows([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const t = setTimeout(() => {
      fetch(`/api/longku/search?q=${encodeURIComponent(term)}&limit=8`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled || !d) return;
          const next: Row[] = (d.hits ?? []).map((hit: Hit) => ({ kind: "hit" as const, hit }));
          if (d.offCorpus) next.push({ kind: "off", off: d.offCorpus });
          setRows(next);
          setActive(0);
          setOpen(true);
          // Someone hit Enter while this request was still out. Honour it
          // against the top result rather than swallowing the keystroke.
          if (pendingEnter.current) {
            pendingEnter.current = false;
            if (next[0]) choose(next[0]);
          }
        })
        .catch(() => !cancelled && setRows([]))
        .finally(() => !cancelled && setBusy(false));
    }, 130);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  // Close when focus leaves the widget entirely.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const held = useMemo(() => new Set(Object.keys(state.bank)), [state]);

  function choose(row: Row) {
    const word =
      row.kind === "hit"
        ? { w: row.hit.w, fs: row.hit.fs, ls: row.hit.ls, f: row.hit.f }
        : { w: row.off.w, fs: row.off.fs, ls: row.off.ls, offCorpus: true };
    if (held.has(word.w)) return;
    const { state: next } = importWords([word]);
    onChange(next);
    setAdded((a) => [word.w, ...a].slice(0, 8));
    setQ("");
    setRows([]);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (busy || rows.length === 0) && q.trim()) {
      // Results haven't landed yet; remember the intent.
      e.preventDefault();
      pendingEnter.current = true;
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      pendingEnter.current = false;
      return;
    }
    if (!open || rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) choose(row);
    }
  }

  return (
    <section className="longku-add" aria-label="Add a chengyu">
      <div className="longku-add-box" ref={boxRef}>
        <input
          className="longku-input longku-add-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => rows.length > 0 && setOpen(true)}
          placeholder="add a chengyu — characters or pinyin (一心, yixin, yxyy)"
          aria-label="Search for a chengyu to add"
          role="combobox"
          aria-expanded={open}
          aria-controls="longku-add-list"
          autoComplete="off"
          spellCheck={false}
        />
        {busy && <span className="longku-add-spinner" aria-hidden />}

        {open && rows.length > 0 && (
          <ul className="longku-add-list" id="longku-add-list" role="listbox">
            {rows.map((row, i) => {
              if (row.kind === "off") {
                return (
                  <li
                    key="__off"
                    role="option"
                    aria-selected={i === active}
                    className={`longku-add-row is-off ${i === active ? "is-active" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(row);
                    }}
                  >
                    <span className="longku-add-word">{row.off.w}</span>
                    <span className="longku-add-note">
                      not in the corpus — file under{" "}
                      <strong>{row.off.fs}</strong>
                      {row.off.ambiguous && " (reading uncertain)"}
                    </span>
                  </li>
                );
              }
              const h = row.hit;
              const have = held.has(h.w);
              return (
                <li
                  key={h.w}
                  role="option"
                  aria-selected={i === active}
                  className={`longku-add-row ${i === active ? "is-active" : ""} ${have ? "is-held" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(row);
                  }}
                >
                  <span className="longku-add-word">
                    {h.w}
                    {h.variants && h.variants.length > 0 && (
                      <span
                        className="longku-add-variant"
                        title={`also written ${h.variants.join(", ")}`}
                      >
                        ／{h.variants[0]}
                      </span>
                    )}
                  </span>
                  <span className="longku-add-pinyin">{h.p}</span>
                  <span className="longku-add-gloss">{h.e}</span>
                  <span className="longku-add-tail">
                    <TierPill f={h.f} />
                    {have ? "in bank" : `${h.fs} → ${h.ls}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {added.length > 0 && (
        <p className="longku-add-recent">
          added:{" "}
          {added.map((w) => (
            <span className="longku-add-recent-word" key={w}>
              {w}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

/** Small frequency badge. Tiers are cut so each lands on a round share of usage. */
export function TierPill({ f }: { f?: number }) {
  const id = tierOf(f);
  const spec = tierSpec(id);
  return (
    <span className={`longku-pill is-mini tier-${id}`} title={`${spec.label} — ${spec.blurb}`}>
      {spec.label}
    </span>
  );
}
