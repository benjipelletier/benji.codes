"use client";

// What new words unlocked (app/api/chongfuxi/milestones.ts): a list all in
// the deck, an episode ready to watch. On Today a sheet rises with those not
// yet seen, once, the words that reached each a tap from their pages; the
// New words sheet lists them all. The owner's only.

import { useCallback, useEffect, useState } from "react";
import type { Milestone } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Sheet, fmt, type Shell } from "./shared";

const share = (x: number) => `${Math.floor(x * 1000) / 10}%`;

/** One milestone: what it is, what it took, and the words that reached it. */
export function MilestoneRow({ m }: { m: Milestone }) {
  const d = m.detail;
  const words = d.words ?? [];
  return (
    <li className={`cf-ms is-${m.kind}`}>
      <span className="cf-ms-icon" aria-hidden="true">
        {m.kind === "list" ? "✓" : "▶"}
      </span>
      <span className="cf-ms-body">
        <b className="cf-zh">{m.title}</b>
        <small>
          {m.kind === "list"
            ? `${d.list?.split("/").slice(0, -1).join(" › ") || "A list"} · all ${fmt(d.total ?? 0)} words in your deck`
            : `${d.before != null ? `${share(d.before)} → ` : ""}${share(d.after ?? 0)} of its words known`}
        </small>
        {words.length > 0 && (
          <span className="cf-ms-words">
            <span>{m.kind === "list" ? "Finished by" : "With"}</span>
            {words.map((w) => (
              <button key={w} className="cf-ms-word cf-zh" onClick={() => wordpage.openWordPage(w)}>
                {w}
              </button>
            ))}
          </span>
        )}
      </span>
    </li>
  );
}

/** The milestones, newest first, for the New words sheet. */
export function MilestoneList() {
  const [list, setList] = useState<Milestone[] | null>(null);
  useEffect(() => {
    get<{ milestones: Milestone[] }>("milestones")
      .then((r) => setList(r.milestones))
      .catch(() => setList([]));
  }, []);
  if (!list?.length) return null;
  return (
    <section className="cf-ms-history">
      <h3 className="cf-h3">What your words unlocked</h3>
      <ul className="cf-ms-list">
        {list.map((m) => (
          <MilestoneRow key={m.id} m={m} />
        ))}
      </ul>
    </section>
  );
}

/**
 * On Today: the milestones not yet seen, in a sheet that rises once (fetched
 * again whenever the counts move, as an addition anywhere moves them).
 * Closing it marks them seen.
 */
export function MilestoneSheet({ shell }: { shell: Shell }) {
  const [fresh, setFresh] = useState<Milestone[]>([]);
  const load = useCallback(() => {
    get<{ milestones: Milestone[] }>("milestones", { unseen: 1 })
      .then((r) => setFresh(r.milestones))
      .catch(() => setFresh([]));
  }, []);
  useEffect(() => {
    if (shell.canWrite) load();
  }, [load, shell.canWrite, shell.summary]);
  if (!shell.canWrite || !fresh.length) return null;
  const close = () => {
    const ids = fresh.map((m) => m.id);
    setFresh([]);
    void send("milestones", { seen: ids }).catch(() => undefined);
  };
  return (
    <Sheet label="What your new words unlocked" onClose={close}>
      <p className="cf-ms-kicker">Unlocked</p>
      <h2 className="cf-choice-h">{fresh.length === 1 ? "Your new words reached a milestone" : `Your new words reached ${fmt(fresh.length)} milestones`}</h2>
      <ul className="cf-ms-list">
        {fresh.map((m) => (
          <MilestoneRow key={m.id} m={m} />
        ))}
      </ul>
      <button className="cf-btn cf-ms-ok" onClick={close}>
        Nice
      </button>
    </Sheet>
  );
}
