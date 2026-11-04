"use client";

// Before you watch (the owner: "a way to review unknown words, hard
// sentences before watching the whole thing… just a quick overview… even
// if I'm not ready for it, I have seen some of the new words before… the
// number of cards to be studied, which will eventually go down to 0 once my
// comprehension is 100%. I don't want these new cards added to my deck").
// Its cards are every word of the episode not known yet and every hard line
// (two or more of them), counted on the Script's strip. A word's Got it
// learns it for this show only (as Watch's walk does without the deck tick:
// `chongfuxi_episode_prepped`), so it reads as being learnt in the episode
// and the lines it was in get easier; a line's Got it is kept
// (`chongfuxi_episode_preview`). Nothing joins the deck or a schedule. The
// in-depth way through a chapter is still the walk.

import { useEffect, useMemo, useState } from "react";
import type { EpisodeView as Episode } from "@chongfuxi/lib/api";
import { send, today } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { fmt, message } from "./shared";
import { BlurbCard, EnglishLine, LineClip, clock } from "./Watch";

/** Unknown words a line needs to count as hard (the server's HARD_NEW). */
const HARD_NEW = 2;
/** Cards a round takes; "Keep going" takes the next. */
export const PREVIEW_ROUND = 20;
/** A card put off with Not yet comes back this many cards later. */
const AGAIN_BACK = 3;
/** Words before each line in a round. */
const WORDS_PER_LINE = 3;

type WordCard = { kind: "word"; key: string; word: string; i: number; count: number; must: boolean };
type LineCard = { kind: "line"; key: string; i: number; words: string[] };
type Card = WordCard | LineCard;

/** The words of a line not known yet (prepped for the show reads as learning, names as known). */
const unknownIn = (ep: Episode, i: number) => [...new Set(ep.lines[i].tokens.filter((t) => t.k === "unknown").map((t) => t.t))];

/**
 * Every card still to look at: each word not known yet (Muse's must-knows
 * first, then the most said, then the first said) and each hard line not
 * looked over, in story order.
 */
export function previewCards(ep: Episode): { words: WordCard[]; lines: LineCard[] } {
  const seen = new Map<string, WordCard>();
  ep.lines.forEach((l, i) =>
    l.tokens.forEach((t) => {
      if (t.k !== "unknown") return;
      const w = seen.get(t.t);
      if (w) w.count++;
      else seen.set(t.t, { kind: "word", key: `w:${t.t}`, word: t.t, i, count: 1, must: false });
    }),
  );
  for (const w of ep.words) if (w.tier === "must" && seen.has(w.word)) seen.get(w.word)!.must = true;
  const words = [...seen.values()].sort((a, b) => Number(b.must) - Number(a.must) || b.count - a.count || a.i - b.i);
  const done = new Set(ep.previewed ?? []);
  const lines: LineCard[] = ep.lines.flatMap((_, i) => {
    const words = unknownIn(ep, i);
    return words.length >= HARD_NEW && !done.has(i) ? [{ kind: "line" as const, key: `l:${i}`, i, words }] : [];
  });
  return { words, lines };
}

/** How many cards are left: what the strip shows. */
export const previewLeft = (ep: Episode) => {
  const c = previewCards(ep);
  return c.words.length + c.lines.length;
};

/** A round: up to PREVIEW_ROUND cards, a hard line after every WORDS_PER_LINE words. */
function roundOf(words: WordCard[], lines: LineCard[]): Card[] {
  const out: Card[] = [];
  let w = 0;
  let l = 0;
  while (out.length < PREVIEW_ROUND && (w < words.length || l < lines.length)) {
    for (let k = 0; k < WORDS_PER_LINE && w < words.length && out.length < PREVIEW_ROUND; k++) out.push(words[w++]);
    if (l < lines.length && out.length < PREVIEW_ROUND) out.push(lines[l++]);
  }
  return out;
}

/** A line with the words not known yet underlined. */
function MarkedLine({ zh, words }: { zh: string; words: string[] }) {
  const parts: Array<string | { w: string }> = [];
  let rest = zh;
  while (rest) {
    let best: { at: number; w: string } | null = null;
    for (const w of words) {
      const at = rest.indexOf(w);
      if (at >= 0 && (!best || at < best.at || (at === best.at && w.length > best.w.length))) best = { at, w };
    }
    if (!best) {
      parts.push(rest);
      break;
    }
    if (best.at) parts.push(rest.slice(0, best.at));
    parts.push({ w: best.w });
    rest = rest.slice(best.at + best.w.length);
  }
  return <>{parts.map((x, k) => (typeof x === "string" ? <span key={k}>{x}</span> : <u key={k} className="cf-pv-new">{x.w}</u>))}</>;
}

/** A word with its reading and meaning, opening its page, and + Deck to add it. */
function WordRow({ ep, word, added, busy, onAdd }: { ep: Episode; word: string; added: boolean; busy: boolean; onAdd: () => void }) {
  const look = ep.looks[word];
  return (
    <li>
      <button className="cf-pv-wordpage" onClick={() => wordpage.openWordPage(word)}>
        <b className="cf-zh">{word}</b>
        {look?.p && <span>{displayPinyin(look.p)}</span>}
        {look?.gloss && <small>{look.gloss}</small>}
      </button>
      {added ? (
        <span className="cf-pv-added">✓ In deck</span>
      ) : (
        <button className="cf-link cf-pv-add" disabled={busy} onClick={onAdd} aria-label={`Add ${word} to your deck`}>
          {busy ? "…" : "+ Deck"}
        </button>
      )}
    </li>
  );
}

/** What adding a line said: its tags, and whether it reads now or what keeps it locked. */
type Saved = { readable: boolean; blockers: string[]; sources: string[] } | true;

/**
 * The quick pass, full screen over the episode: a round of cards, each
 * shown, then Not yet (back three cards on) or Got it. A word shows alone,
 * then its reading, meaning and the first line it is said in, heard from
 * the video; a hard line plays first, then shows its English, Muse's note
 * and its new words. Got it on a word learns it for the show; a line still
 * hard when it comes up is shown, one that isn't any more is passed. Any
 * word can go into the deck instead (+ Add to deck, + Deck), which also
 * makes it known here, and any line into the sentences (+ Add sentence),
 * tagged with the show and the episode.
 */
export function Preview({ ep, onEnd }: { ep: Episode; onEnd: () => void }) {
  const start = useMemo(() => previewCards(ep), [ep]);
  const [round, setRound] = useState<Card[]>(() => roundOf(start.words, start.lines));
  const [queue, setQueue] = useState<string[]>(() => round.map((c) => c.key));
  const [got, setGot] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Added from here: words into the deck, lines into the sentences (those already there come with the episode).
  const [inDeck, setInDeck] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Map<number, Saved>>(() => new Map((ep.saved ?? []).map((i) => [i, true as const])));
  const [busy, setBusy] = useState<string | null>(null);
  const byKey = useMemo(() => new Map(round.map((c) => [c.key, c])), [round]);
  const gotWords = useMemo(() => new Set([...got].filter((k) => k.startsWith("w:")).map((k) => k.slice(2))), [got]);
  // A line is still hard while two of its words aren't known or got here.
  const stillHard = (c: LineCard) => c.words.filter((w) => !gotWords.has(w)).length >= HARD_NEW;
  const left =
    start.words.filter((w) => !got.has(w.key)).length + start.lines.filter((l) => !got.has(l.key) && stillHard(l)).length;
  // The card up: the first in the queue, lines no longer hard passed by.
  const upKey = queue.find((k) => {
    const c = byKey.get(k)!;
    return c.kind === "word" || stillHard(c);
  });
  const card = upKey ? byKey.get(upKey)! : null;
  useEffect(() => setShown(false), [upKey]);

  const answer = (ok: boolean) => {
    if (!card) return;
    const rest = queue.filter((k) => k !== card.key);
    // Added to the deck already: it is known, done here, nothing more to send.
    if (got.has(card.key)) {
      setQueue(rest);
      return;
    }
    if (!ok) {
      const at = Math.min(AGAIN_BACK, rest.length);
      setQueue([...rest.slice(0, at), card.key, ...rest.slice(at)]);
      return;
    }
    setQueue(rest);
    setGot((g) => new Set(g).add(card.key));
    const sent =
      card.kind === "word"
        ? send("episodes", { id: ep.id, learnt: card.word, keep: false, day: today() })
        : send("episodes", { id: ep.id, previewed: card.i });
    sent.catch((e) => setError(message(e)));
  };
  /** A word into the deck (a new Read card, due at once): known now, so it is done here too. */
  const addWord = async (word: string) => {
    setBusy(`w:${word}`);
    setError(null);
    try {
      await send("episodes", { id: ep.id, learnt: word, keep: true, day: today() });
      setInDeck((d) => new Set(d).add(word));
      setGot((g) => new Set(g).add(`w:${word}`));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  /** A line into the sentences, tagged with the show and the episode. */
  const addLine = async (i: number) => {
    setBusy(`l:${i}`);
    setError(null);
    try {
      const r = await send<{ readable: boolean; blockers: string[]; sources: string[] }>("episodes", { id: ep.id, addLine: i });
      setSaved((m) => new Map(m).set(i, r));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  const more = () => {
    const words = start.words.filter((w) => !got.has(w.key));
    const lines = start.lines.filter((l) => !got.has(l.key) && stillHard(l));
    const next = roundOf(words, lines);
    setRound(next);
    setQueue(next.map((c) => c.key));
  };
  const passed = round.length - new Set(queue.filter((k) => byKey.get(k))).size;
  /** + Add sentence for a line, or where it stands once added. */
  const LineSave = ({ i }: { i: number }) => {
    const s = saved.get(i);
    if (!s)
      return (
        <button className="cf-link" disabled={busy !== null} onClick={() => void addLine(i)}>
          {busy === `l:${i}` ? "Adding…" : "+ Add sentence"}
        </button>
      );
    if (s === true) return <span className="cf-pv-added">✓ In your sentences</span>;
    return (
      <span className="cf-pv-added">
        ✓ Added, tagged {s.sources.map((x) => `“${x}”`).join(", ")}
        {s.readable ? " · readable now" : s.blockers.length ? ` · locked until you know ${s.blockers.join(", ")}` : ""}
      </span>
    );
  };

  return (
    <div className="cf-over cf-pv">
      <div className="cf-over-top">
        <button className="cf-close" onClick={onEnd} aria-label="Back to the script">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-over-title">
          <small>
            <span className="cf-zh">{ep.show}</span> {ep.episode}
          </small>
          <b>Before you watch</b>
        </p>
        <span className="cf-pv-left" aria-label={`${left} cards left`}>
          <b>{fmt(left)}</b> left
        </span>
      </div>
      <div className="cf-walk">
        <div className="cf-pp-progress cf-walk-progress" aria-hidden="true">
          <span style={{ width: `${Math.round((100 * passed) / Math.max(1, round.length))}%` }} />
        </div>
        {!card ? (
          <div className="cf-walk-card cf-pv-done">
            <p className="cf-ep-big">
              ✓ <small>{left ? `Looked over ${fmt(got.size)}` : "Nothing new left in this episode"}</small>
            </p>
            <p className="cf-muted">
              {left
                ? `${fmt(left)} still to look at. None of it went into your deck.`
                : "Every word is known or learnt for the show, and every hard line looked over."}
            </p>
            <div className="cf-pr-buttons">
              {left > 0 && (
                <button className="cf-btn cf-btn-ghost" onClick={more}>
                  Keep going · {fmt(Math.min(PREVIEW_ROUND, left))}
                </button>
              )}
              <button className="cf-btn" onClick={onEnd}>
                Watch it
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="cf-pr-top">
              <span className="cf-walk-at">
                {card.kind === "word"
                  ? `New word${card.must ? " · a must-know" : ""} · said ${card.count === 1 ? "once" : `${fmt(card.count)} times`}`
                  : `Hard line · ${fmt(card.words.filter((w) => !gotWords.has(w)).length)} new words · ${clock(ep.lines[card.i].s)}`}
              </span>
            </p>
            {/* A line is heard first; a word's line once it is shown. */}
            {(card.kind === "line" || shown) && <LineClip key={card.key} ep={ep} i={card.i} />}
            <div className="cf-walk-card">
              {card.kind === "word" ? (
                <>
                  <p className="cf-pv-word cf-zh">{card.word}</p>
                  {shown && (
                    <>
                      <p className="cf-pv-look">
                        {ep.looks[card.word]?.p && <b>{displayPinyin(ep.looks[card.word]!.p)}</b>}
                        {ep.looks[card.word]?.gloss && <span>{ep.looks[card.word]!.gloss}</span>}
                      </p>
                      <p className="cf-walk-line cf-zh">
                        <MarkedLine zh={ep.lines[card.i].zh} words={[card.word]} />
                      </p>
                      {ep.lines[card.i].en && <EnglishLine key={card.key} en={ep.lines[card.i].en!} english={false} />}
                      <div className="cf-pv-actions">
                        {inDeck.has(card.word) ? (
                          <span className="cf-pv-added">✓ Added to your deck</span>
                        ) : (
                          <button className="cf-link" disabled={busy !== null} onClick={() => void addWord(card.word)}>
                            {busy === `w:${card.word}` ? "Adding…" : "+ Add to deck"}
                          </button>
                        )}
                        <LineSave i={card.i} />
                        <button className="cf-link cf-pv-page" onClick={() => wordpage.openWordPage(card.word)}>
                          Word page ›
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <p className="cf-walk-line cf-zh">
                    <MarkedLine zh={ep.lines[card.i].zh} words={card.words.filter((w) => !gotWords.has(w))} />
                  </p>
                  {shown && (
                    <>
                      {ep.lines[card.i].en && <EnglishLine key={card.key} en={ep.lines[card.i].en!} english />}
                      {ep.blurbs.find((b) => b.i === card.i) && <BlurbCard b={ep.blurbs.find((b) => b.i === card.i)!} />}
                      <div className="cf-pv-actions">
                        <LineSave i={card.i} />
                      </div>
                      <ul className="cf-pv-words">
                        {card.words.map((w) => (
                          <WordRow key={w} ep={ep} word={w} added={inDeck.has(w)} busy={busy === `w:${w}`} onAdd={() => void addWord(w)} />
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
            {error && <p className="cf-error">{error}</p>}
            <div className="cf-pr-buttons">
              {!shown ? (
                <button className="cf-btn" onClick={() => setShown(true)}>
                  Show
                </button>
              ) : (
                got.has(card.key) ? (
                  <button className="cf-btn" onClick={() => answer(true)}>
                    Next
                  </button>
                ) : (
                  <>
                    <button className="cf-btn cf-btn-ghost" onClick={() => answer(false)}>
                      Not yet
                    </button>
                    <button className="cf-btn" onClick={() => answer(true)}>
                      Got it
                    </button>
                  </>
                )
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
