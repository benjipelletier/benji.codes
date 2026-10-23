"use client";

// Words to revive (app/api/chongfuxi/rescue.ts): a word whose latest result
// was wrong, in a category by its pattern (lib/revive.ts), gets an AI rescue
// aimed at that, made from everything known about it, to get it out of
// "forgotten land" (the owner's words). Four parts: one button on Today with
// the count (the list there was clutter, the owner found); the list, full
// screen, by category, with a story using them all and a speed round
// through them all; a word's memory kit, in the owner's order (a hook, its
// characters' real etymology, sentences with it and one of one's own, the
// words it is told apart from: the owner found quizzes added little and the
// hook helped most); and the hook on the backs of its cards, until
// RESCUE_CLEAR Goods in a row.

import { useCallback, useEffect, useRef, useState } from "react";
import type { KitNewWord, Rescue as RescueData, RescueChar, StuckStory, StuckWord } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { RESCUE_CLEAR } from "@chongfuxi/lib/review";
import { CATEGORIES } from "@chongfuxi/lib/revive";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { Highlighted, Loading, fmt, message, useBackLayer, type Shell } from "./shared";

const STATE: Record<StuckWord["rescue"], string> = { none: "Make kit", ready: "Kit ready", done: "Kit ready", stale: "Missed again" };
const NEW_STATE: Record<KitNewWord["kit"], string> = { none: "Make kit", done: "Kit ready", stale: "Make kit" };
const FORMATION: Record<RescueChar["formation"], string> = {
  pictograph: "Pictograph",
  ideograph: "Ideograph",
  "compound ideograph": "Compound ideograph",
  "phono-semantic": "Meaning + sound",
  borrowing: "Borrowed",
  other: "",
};
const ROLE: Record<RescueChar["parts"][number]["role"], string> = { meaning: "meaning", sound: "sound", form: "shape" };

/** Memory kits' words: the stuck ones and the new ones on the Learn ladder, loaded once per mount. */
function useKits(): { stuck: StuckWord[]; fresh: KitNewWord[] } | null {
  const [kits, setKits] = useState<{ stuck: StuckWord[]; fresh: KitNewWord[] } | null>(null);
  useEffect(() => {
    get<{ words: StuckWord[]; fresh?: KitNewWord[] }>("rescue")
      .then((r) => setKits({ stuck: r.words, fresh: r.fresh ?? [] }))
      .catch(() => setKits({ stuck: [], fresh: [] }));
  }, []);
  return kits;
}

/**
 * On Today: one Memory kits button with how many new and stuck words there
 * are, opening their list (the owner reframed Words to revive to take in new
 * words too). Nothing when there are none.
 */
export function StuckWords({ onOpen }: { onOpen: () => void }) {
  const kits = useKits();
  const total = kits ? kits.stuck.length + kits.fresh.length : 0;
  if (!kits || !total) return null;
  const parts = [kits.fresh.length && `${fmt(kits.fresh.length)} new`, kits.stuck.length && `${fmt(kits.stuck.length)} stuck`].filter(Boolean);
  return (
    <button className="cf-stuck" onClick={onOpen}>
      <span className="cf-stuck-text">
        <b>Memory kits</b>
        <small>{parts.join(" · ")}</small>
      </span>
      <span className="cf-stuck-count">{fmt(total)}</span>
      <i aria-hidden="true">›</i>
    </button>
  );
}

/** The stuck words, full screen; a word opens its rescue over the list, and back comes to it. */
export function StuckList({ shell, onEnd }: { shell: Shell; onEnd: () => void }) {
  // A word's rescue, or the story with them all, over the list.
  const [open, setOpen] = useState<string | null>(null);
  const [story, setStory] = useState(false);
  const [speed, setSpeed] = useState(false);
  // Loaded again each time a rescue closes, so states are fresh.
  const [loads, setLoads] = useState(0);
  const close = useCallback(() => {
    setOpen(null);
    setStory(false);
    setSpeed(false);
    setLoads((n) => n + 1);
  }, []);
  useBackLayer(open !== null || story || speed, close);
  if (open) return <Rescue canWrite={shell.canWrite} word={open} onEnd={close} />;
  if (story) return <StoryView shell={shell} onEnd={close} />;
  if (speed) return <SpeedRound onEnd={close} />;
  return <StuckRows key={loads} onOpen={setOpen} onStory={() => setStory(true)} onSpeed={() => setSpeed(true)} onEnd={onEnd} />;
}

/** A paragraph with the stuck words in it marked, each opening its page. */
function Marked({ zh, words }: { zh: string; words: string[] }) {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  if (!sorted.length) return <>{zh}</>;
  const parts = zh.split(new RegExp(`(${sorted.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`));
  return (
    <>
      {parts.map((p, i) =>
        words.includes(p) ? (
          <button key={i} className="cf-story-w" onClick={() => wordpage.openWordPage(p)}>
            {p}
          </button>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Two paragraphs the model wrote with every stuck word in them; the English under each, on a tap. */
function StoryView({ shell, onEnd }: { shell: Shell; onEnd: () => void }) {
  const { canWrite } = shell;
  const [story, setStory] = useState<StuckStory | null>(null);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [english, setEnglish] = useState<Set<number>>(new Set());
  const make = async () => {
    setMaking(true);
    setError(null);
    try {
      setStory((await send<{ story: StuckStory }>("rescue", { story: true })).story);
      setEnglish(new Set());
    } catch (e) {
      setError(message(e));
    } finally {
      setMaking(false);
    }
  };
  // The one written, or, for the owner, one written now (once: React runs this twice in development).
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    get<{ story: StuckStory | null }>("rescue", { story: 1 })
      .then((r) => {
        if (r.story) setStory(r.story);
        else if (canWrite) void make();
      })
      .catch((e) => setError(message(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cf-rescue">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the list">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">A story with them</p>
      </div>
      <div className="cf-rescue-in">
        {error && <p className="cf-error">{error}</p>}
        {making && <Loading label="Writing a story with every one of them…" />}
        {!story && !making && !error && !canWrite && <p className="cf-muted">No story has been written yet.</p>}
        {story && !making && (
          <>
            {story.title && <h1 className="cf-story-title cf-zh">{story.title}</h1>}
            {story.paragraphs.map((p, i) => (
              <div key={i} className="cf-story-p">
                <p className="cf-zh">
                  <Marked zh={p.zh} words={story.words} />
                </p>
                {english.has(i) ? (
                  <p className="cf-muted cf-story-en">{p.en}</p>
                ) : (
                  <button className="cf-link cf-story-show" onClick={() => setEnglish(new Set([...english, i]))}>
                    Show English
                  </button>
                )}
              </div>
            ))}
            {story.missing.length > 0 && (
              <p className="cf-muted cf-story-note">Left out: {story.missing.join("、")}</p>
            )}
            {story.stale && <p className="cf-muted cf-story-note">Your stuck words have changed since this was written.</p>}
            {canWrite && (
              <div className="cf-buttons cf-rescue-go">
                <button className={`cf-btn${story.stale ? "" : " cf-btn-ghost"}`} onClick={() => void make()}>
                  Write a new one
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StuckRows({
  onOpen,
  onStory,
  onSpeed,
  onEnd,
}: {
  onOpen: (word: string) => void;
  onStory: () => void;
  onSpeed: () => void;
  onEnd: () => void;
}) {
  const kits = useKits();
  const words = kits?.stuck ?? null;
  const total = kits ? kits.stuck.length + kits.fresh.length : 0;
  return (
    <div className="cf-rescue">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to Today">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">Memory kits{kits ? ` · ${fmt(total)}` : ""}</p>
      </div>
      <div className="cf-rescue-in">
        {!kits && <Loading label="Finding them…" />}
        {kits && !total && <p className="cf-muted">No new or stuck words right now.</p>}
        {kits && total > 0 && (
          <>
            <button className="cf-stuck cf-story-btn cf-speed-btn" onClick={onSpeed}>
              <span className="cf-stuck-text">
                <b>Speed round</b>
                <small>Flip through all {fmt(total)} fast, saying each out loud</small>
              </span>
              <i aria-hidden="true">›</i>
            </button>
            <button className="cf-stuck cf-story-btn" onClick={onStory}>
              <span className="cf-stuck-text">
                <b>A story with them</b>
                <small>Two paragraphs using every one, written by AI</small>
              </span>
              <i aria-hidden="true">›</i>
            </button>
            {kits.fresh.length > 0 && (
              <section className="cf-revive-group">
                <h3 className="cf-revive-h">
                  New words <span>{fmt(kits.fresh.length)}</span>
                </h3>
                <p className="cf-muted cf-stuck-about">On the Learn ladder now: a kit to meet each one with.</p>
                <ul className="cf-stuck-list">
                  {kits.fresh.map((w) => (
                    <li key={w.word}>
                      <button onClick={() => onOpen(w.word)}>
                        <span className="cf-stuck-zh cf-zh">{w.word}</span>
                        <span className="cf-stuck-body">
                          {w.pinyin && <span className="cf-stuck-py">{displayPinyin(w.pinyin)}</span>}
                          {w.gloss && <span className="cf-stuck-gloss">{w.gloss}</span>}
                          <span className="cf-stuck-why">{w.step ? "Learning it" : "Not met yet"}</span>
                        </span>
                        <span className={`cf-stuck-state is-${w.kit === "done" ? "done" : "none"}`}>{NEW_STATE[w.kit]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {words!.length > 0 && <h2 className="cf-kits-h">Stuck words</h2>}
            {CATEGORIES.map((c) => {
              const these = words!.filter((w) => w.category === c.key);
              if (!these.length) return null;
              return (
                <section key={c.key} className="cf-revive-group">
                  <h3 className="cf-revive-h">
                    {c.label} <span>{fmt(these.length)}</span>
                  </h3>
                  <p className="cf-muted cf-stuck-about">{c.about}</p>
                  <ul className="cf-stuck-list">
                    {these.map((w) => (
                      <li key={w.word}>
                        <button onClick={() => onOpen(w.word)}>
                          <span className="cf-stuck-zh cf-zh">{w.word}</span>
                          <span className="cf-stuck-body">
                            {w.pinyin && <span className="cf-stuck-py">{displayPinyin(w.pinyin)}</span>}
                            {w.gloss && <span className="cf-stuck-gloss">{w.gloss}</span>}
                            <span className="cf-stuck-why">{w.why}</span>
                          </span>
                          <span className={`cf-stuck-state is-${w.rescue}`}>{STATE[w.rescue]}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

/** On a rescued word's card back, until it is got right RESCUE_CLEAR times in a row. */
export function RescueHook({ hook }: { hook: string }) {
  return (
    <p className="cf-rescue-hook is-card">
      <span className="cf-rescue-hook-label">
        Hook <span className="cf-ai-pill">AI</span>
      </span>
      {hook}
    </p>
  );
}

/** A word's rescue, full screen: why it slips, the handles to pick from, a sentence of one's own, its confusions. */
export function Rescue({ canWrite, word, onEnd }: { canWrite: boolean; word: string; onEnd: () => void }) {
  const [r, setR] = useState<RescueData | null>(null);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [own, setOwn] = useState("");
  const [checking, setChecking] = useState(false);

  const make = async (fresh: boolean) => {
    setMaking(true);
    setError(null);
    try {
      setR((await send<{ rescue: RescueData }>("rescue", { word, fresh })).rescue);
    } catch (e) {
      setError(message(e));
    } finally {
      setMaking(false);
    }
  };

  // The rescue made already, or, for the owner, one made now (it costs a model call, so only when
  // opened, and once: React runs this twice in development).
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (asked.current === word) return;
    asked.current = word;
    get<{ rescue: RescueData | null }>("rescue", { w: word })
      .then((got) => {
        // One of an older shape (a quiz) is made again for the owner.
        if (got.rescue && !(got.rescue.outdated && canWrite)) setR(got.rescue);
        else if (canWrite) void make(false);
      })
      .catch((e) => setError(message(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word]);

  const check = async () => {
    if (!own.trim()) return;
    setChecking(true);
    setError(null);
    try {
      setR((await send<{ rescue: RescueData }>("rescue", { word, own })).rescue);
      setOwn("");
    } catch (e) {
      setError(message(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="cf-rescue">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the list">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">Memory kit</p>
      </div>

      <div className="cf-rescue-in">
        {error && <p className="cf-error">{error}</p>}
        {making && <Loading label="Going through everything about it… this can take a minute." />}
        {!r && !making && !error && !canWrite && <p className="cf-muted">No memory kit has been made for {word} yet.</p>}
        {!r && !making && !error && canWrite && <Loading label="Opening…" />}

        {r && !making && (
          <>
            <header className="cf-rescue-head">
              <button className="cf-rescue-word cf-zh" onClick={() => wordpage.openWordPage(r.word)}>
                {r.word}
              </button>
              {r.pinyin && <p className="cf-rescue-py">{displayPinyin(r.pinyin)}</p>}
              {r.gloss && <p className="cf-rescue-gloss">{r.gloss}</p>}
            </header>

            {r.stale && (
              <div className="cf-rescue-stale">
                <p>Forgotten again since this was made.</p>
                {canWrite && (
                  <button className="cf-btn cf-btn-ghost" onClick={() => void make(true)}>
                    Make it again
                  </button>
                )}
              </div>
            )}

            <section>
              <h3 className="cf-rescue-h">Hook</h3>
              <p className="cf-rescue-hook is-kit">{r.hook}</p>
              <p className="cf-rescue-note">On its cards until you get it right {RESCUE_CLEAR} times in a row.</p>
            </section>

            {r.characters.length > 0 && (
              <section>
                <h3 className="cf-rescue-h">Characters</h3>
                <ul className="cf-rescue-chars">
                  {r.characters.map((c, i) => (
                    <li key={i}>
                      <div className="cf-rescue-char-head">
                        <span className="cf-zh cf-rescue-char">{c.char}</span>
                        {c.traditional.length > 0 && (
                          <span className="cf-zh cf-rescue-trad" title="Traditional">
                            {c.traditional.join(" ")}
                          </span>
                        )}
                        <span className="cf-rescue-char-means">
                          {c.pinyin && <b>{displayPinyin(c.pinyin)}</b>} {c.meaning}
                        </span>
                        {FORMATION[c.formation] && <span className="cf-rescue-form">{FORMATION[c.formation]}</span>}
                      </div>
                      {c.parts.length > 0 && (
                        <ul className="cf-rescue-parts">
                          {c.parts.map((p, k) => (
                            <li key={k}>
                              <span className="cf-zh">{p.part}</span>
                              <span className={`cf-rescue-role is-${p.role}`}>{ROLE[p.role]}</span>
                              <span>{p.meaning}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="cf-rescue-origin">{c.origin}</p>
                    </li>
                  ))}
                </ul>
                {r.together && <p className="cf-rescue-together">{r.together}</p>}
              </section>
            )}

            <section>
              <h3 className="cf-rescue-h">Sentences</h3>
              <ul className="cf-rescue-sents">
                {r.sentences.map((x, i) => (
                  <li key={i}>
                    <p className="cf-zh cf-rescue-sent-zh">
                      <Highlighted text={x.zh} word={r.word} />
                    </p>
                    {x.en && <p className="cf-muted">{x.en}</p>}
                    {(x.note || x.id === null) && (
                      <p className="cf-rescue-note">
                        {x.id === null && <span className="cf-rescue-new">New</span>} {x.note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {/* Making it one's own: a sentence about one's life, checked by the model. */}
              {r.own && (
                <div className="cf-rescue-own">
                  <p className="cf-zh cf-rescue-own-zh">
                    <Highlighted text={r.own.fixed} word={r.word} />
                  </p>
                  {r.own.en && <p className="cf-muted">{r.own.en}</p>}
                  <p className={`cf-rescue-verdict${r.own.ok ? " is-right" : " is-wrong"}`}>
                    {r.own.ok ? "Good." : `You wrote ${r.own.zh}`} {r.own.note}
                  </p>
                </div>
              )}
              {canWrite && (
                <form
                  className="cf-rescue-type"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void check();
                  }}
                >
                  <input
                    lang="zh"
                    value={own}
                    onChange={(e) => setOwn(e.target.value)}
                    placeholder={r.own ? "Another of your own" : `Your own, with ${r.word}`}
                    aria-label="Your own sentence"
                    disabled={checking}
                  />
                  <button className="cf-btn" type="submit" disabled={checking || !own.trim()}>
                    {checking ? "…" : "Check"}
                  </button>
                </form>
              )}
            </section>

            {r.contrasts.length > 0 && (
              <section>
                <h3 className="cf-rescue-h">Contrast</h3>
                <ul className="cf-rescue-conf">
                  {r.contrasts.map((c) => (
                    <li key={c.zh}>
                      <div className="cf-rescue-conf-head">
                        <button className="cf-lk-wchip" onClick={() => wordpage.openWordPage(c.zh)}>
                          <span className="cf-zh">{c.zh}</span> ›
                        </button>
                        {c.pinyin && <span className="cf-rescue-cpy">{c.pinyin}</span>}
                      </div>
                      <p>{c.difference}</p>
                      {c.pair && (
                        <div className="cf-rescue-pair">
                          <p>
                            <span className="cf-zh">
                              <Highlighted text={c.pair.mine.zh} word={r.word} />
                            </span>
                            {c.pair.mine.en && <span className="cf-muted"> {c.pair.mine.en}</span>}
                          </p>
                          <p>
                            <span className="cf-zh">
                              <Highlighted text={c.pair.theirs.zh} word={c.zh} />
                            </span>
                            {c.pair.theirs.en && <span className="cf-muted"> {c.pair.theirs.en}</span>}
                          </p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="cf-rescue-from">
              From {fmt(r.evidence.missed)} {r.evidence.missed === 1 ? "miss" : "misses"}, {fmt(r.evidence.tripped)} tripped{" "}
              {r.evidence.tripped === 1 ? "sentence" : "sentences"}, {fmt(r.evidence.notes)} {r.evidence.notes === 1 ? "note" : "notes"},{" "}
              {fmt(r.evidence.lookups)} {r.evidence.lookups === 1 ? "lookup" : "lookups"}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** How long a card shows before its answer turns over by itself, in ms. */
const SPEED_REVEAL_MS = 2000;
/** Right this many times in a row, a word is done for the round. */
const SPEED_DONE = 2;
/** A missed word comes back this many cards later. */
const SPEED_BACK = 3;

/** The word said by the phone's own Chinese voice, after the owner has said it. */
function say(word: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "zh-CN";
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("zh"));
    if (voice) u.voice = voice;
    u.rate = 0.9;
    synth.speak(u);
  } catch {
    // No voice: the round goes on silently.
  }
}

type SpeedCard = { word: string; pinyin: string | null; gloss: string | null; hook: string | null };

/**
 * Every word to revive, flipped fast: the word, said out loud by the owner,
 * then after a moment (or a tap) its reading, meaning and hook, and the
 * phone's voice saying it. Got it or Missed, by button or swipe; a miss comes
 * back a few cards on, and the round ends when each word is got right twice
 * in a row. Touches no schedule: extra exposure, not a review.
 */
function SpeedRound({ onEnd }: { onEnd: () => void }) {
  const [cards, setCards] = useState<SpeedCard[] | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [streak, setStreak] = useState<Record<string, number>>({});
  const [shown, setShown] = useState(false);
  const [flips, setFlips] = useState(0);
  const [started] = useState(() => Date.now());
  const [drag, setDrag] = useState<{ x0: number; dx: number } | null>(null);
  useEffect(() => {
    get<{ words: SpeedCard[] }>("rescue", { speed: 1 })
      .then((r) => {
        setCards(r.words);
        setQueue(r.words.map((w) => w.word).sort(() => Math.random() - 0.5));
      })
      .catch(() => setCards([]));
  }, []);

  const current = queue[0] ? cards?.find((c) => c.word === queue[0]) ?? null : null;
  const reveal = useCallback(() => {
    if (!current) return;
    setShown((was) => {
      if (!was) say(current.word);
      return true;
    });
  }, [current]);
  // It turns over by itself after a moment: say it before it does.
  useEffect(() => {
    if (!current || shown) return;
    const t = window.setTimeout(reveal, SPEED_REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [current, shown, reveal]);

  const answer = useCallback(
    (got: boolean) => {
      if (!current || !shown) return;
      const n = got ? (streak[current.word] ?? 0) + 1 : 0;
      setStreak((s) => ({ ...s, [current.word]: n }));
      setFlips((f) => f + 1);
      setQueue((q) => {
        const rest = q.slice(1);
        if (got && n >= SPEED_DONE) return rest;
        // Missed: back soon. Got once: back at the end, to be got again.
        const at = got ? rest.length : Math.min(SPEED_BACK, rest.length);
        return [...rest.slice(0, at), current.word, ...rest.slice(at)];
      });
      setShown(false);
    },
    [current, shown, streak],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") reveal();
      if (e.key === "ArrowRight") answer(true);
      if (e.key === "ArrowLeft") answer(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [reveal, answer]);

  const total = cards?.length ?? 0;
  const done = cards ? cards.filter((c) => (streak[c.word] ?? 0) >= SPEED_DONE).length : 0;
  return (
    <div className="cf-rescue cf-speed">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Leave the speed round">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">
          Speed round · {fmt(done)} of {fmt(total)} done
        </p>
      </div>
      {!cards && <Loading label="Shuffling them…" />}
      {cards && !cards.length && <p className="cf-muted cf-rescue-in">Nothing needs reviving.</p>}
      {cards && cards.length > 0 && !current && (
        <div className="cf-rescue-in cf-speed-end">
          <p className="cf-rescue-score">All {fmt(total)} twice in a row</p>
          <p className="cf-muted">
            {fmt(flips)} flips in {fmt(Math.max(1, Math.round((Date.now() - started) / 60000)))} min. A second round later today helps them stick.
          </p>
          <div className="cf-buttons">
            <button className="cf-btn" onClick={onEnd}>
              Back to the list
            </button>
          </div>
        </div>
      )}
      {current && (
        <div className="cf-speed-stage">
          <div
            className={`cf-speed-card${shown ? " is-shown" : ""}`}
            style={drag ? { transform: `translateX(${drag.dx}px) rotate(${drag.dx / 30}deg)` } : undefined}
            onClick={() => !shown && reveal()}
            onPointerDown={(e) => shown && setDrag({ x0: e.clientX, dx: 0 })}
            onPointerMove={(e) => drag && setDrag({ ...drag, dx: e.clientX - drag.x0 })}
            onPointerUp={() => {
              if (drag && Math.abs(drag.dx) > 80) answer(drag.dx > 0);
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
            role="button"
            aria-label={shown ? `${current.word}: swipe right if you had it, left if not` : "Say it, then tap to see"}
          >
            <p className="cf-speed-word cf-zh">{current.word}</p>
            {!shown && <p className="cf-muted cf-speed-say">Say it out loud</p>}
            {shown && (
              <>
                {current.pinyin && <p className="cf-speed-py">{displayPinyin(current.pinyin)}</p>}
                {current.gloss && <p className="cf-speed-gloss">{current.gloss}</p>}
                {current.hook && <p className="cf-speed-hook">{current.hook}</p>}
                <button
                  className="cf-link cf-speed-again"
                  onClick={(e) => {
                    e.stopPropagation();
                    say(current.word);
                  }}
                >
                  Hear it again
                </button>
              </>
            )}
          </div>
          <div className="cf-speed-answers">
            <button className="cf-answer-btn cf-answer-forgot" disabled={!shown} onClick={() => answer(false)}>
              ← Missed
            </button>
            <button className="cf-answer-btn cf-answer-show" disabled={!shown} onClick={() => answer(true)}>
              Had it →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
