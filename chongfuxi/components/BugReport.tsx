"use client";

// Filing a bug from any screen: a small tab on the right edge (the owner's
// only), always on top. Tapping it draws the screen as it is, then asks what
// went wrong. The report goes to the database with what the app knew, for a
// Claude session to pull in (scripts/bugs.ts) and fix.

import { useCallback, useEffect, useRef, useState } from "react";
import * as bugs from "@chongfuxi/lib/bugs";
import { get, send } from "@chongfuxi/lib/client";
import type { BugContext, BugReport, BugStatus } from "@chongfuxi/lib/api";
import { message, useBackLayer } from "./shared";

export function BugButton({ screen }: { screen: string }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ shot: string | null; context: BugContext } | null>(null);
  useEffect(() => bugs.listen(), []);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    // What was on screen, before the sheet covers it.
    const context = bugs.context(screen);
    const shot = await bugs.screenshot();
    setBusy(false);
    setDraft({ shot, context });
  };

  return (
    <>
      <button className={`cf-bug-tab${busy ? " is-busy" : ""}`} data-bug-skip onClick={() => void start()} aria-label="Report a bug">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M8 6.5a4 4 0 0 1 8 0M7 10h10v4.5a5 5 0 0 1-10 0zM12 10v9.5M3.5 9.5 7 11M20.5 9.5 17 11M3 15h4M21 15h-4M4 20l3.5-2.5M20 20l-3.5-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {draft && <BugSheet draft={draft} onDone={() => setDraft(null)} />}
    </>
  );
}

function BugSheet({ draft, onDone }: { draft: { shot: string | null; context: BugContext }; onDone: () => void }) {
  const [text, setText] = useState("");
  const [shot, setShot] = useState(draft.shot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  useBackLayer(true, onDone);

  const file = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ id: number }>("bugs", { text, context: draft.context, image: shot });
      setFiled(r.id);
      window.setTimeout(onDone, 1400);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cf-arrival-back" data-bug-skip onClick={onDone}>
      <div className="cf-arrival cf-bug" role="dialog" aria-modal="true" aria-labelledby="cf-bug-title" onClick={(e) => e.stopPropagation()}>
        {filed !== null ? (
          <p className="cf-bug-filed">
            <b>Filed as bug #{filed}.</b> A Claude session can pull it in with <code>scripts/bugs.ts</code>.
          </p>
        ) : (
          <>
            <h2 id="cf-bug-title" className="cf-arrival-title">
              Report a bug
            </h2>
            <p className="cf-muted cf-bug-where">
              From {draft.context.screen}
              {draft.context.errors.length > 0 &&
                `, with ${draft.context.errors.length} recent ${draft.context.errors.length === 1 ? "error" : "errors"}`}
            </p>
            <textarea
              className="cf-bug-text"
              placeholder="What went wrong? What did you expect?"
              value={text}
              autoFocus
              rows={3}
              onChange={(e) => setText(e.target.value)}
            />
            {shot ? (
              <figure className="cf-bug-shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot} alt="The screen it was filed from" />
                <figcaption>
                  <button className="cf-link" onClick={() => picker.current?.click()}>
                    Use a phone screenshot instead
                  </button>
                  <button className="cf-link" onClick={() => setShot(null)}>
                    Leave it out
                  </button>
                </figcaption>
              </figure>
            ) : (
              <p className="cf-muted">
                No screenshot.{" "}
                <button className="cf-link" onClick={() => picker.current?.click()}>
                  Attach one
                </button>
              </p>
            )}
            <input
              ref={picker}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setShot((await bugs.fromFile(f)) ?? shot);
              }}
            />
            {error && <p className="cf-error">{error}</p>}
            <div className="cf-arrival-actions">
              <button className="cf-answer-btn cf-answer-ghost" disabled={busy} onClick={onDone}>
                Cancel
              </button>
              <button className="cf-answer-btn cf-answer-good" disabled={busy || (!text.trim() && !shot)} onClick={() => void file()}>
                {busy ? "Filing…" : "File it"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The bugs filed, on the Import page: open ones first, each closable with a tap. */
export function BugList({ canWrite }: { canWrite: boolean }) {
  const [list, setList] = useState<BugReport[] | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    get<{ bugs: BugReport[] }>("bugs", { all: all ? 1 : undefined })
      .then((r) => setList(r.bugs))
      .catch((e) => setError(message(e)));
  }, [all]);
  useEffect(load, [load]);

  const mark = async (id: number, status: BugStatus) => {
    try {
      await send(`bugs/${id}`, { status });
      load();
    } catch (e) {
      setError(message(e));
    }
  };

  if (!list || (!list.length && !all)) return null;
  return (
    <section className="cf-section">
      <h2 className="cf-h2">Bug reports</h2>
      <p className="cf-muted">
        Filed with the bug tab on the right edge. A Claude session pulls them in with <code>chongfuxi/scripts/bugs.ts</code>.
      </p>
      {error && <p className="cf-error">{error}</p>}
      <ul className="cf-bugs">
        {list.map((b) => (
          <li key={b.id} className={`is-${b.status}`}>
            {b.hasImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/chongfuxi/bugs/${b.id}?image=1`} alt="" loading="lazy" />
            )}
            <div>
              <p className="cf-bug-head">
                <b>#{b.id}</b> {new Date(b.at).toLocaleString()} · {b.context.screen}
                {b.status !== "open" && <span className="cf-tag">{b.status === "fixed" ? "fixed" : "won't fix"}</span>}
              </p>
              <p>{b.text || <i className="cf-muted">No words, just the screenshot.</i>}</p>
              {b.note && <p className="cf-muted">{b.note}</p>}
              {canWrite && (
                <p className="cf-bug-acts">
                  {b.status === "open" ? (
                    <>
                      <button className="cf-link" onClick={() => void mark(b.id, "fixed")}>
                        Mark fixed
                      </button>
                      <button className="cf-link" onClick={() => void mark(b.id, "wontfix")}>
                        Won&apos;t fix
                      </button>
                    </>
                  ) : (
                    <button className="cf-link" onClick={() => void mark(b.id, "open")}>
                      Open again
                    </button>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <button className="cf-more" onClick={() => setAll(!all)}>
        {all ? "Only the open ones" : "Show closed ones too"}
      </button>
    </section>
  );
}
