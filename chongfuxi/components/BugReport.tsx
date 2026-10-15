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
  const [draft, setDraft] = useState<{ context: BugContext; shot: Promise<string | null> } | null>(null);
  useEffect(() => bugs.listen(), []);

  // The sheet opens at once to be typed in; the screen is drawn behind it
  // meanwhile (the sheet is left out of the drawing).
  const start = () => {
    if (draft) return;
    setDraft({ context: bugs.context(screen), shot: bugs.screenshot() });
  };

  return (
    <>
      <button className="cf-bug-tab" data-bug-skip hidden={draft !== null} onClick={start} aria-label="Report a bug">
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

/** What went wrong, in the owner's words; a screenshot of the screen comes along unless left out. */
function BugSheet({ draft, onDone }: { draft: { context: BugContext; shot: Promise<string | null> }; onDone: () => void }) {
  const [text, setText] = useState("");
  // Undefined while the screen is still being drawn.
  const [shot, setShot] = useState<string | null | undefined>(undefined);
  const [include, setInclude] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useBackLayer(true, onDone);

  useEffect(() => {
    let live = true;
    // Focus (and the phone's keyboard) waits for the drawing, or a moment at
    // most, so the keyboard doesn't squeeze the screen being drawn.
    const later = window.setTimeout(() => box.current?.focus(), 2500);
    void draft.shot.then((s) => {
      if (!live) return;
      setShot((now) => (now === undefined ? s : now));
      window.clearTimeout(later);
      box.current?.focus();
    });
    return () => {
      live = false;
      window.clearTimeout(later);
    };
  }, [draft.shot]);

  const file = async () => {
    setBusy(true);
    setError(null);
    try {
      const image = include && shot ? shot : null;
      const r = await send<{ id: number }>("bugs", { text: text.trim(), context: draft.context, image });
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
              What went wrong?
            </h2>
            <p className="cf-muted cf-bug-where">
              From {draft.context.screen}
              {draft.context.errors.length > 0 &&
                `, with ${draft.context.errors.length} recent ${draft.context.errors.length === 1 ? "error" : "errors"}`}
              . What the app was showing comes along by itself.
            </p>
            <textarea
              ref={box}
              className="cf-bug-text"
              placeholder="What happened, and what you expected instead"
              value={text}
              rows={4}
              onChange={(e) => setText(e.target.value)}
            />

            {/* The screenshot: optional, small, there to drop. */}
            <div className={`cf-bug-shot${include && shot ? "" : " is-off"}`}>
              <label className="cf-bug-include">
                <input type="checkbox" checked={include && shot !== null} disabled={!shot} onChange={(e) => setInclude(e.target.checked)} />
                <i className="cf-tick" />
                <span>
                  {shot === undefined
                    ? "Taking a screenshot of this screen…"
                    : shot === null
                      ? "No screenshot of this screen"
                      : "Include a screenshot of this screen"}
                  <button type="button" className="cf-link" onClick={() => picker.current?.click()}>
                    {shot ? "Use one from the phone" : "Attach one from the phone"}
                  </button>
                </span>
              </label>
              {shot && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shot} alt="The screen it was filed from" />
              )}
            </div>
            <input
              ref={picker}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                const s = f ? await bugs.fromFile(f) : null;
                if (s) {
                  setShot(s);
                  setInclude(true);
                }
              }}
            />
            {error && <p className="cf-error">{error}</p>}
            <div className="cf-arrival-actions">
              <button className="cf-answer-btn cf-answer-ghost" disabled={busy} onClick={onDone}>
                Cancel
              </button>
              <button className="cf-answer-btn cf-answer-good" disabled={busy || !text.trim()} onClick={() => void file()}>
                {busy ? "Filing…" : "File it"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The bugs filed, on the Import page's Bugs side: open ones first, each closable with a tap. */
export function BugList({ canWrite, onCount }: { canWrite: boolean; onCount?: (open: number) => void }) {
  const [list, setList] = useState<BugReport[] | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counted = useRef(onCount);
  counted.current = onCount;
  const load = useCallback(() => {
    get<{ bugs: BugReport[] }>("bugs", { all: all ? 1 : undefined })
      .then((r) => {
        setList(r.bugs);
        counted.current?.(r.bugs.filter((b) => b.status === "open").length);
      })
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

  return (
    <section className="cf-section">
      <h2 className="cf-h2">Bug reports</h2>
      <p className="cf-muted">
        Filed with the bug tab on the right edge. A Claude session pulls them in with <code>chongfuxi/scripts/bugs.ts</code>.
      </p>
      {error && <p className="cf-error">{error}</p>}
      {list === null && !error && <p className="cf-muted">Loading…</p>}
      {list?.length === 0 && <p className="cf-muted">{all ? "No bugs filed yet." : "No open bugs."}</p>}
      {list && list.length > 0 && (
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
      )}
      <button className="cf-more" onClick={() => setAll(!all)}>
        {all ? "Only the open ones" : "Show closed ones too"}
      </button>
    </section>
  );
}
