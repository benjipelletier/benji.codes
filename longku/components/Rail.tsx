"use client";

import { AddChengyu } from "./AddChengyu";
import { ThemeToggle } from "./ThemeToggle";
import { signOut } from "@longku/lib/auth-client";
import type { State } from "@longku/lib/store";
import type { BankStats } from "@longku/lib/chains";

export type View = "wall" | "graph";

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
        <AddChengyu state={state} onChange={onChange} />
      )}

      <div className="longku-rail-right">
        <div className="longku-switch" role="tablist" aria-label="View">
          <button
            role="tab"
            aria-selected={view === "wall"}
            className={view === "wall" ? "is-active" : ""}
            onClick={() => onView("wall")}
          >
            wall
          </button>
          <button
            role="tab"
            aria-selected={view === "graph"}
            className={view === "graph" ? "is-active" : ""}
            onClick={() => onView("graph")}
          >
            graph
          </button>
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
        <a className="longku-home" href="/">← benji.codes</a>
      </div>
    </header>
  );
}
