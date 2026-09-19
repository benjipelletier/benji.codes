"use client";

import { useState } from "react";
import { AddChengyu } from "./AddChengyu";
import { ThemeToggle } from "./ThemeToggle";
import { signOut } from "@longku/lib/auth-client";
import type { State } from "@longku/lib/store";
import type { BankStats } from "@longku/lib/chains";

export type View = "wall" | "graph" | "learn" | "words";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "wall", label: "wall" },
  { id: "graph", label: "graph" },
  { id: "learn", label: "learn" },
  { id: "words", label: "words" },
];

interface Props {
  state: State;
  onChange: (s: State) => void;
  stats: BankStats;
  view: View;
  onView: (v: View) => void;
  onOpenStats: () => void;
  /** Spectator view — the add field is hidden rather than shown and ignored. */
  readOnly?: boolean;
  /** Signed-in owner's address. Present only when writes will persist. */
  ownerEmail?: string | null;
}

/**
 * The single band that replaced the old masthead, five stat cards and pill row.
 * Figures here are a summary and a button — the full picture lives in the
 * stats sheet rather than pushing the wall down the page.
 *
 * On a phone the rail is the difference between a playable app and a scrolling
 * one: four stacked rows of chrome left the wall a 140px window. So the add
 * field is folded behind a button there (the wall and the chain game are what
 * you open the app for; adding is occasional), and the rest is ordered by CSS
 * into two rows. Everything stays in the DOM — only its arrangement changes.
 */
export function Rail({
  state,
  onChange,
  stats,
  view,
  onView,
  onOpenStats,
  readOnly = false,
  ownerEmail = null,
}: Props) {
  // Only consulted on narrow screens, where the add field is collapsed. On a
  // wide rail the toggle is hidden and the field is always shown.
  const [addOpen, setAddOpen] = useState(false);

  return (
    <header className="longku-rail">
      <h1 className="longku-title">
        龙库
        <span className="latin">longku</span>
      </h1>

      <button
        type="button"
        className="longku-figures"
        onClick={onOpenStats}
        title="Coverage, tiers and the full figures"
      >
        <span className="longku-figure">
          <span className="longku-figure-n">{stats.total}</span>
          <span className="longku-figure-label">words</span>
        </span>
        <span className="longku-figure">
          <span className="longku-figure-n">{stats.chains}</span>
          <span className="longku-figure-label">chains</span>
        </span>
      </button>

      {readOnly ? (
        <span className="longku-rail-spacer" />
      ) : (
        <>
          <button
            type="button"
            className="longku-icon-btn longku-rail-addbtn"
            onClick={() => setAddOpen((o) => !o)}
            aria-expanded={addOpen}
            aria-controls="longku-add-panel"
            title={addOpen ? "Hide the add field" : "Add a chengyu"}
            aria-label={addOpen ? "Hide the add field" : "Add a chengyu"}
          >
            {addOpen ? "✕" : "+"}
          </button>
          <div
            id="longku-add-panel"
            className={`longku-rail-add ${addOpen ? "is-open" : ""}`}
          >
            <AddChengyu state={state} onChange={onChange} autoFocus={addOpen} />
          </div>
        </>
      )}

      <div className="longku-rail-right">
        <div className="longku-switch" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              className={view === v.id ? "is-active" : ""}
              onClick={() => onView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <ThemeToggle />
        {ownerEmail && (
          <button
            type="button"
            className="longku-icon-btn"
            onClick={signOut}
            title={`Signed in as ${ownerEmail} — sign out`}
            aria-label={`Signed in as ${ownerEmail}. Sign out.`}
          >
            ⏻
          </button>
        )}
        <a className="longku-home" href="/" aria-label="Back to benji.codes">
          <span aria-hidden>←</span>
          <span className="longku-home-label">benji.codes</span>
        </a>
      </div>
    </header>
  );
}
