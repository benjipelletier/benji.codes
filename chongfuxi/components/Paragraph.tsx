"use client";

// Write it in Chinese (app/api/chongfuxi/paragraph.ts; the owner: "an
// English paragraph using things I'm having trouble with and made me write
// the Chinese for it. It should make sense of course"): the paragraph, the
// parts that call for a trouble word underlined (a tap gives its pinyin as a
// hint), a box to write or say the Chinese, and each try graded: what to fix,
// and whether each trouble word was used. One way to say it, and the words it
// was built around, once tried. Full screen over the Muse tab; owner only.

import { useEffect, useRef, useState } from "react";
import type { Paragraph, ParagraphList, ParagraphTarget, ParagraphTry } from "@chongfuxi/lib/api";
import { get, send } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { recogniser, type Recognition } from "./Reading";
import { markSeen, onSeen, seenAt } from "@chongfuxi/lib/museSeen";
import { Loading, fmt, message } from "./shared";
import { NewBadge } from "./Watch";

const GRADE: Record<ParagraphTry["grade"], string> = { correct: "✓ Correct", almost: "≈ Almost", wrong: "✗ Not yet" };
const USED: Record<ParagraphTry["targets"][number]["used"], string> = { yes: "✓", other: "≈", no: "✗" };
const DRAFT_KEY = "cfx-paragraph-draft-";

const dateOf = (at: number) => new Date(at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** The English with each trouble word's part underlined; a tap shows its pinyin. */
function EnglishWithHints({ p }: { p: Paragraph }) {
  const [hinted, setHinted] = useState<Set<string>>(new Set());
  useEffect(() => setHinted(new Set()), [p.id]);
  const out: Array<string | ParagraphTarget> = [];
  let at = 0;
  for (const t of p.targets) {
    const k = p.en.indexOf(t.en, at);
    if (k < 0) continue;
    out.push(p.en.slice(at, k), t);
    at = k + t.en.length;
  }
  out.push(p.en.slice(at));
  return (
    <p className="cf-para-en">
      {out.map((x, k) =>
        typeof x === "string" ? (
          <span key={k}>{x}</span>
        ) : (
          <button key={k} className={`cf-para-run${hinted.has(x.word) ? " is-hinted" : ""}`} onClick={() => setHinted((h) => new Set(h).add(x.word))} aria-label={`${x.en}: a hint`}>
            {x.en}
            {hinted.has(x.word) && <small>{x.pinyin ? displayPinyin(x.pinyin) : `${[...x.word].length} characters`}</small>}
          </button>
        ),
      )}
    </p>
  );
}

/** Chinese with the trouble words marked, each opening its page. */
function MarkedZh({ zh, words }: { zh: string; words: string[] }) {
  const parts: Array<string | { w: string }> = [];
  let rest = zh;
  while (rest) {
    let best: { at: number; w: string } | null = null;
    for (const w of words) {
      const at = rest.indexOf(w);
      if (at >= 0 && (!best || at < best.at)) best = { at, w };
    }
    if (!best) {
      parts.push(rest);
      break;
    }
    if (best.at) parts.push(rest.slice(0, best.at));
    parts.push({ w: best.w });
    rest = rest.slice(best.at + best.w.length);
  }
  return (
    <>
      {parts.map((x, k) =>
        typeof x === "string" ? (
          <span key={k}>{x}</span>
        ) : (
          <button key={k} className="cf-feed-mark" onClick={() => wordpage.openWordPage(x.w)}>
            {x.w}
          </button>
        ),
      )}
    </>
  );
}

function TryCard({ t, p }: { t: ParagraphTry; p: Paragraph }) {
  return (
    <div className={`cf-read-try is-${t.grade}`}>
      <p className="cf-read-grade">
        <b>{GRADE[t.grade]}</b>
        <span> · {new Date(t.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
      </p>
      <p className="cf-zh cf-read-said">{t.answer}</p>
      {t.fixed && t.fixed !== t.answer && <p className="cf-zh cf-read-fixed">{t.fixed}</p>}
      {t.why && <p className="cf-muted">{t.why}</p>}
      {t.targets.length > 0 && (
        <ul className="cf-para-used" aria-label="Your trouble words">
          {t.targets.map((u) => {
            const target = p.targets.find((x) => x.word === u.word);
            return (
              <li key={u.word} className={`is-${u.used}`}>
                <button onClick={() => wordpage.openWordPage(u.word)}>
                  <i aria-hidden="true">{USED[u.used]}</i>
                  <b className="cf-zh">{u.word}</b>
                  <small>
                    {u.used === "yes" ? "used" : u.said ? `you wrote ${u.said}` : u.used === "other" ? "said another way" : "left out"}
                    {target ? ` · “${target.en}”` : ""}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {t.points.length > 0 && (
        <ul className="cf-para-points">
          {t.points.map((x, k) => (
            <li key={k}>
              <span className="cf-zh">
                {x.wrong && <s>{x.wrong}</s>} → <b>{x.right}</b>
              </span>
              <small>{x.why}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The box to write or say it in, kept as a draft on the device per paragraph. */
function AnswerBox({ p, onTried }: { p: Paragraph; onTried: (p: Paragraph) => void }) {
  const [answer, setAnswerState] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const rec = useRef<Recognition | null>(null);
  useEffect(() => setCanListen(recogniser() !== null), []);
  useEffect(() => () => rec.current?.stop(), []);
  useEffect(() => {
    try {
      setAnswerState(localStorage.getItem(DRAFT_KEY + p.id) ?? "");
    } catch {
      setAnswerState("");
    }
  }, [p.id]);
  const setAnswer = (v: string) => {
    setAnswerState(v);
    try {
      if (v) localStorage.setItem(DRAFT_KEY + p.id, v);
      else localStorage.removeItem(DRAFT_KEY + p.id);
    } catch {
      // Not kept.
    }
  };
  const listen = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = recogniser();
    if (!r) return;
    const before = answer;
    r.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      setAnswer(before + said);
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      if (e.error !== "no-speech" && e.error !== "aborted") setError(`The microphone stopped (${e.error}).`);
    };
    rec.current = r;
    setError(null);
    setListening(true);
    r.start();
  };
  const submit = async () => {
    rec.current?.stop();
    if (!answer.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ paragraph: Paragraph }>("paragraph", { id: p.id, answer: answer.trim() });
      setAnswer("");
      onTried(r.paragraph);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="cf-read-answer cf-para-answer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        lang="zh"
        rows={5}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder={p.tries.length ? "Try it again" : canListen ? "Write it in Chinese, or tap the mic and say it" : "Write it in Chinese"}
        aria-label="Your Chinese"
        disabled={busy}
      />
      <div className="cf-read-actions">
        {canListen && (
          <button type="button" className={`cf-btn cf-btn-ghost cf-read-mic${listening ? " is-on" : ""}`} onClick={listen} disabled={busy}>
            {listening ? "■ Stop" : "🎙 Say it"}
          </button>
        )}
        <button className="cf-btn" type="submit" disabled={busy || !answer.trim()}>
          {busy ? "Checking…" : "Check"}
        </button>
      </div>
      {error && <p className="cf-error">{error}</p>}
    </form>
  );
}

/** The key a paragraph is marked seen by (lib/museSeen.ts). */
const paragraphKey = (p: Paragraph) => `paragraph:${p.id}`;
/** One of Muse's, not opened on this device yet. */
export const isNewParagraph = (p: Paragraph) => p.by === "muse" && !seenAt(paragraphKey(p));

/** The latest paragraph, fetched once while the app is open (for the Muse tab's lead and its dot); null with none, or for anyone but the owner. */
let latestFetch: Promise<Paragraph | null> | null = null;
export function useLatestParagraph(): Paragraph | null | undefined {
  const [latest, setLatest] = useState<Paragraph | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    latestFetch ??= get<ParagraphList>("paragraph")
      .then((r) => r.paragraphs[0] ?? null)
      .catch(() => null);
    latestFetch.then((p) => live && setLatest(p));
    return () => {
      live = false;
    };
  }, []);
  return latest;
}
/** Fetched again next time (after a paragraph is written or tried). */
const forgetLatest = () => {
  latestFetch = null;
};

/**
 * What leads the Muse tab (the owner chose it over Muse's daily page):
 * Write it in Chinese, with the latest paragraph and how it went, or what it
 * is when there is none yet. Owner only.
 */
export function ParagraphLead({ onOpen }: { onOpen: () => void }) {
  const latest = useLatestParagraph();
  const [, redraw] = useState(0);
  useEffect(() => onSeen(() => redraw((n) => n + 1)), []);
  const tried = latest?.tries[0];
  return (
    <button
      className="cf-stuck cf-story-btn cf-drill-btn cf-para-lead"
      onClick={() => {
        if (latest) markSeen(paragraphKey(latest));
        onOpen();
      }}
    >
      <span className="cf-stuck-text">
        <b>
          Write it in Chinese
          {latest && isNewParagraph(latest) && <NewBadge />}
        </b>
        <small>
          {latest
            ? `${latest.title}${latest.by === "muse" ? " · by Muse" : ""} · ${tried ? GRADE[tried.grade] : "not tried yet"}`
            : "An English paragraph around the words you keep getting wrong"}
        </small>
      </span>
      <i aria-hidden="true">›</i>
    </button>
  );
}

/**
 * The screen: the paragraph open (the latest, or one picked from Earlier),
 * New paragraph at the foot. One way to say it and the words behind it show
 * once tried, or on "Show it" for one given up on.
 */
export function ParagraphView({ onEnd }: { onEnd: () => void }) {
  const [list, setList] = useState<Paragraph[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [givenUp, setGivenUp] = useState<Set<number>>(new Set());
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    get<ParagraphList>("paragraph")
      .then((r) => setList(r.paragraphs))
      .catch((e) => setError(message(e)));
  }, []);
  const p = list?.find((x) => x.id === openId) ?? list?.[0] ?? null;
  const put = (q: Paragraph) => setList((l) => [q, ...(l ?? []).filter((x) => x.id !== q.id)].sort((a, b) => b.at - a.at));
  const write = async () => {
    setWriting(true);
    setError(null);
    try {
      const r = await send<{ paragraph: Paragraph }>("paragraph", { new: true });
      put(r.paragraph);
      setOpenId(r.paragraph.id);
      top.current?.scrollTo({ top: 0 });
    } catch (e) {
      setError(message(e));
    } finally {
      setWriting(false);
    }
  };
  const open = (id: number) => {
    setOpenId(id);
    top.current?.scrollTo({ top: 0, behavior: "smooth" });
  };
  useEffect(() => forgetLatest, []);
  useEffect(() => {
    if (p) markSeen(paragraphKey(p));
  }, [p]);
  const shown = p && (p.tries.length > 0 || givenUp.has(p.id));
  const others = (list ?? []).filter((x) => x.id !== p?.id);

  return (
    <div className="cf-rescue">
      <div className="cf-fast-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the list">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-rescue-top">Write it in Chinese</p>
      </div>
      <div className="cf-rescue-in cf-para" ref={top}>
        {error && <p className="cf-error">{error}</p>}
        {!list && !error && <Loading label="Finding your paragraphs…" />}
        {list && !p && !writing && (
          <div className="cf-para-first">
            <p>An English paragraph built around the words you keep getting wrong. Muse writes one each day with its own translation to compare with; write it in Chinese and each try is checked.</p>
            <button className="cf-btn" onClick={() => void write()}>
              Write one now
            </button>
          </div>
        )}
        {writing && <Loading label="Writing a paragraph around your trouble words…" />}
        {p && !writing && (
          <article className="cf-para-card">
            <p className="cf-para-meta">
              {dateOf(p.at)}
              {p.by === "muse" ? " · by Muse" : ""} · {fmt(p.targets.length)} trouble {p.targets.length === 1 ? "word" : "words"}
            </p>
            <h2 className="cf-para-title">{p.title}</h2>
            <EnglishWithHints p={p} />
            <p className="cf-muted cf-para-tip">The underlined parts each call for one of your trouble words. Tap one for a hint.</p>
            <AnswerBox p={p} onTried={put} />
            {p.tries.map((t) => (
              <TryCard key={t.at} t={t} p={p} />
            ))}
            {shown ? (
              <section className="cf-para-ref">
                <h3 className="cf-h3">{p.by === "muse" ? "Muse's translation" : "One way to say it"}</h3>
                {/* What it was aimed at: after a try only, since it names the words. */}
                {p.note && <p className="cf-para-note">{p.note}</p>}
                {p.sentences ? (
                  <ol className="cf-para-compare">
                    {p.sentences.map((x, k) => (
                      <li key={k}>
                        <small className="cf-para-cen">{x.en}</small>
                        <span className="cf-zh cf-para-czh">
                          <MarkedZh zh={x.zh} words={p.targets.map((t) => t.word)} />
                        </span>
                        {x.note && <small className="cf-para-cnote">{x.note}</small>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="cf-zh cf-para-zh">
                    <MarkedZh zh={p.zh} words={p.targets.map((t) => t.word)} />
                  </p>
                )}
                <ul className="cf-para-words">
                  {p.targets.map((t) => (
                    <li key={t.word}>
                      <button onClick={() => wordpage.openWordPage(t.word)}>
                        <b className="cf-zh">{t.word}</b>
                        <span>{t.pinyin ? displayPinyin(t.pinyin) : ""}</span>
                        <small>
                          “{t.en}”{t.gloss ? ` · ${t.gloss}` : ""}
                          <em>{t.why}</em>
                        </small>
                        <i aria-hidden="true">›</i>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <button className="cf-link cf-para-giveup" onClick={() => setGivenUp((g) => new Set(g).add(p.id))}>
                {p.by === "muse" ? "Stuck? Show Muse's translation" : "Stuck? Show one way to say it"}
              </button>
            )}
          </article>
        )}
        {list && (p || writing) && (
          <button className="cf-btn cf-btn-ghost cf-para-new" onClick={() => void write()} disabled={writing}>
            {writing ? "Writing…" : "Write one now"}
          </button>
        )}
        {others.length > 0 && (
          <section className="cf-para-earlier">
            <h3 className="cf-h3">Earlier</h3>
            <ul className="cf-muse-tools">
              {others.map((x) => (
                <li key={x.id}>
                  <button onClick={() => open(x.id)}>
                    <b>
                      {x.title}
                      {isNewParagraph(x) && <NewBadge />}
                    </b>
                    <small>
                      {dateOf(x.at)}
                      {x.by === "muse" ? " · Muse" : ""} · {x.tries.length ? GRADE[x.tries[0].grade] : "not tried"}
                    </small>
                    <i aria-hidden="true">›</i>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
