"use client";

// Look up (查): "what do I say here", answered from the owner's own sentences
// (app/api/chongfuxi/lookup.ts), laid out as a dictionary entry (layout A of
// the owner's pick). Nothing says what the answer is: for a gap, the phrase
// shows the best word in it and every candidate under it (fitting ones with
// their tag, near misses struck through), so it reads at a glance. Then each word that fits as a
// numbered sense (what it's for, the word and its pinyin, its dictionary
// meaning, why, how often the owner's sentences have it, an example), with
// the evidence behind "Why, and more examples"; the near misses struck
// through with a wrong and a right sentence. Every word says where it stands
// in the deck, with + Add (and Undo) for one that isn't.
//
// A proof of concept. Each answer asks for a verdict (Right / Wrong, and
// what was wrong): those lookups are the test set that decides what to build.

import { Fragment, useEffect, useRef, useState } from "react";
import { routeParam, useRouteParam } from "@chongfuxi/lib/route";
import * as wordpage from "@chongfuxi/lib/wordpage";
import type { LookupAnswer, LookupBlock, LookupListed, LookupViewed, LookupSentence, LookupSource, LookupWord, LookupFrom, SentenceSuggestion, WordSuggestion } from "@chongfuxi/lib/api";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import { get, send } from "@chongfuxi/lib/client";
import { Loading, AiPill, message, type Shell } from "./shared";

const KIND = {
  pairing: "Which word goes with it",
  meaning: "Which meaning",
  synonyms: "Near-synonyms",
  tone: "Tone",
  pattern: "A sentence pattern",
  expression: "A whole expression",
  reading: "What it means here",
  breakdown: "Why these characters",
} as const;

const SOURCE: Record<LookupSource, string> = {
  corpus: "your sentences",
  dictionary: "dictionary",
  deck: "your deck",
  model: "model",
};

/** The phrase with the gap filled by the word picked: green when it fits, struck through red when it doesn't. */
function Frame({ frame, zh, fits }: { frame: string; zh: string | null; fits: boolean }) {
  const at = frame.indexOf("___");
  if (at < 0) return <p className="cf-lk-frame">{frame}</p>;
  return (
    <p className="cf-lk-frame" lang="zh">
      {frame.slice(0, at)}
      {zh ? (
        <span className={`cf-lk-gap ${fits ? "is-fit" : "is-miss"}`}>{zh}</span>
      ) : (
        <span className="cf-lk-gap" aria-label="the gap" />
      )}
      {frame.slice(at + 3)}
    </p>
  );
}

type Block<T extends LookupBlock["type"]> = Extract<LookupBlock, { type: T }>;

const STAGE = { new: "new", young: "young", mature: "mature", strong: "strong" } as const;

/** What a block needs besides itself: the words map, and the question and shell for adding a word. */
interface Ctx {
  words: Record<string, LookupWord>;
  query: string;
  shell: Shell;
}

/**
 * Where a word stands in the deck, at a glance, and a way to put it there:
 * "In deck · strong", or + Add (one addition, undone here or like any other).
 */
function DeckMark({ zh, ctx, compact = false }: { zh: string; ctx: Ctx; compact?: boolean }) {
  const [added, setAdded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = ctx.words[zh];

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ id: number | null; added: string[] }>("lookup", { q: ctx.query, add: zh });
      if (r.id !== null) setAdded(r.id);
      ctx.shell.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (added === null) return;
    setBusy(true);
    setError(null);
    try {
      await send(`additions/${added}`, { action: "undo" });
      setAdded(null);
      ctx.shell.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (added !== null) {
    return (
      <span className={`cf-lk-deck is-in${compact ? " is-compact" : ""}`}>
        ✓ Added
        <button className="cf-lk-undo" disabled={busy} onClick={() => void undo()}>
          Undo
        </button>
      </span>
    );
  }
  if (!info) return null;
  if (info.deck?.status === "deck") {
    const stage = info.deck.stage;
    // In a narrow column (a comparison, a scale) the stage alone says it: "✓ strong".
    if (compact) {
      return (
        <span className="cf-lk-deck is-in is-compact" title="In your deck">
          ✓ {stage ? STAGE[stage] : "in deck"}
        </span>
      );
    }
    return <span className="cf-lk-deck is-in">✓ In deck{stage ? ` · ${STAGE[stage]}` : ""}</span>;
  }
  if (info.deck?.status === "name" || !info.inDictionary || !info.pinyin || info.parts) return null;
  return (
    <>
      <button className={`cf-lk-add${compact ? " is-compact" : ""}`} disabled={busy} onClick={() => void add()} title={info.deck?.status === "listed" ? "On one of your Pleco lists" : undefined}>
        {busy ? "Adding…" : "+ Add"}
      </button>
      {error && <span className="cf-error cf-lk-adderr">{error}</span>}
    </>
  );
}

const inDeck = (ctx: Ctx, zh: string) => ctx.words[zh]?.deck?.status === "deck";

/**
 * A word as a dictionary line: the word, our pinyin, where it stands in the
 * deck (or + Add), its meaning. A phrase that isn't a headword shows a line
 * for each word in it instead.
 */
/** A word in the owner's corpus (in the deck or on a list) opens its page. */
function WordPageLink({ zh, ctx }: { zh: string; ctx: Ctx }) {
  const status = ctx.words[zh]?.deck?.status;
  if (status !== "deck" && status !== "listed") return null;
  return (
    <button className="cf-link cf-lk-page" onClick={() => openFromLookup(zh)}>
      Word page ›
    </button>
  );
}

function WordLine({ zh, ctx }: { zh: string; ctx: Ctx }) {
  const info = ctx.words[zh];
  if (info?.parts) {
    return (
      <>
        {info.parts.map((w) => (
          <WordLine key={w} zh={w} ctx={ctx} />
        ))}
      </>
    );
  }
  return (
    <div className="cf-lk-wl">
      <div className="cf-lk-wordline">
        <span className="cf-zh cf-lk-wl-zh">{zh}</span>
        {info?.pinyin && <span className="cf-lk-py">{info.pinyin}</span>}
        <DeckMark zh={zh} ctx={ctx} />
        <WordPageLink zh={zh} ctx={ctx} />
      </div>
      {info?.gloss && (
        <p className="cf-lk-gloss">
          {info.gloss} <AiPill word={zh} />
        </p>
      )}
    </div>
  );
}

/** A small tick on a chip whose word is already in the deck. */
const DeckTick = ({ on }: { on: boolean }) =>
  on ? (
    <i className="cf-lk-tick" aria-hidden="true" title="In your deck">
      ✓
    </i>
  ) : null;

/**
 * The gap phrase: the best word in it, every candidate under it; a tap tries
 * one, and under the chips shows it as a dictionary line (unless a sense
 * below already does).
 */
function GapBlock({
  b,
  picked,
  onPick,
  ctx,
  sensed,
}: {
  b: Block<"gap">;
  picked: string | null;
  onPick: (zh: string) => void;
  ctx: Ctx;
  sensed: Set<string>;
}) {
  const shown = b.options.find((o) => o.zh === picked) ?? b.options.find((o) => o.fits) ?? null;
  return (
    <div className="cf-lk-head">
      <Frame frame={b.frame} zh={shown?.zh ?? null} fits={shown?.fits ?? true} />
      <div className="cf-lk-tries" role="group" aria-label="Words for the gap">
        {b.options.map((o) => (
          <button
            key={o.zh}
            className={`cf-lk-try ${o.fits ? "is-fit" : "is-miss"}${shown?.zh === o.zh ? " is-on" : ""}`}
            aria-pressed={shown?.zh === o.zh}
            aria-label={`${o.zh}${o.fits ? (o.label ? `, ${o.label}` : "") : ", doesn't fit"}${inDeck(ctx, o.zh) ? ", in your deck" : ""}`}
            onClick={() => onPick(o.zh)}
          >
            <b>{o.zh}</b>
            {o.fits && o.label && <small>{o.label}</small>}
            <DeckTick on={inDeck(ctx, o.zh)} />
          </button>
        ))}
      </div>
      {/* Under the words, so tapping one never moves them. */}
      {shown && (!sensed.has(shown.zh) || !shown.fits) && (
        <div className="cf-lk-pick">
          <WordLine zh={shown.zh} ctx={ctx} />
          {!shown.fits && shown.why && <p className="cf-lk-miss-why">{shown.why}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * A wrong → right block that only says again what a struck chip in the gap
 * says (登记酒店 → 入住酒店, with 登记 already struck): folded into that chip,
 * its reason shown when the chip is tapped. One the owner's sentences
 * contradict stays, since it shows something new.
 */
function foldIntoGap(blocks: LookupBlock[]): LookupBlock[] {
  const gap = blocks.find((x): x is Block<"gap"> => x.type === "gap");
  if (!gap) return blocks;
  const misses = gap.options.filter((o) => !o.fits);
  const fits = gap.options.filter((o) => o.fits);
  const why = new Map<string, string>();
  const kept = blocks.filter((x) => {
    if (x.type !== "wrong-right" || x.used) return true;
    const miss = misses.find((o) => x.wrong.includes(o.zh) && !x.right.includes(o.zh));
    if (!miss || !fits.some((o) => x.right.includes(o.zh))) return true;
    if (x.why && !miss.why) why.set(miss.zh, x.why);
    return false;
  });
  if (!why.size) return kept;
  return kept.map((x) =>
    x === gap ? { ...gap, options: gap.options.map((o) => (why.has(o.zh) ? { ...o, why: why.get(o.zh)! } : o)) } : x,
  );
}

/** One numbered word, as a dictionary sense: when it's the one, the word, its meaning, why, an example; the evidence behind More. */
function SenseItem({
  it,
  n,
  on,
  onPick,
  ctx,
}: {
  it: Block<"sense">["items"][number];
  n: number;
  on: boolean;
  onPick: () => void;
  ctx: Ctx;
}) {
  const [more, setMore] = useState(false);
  const info = ctx.words[it.zh];
  const [first, ...rest] = it.examples;
  return (
    <li className={`cf-lk-sense${on ? " is-on" : ""}`}>
      <span className="cf-lk-n">{n}</span>
      <div className="cf-lk-body">
        {it.label && <p className="cf-lk-lab">{it.label}</p>}
        <div className="cf-lk-wordline">
          <button className="cf-lk-word" onClick={onPick} aria-pressed={on}>
            {it.zh}
          </button>
          {info?.pinyin && <span className="cf-lk-py">{info.pinyin}</span>}
          <DeckMark zh={it.zh} ctx={ctx} />
          <WordPageLink zh={it.zh} ctx={ctx} />
        </div>
        {info?.gloss && (
          <p className="cf-lk-gloss">
            {info.gloss} <AiPill word={it.zh} />
          </p>
        )}
        {it.why && <p className="cf-lk-why">{it.why}</p>}
        {it.count !== null && <p className="cf-lk-count">In {it.count} of your sentences</p>}
        {first && <SenseExample s={first} />}
        {(it.points.length > 0 || rest.length > 0) && (
          <button className="cf-lk-more" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? "Less" : "Why, and more examples"}
          </button>
        )}
        {more && (
          <div className="cf-lk-detail">
            {it.points.length > 0 && (
              <ul className="cf-lk-points">
                {it.points.map((p, i) => (
                  <li key={i}>
                    <span className="cf-lk-point">{p.point}</span>
                    <span>{p.says}</span>
                    <span className={`cf-lk-src is-${p.source}`}>
                      {SOURCE[p.source]}
                      {p.count !== null ? ` · ${p.count}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {rest.map((s) => (
              <SenseExample key={s.id} s={s} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * One of the owner's sentences under a sense, said as its card would see it:
 * "in 县城" when the word is only part of a longer one there, "locked" when
 * a word in it isn't known yet. Either way a card wouldn't show it.
 */
function SenseExample({ s }: { s: LookupSentence }) {
  const notes = [s.within ? `in ${s.within}` : null, s.readable ? null : "locked"].filter(Boolean);
  return (
    <p className="cf-lk-ex">
      <span className="cf-zh">{s.zh}</span>
      {s.en && <span>{s.en}</span>}
      {notes.length > 0 && <span className="cf-lk-from">{notes.join(" · ")}</span>}
    </p>
  );
}

/** Two or three words side by side, compared on the same rows. */
function ContrastBlock({ b, ctx }: { b: Block<"contrast">; ctx: Ctx }) {
  return (
    <div className="cf-lk-contrast" style={{ "--n": b.words.length } as React.CSSProperties} role="table">
      <div className="cf-lk-ct-corner" role="columnheader" />
      {b.words.map((w) => (
        <div key={w} className="cf-lk-ct-head" role="columnheader">
          <span className="cf-zh">{w}</span>
          {ctx.words[w]?.pinyin && <span className="cf-lk-py">{ctx.words[w].pinyin}</span>}
          <span>
            <DeckMark zh={w} ctx={ctx} compact />
          </span>
        </div>
      ))}
      {b.rows.map((r) => (
        <Fragment key={r.aspect}>
          <div className="cf-lk-ct-aspect" role="rowheader">
            {r.aspect}
          </div>
          {r.cells.map((c, i) => (
            <div key={i} className={`cf-lk-ct-cell is-${c.mark}`} role="cell">
              {c.mark === "yes" && <b aria-label="yes">✓ </b>}
              {c.mark === "no" && <b aria-label="no">✗ </b>}
              {c.text}
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/** Words placed along one line between two ends. */
function ScaleBlock({ b, ctx }: { b: Block<"scale">; ctx: Ctx }) {
  return (
    <div className="cf-lk-scale">
      <div className="cf-lk-sc-ends">
        <span>{b.left}</span>
        <span>{b.middle}</span>
        <span>{b.right}</span>
      </div>
      <div className="cf-lk-sc-line" aria-hidden="true" />
      <ol className="cf-lk-sc-points">
        {b.points.map((p) => (
          // Placed by where it sits on the line, kept clear of the edges.
          <li key={p.zh} style={{ "--at": p.at } as React.CSSProperties}>
            <i aria-hidden="true" />
            <span className="cf-zh">{p.zh}</span>
            {ctx.words[p.zh]?.pinyin && <span className="cf-lk-py">{ctx.words[p.zh].pinyin}</span>}
            <small>{p.gloss}</small>
            <DeckMark zh={p.zh} ctx={ctx} compact />
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A sentence with the given words marked, the first time each appears. */
function MarkedText({ zh, marks }: { zh: string; marks: string[] }) {
  const spans: Array<{ from: number; to: number }> = [];
  for (const m of marks) {
    const at = m ? zh.indexOf(m) : -1;
    if (at >= 0 && !spans.some((s) => at < s.to && at + m.length > s.from)) spans.push({ from: at, to: at + m.length });
  }
  spans.sort((x, y) => x.from - y.from);
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.from > at) out.push(zh.slice(at, s.from));
    out.push(<mark key={s.from}>{zh.slice(s.from, s.to)}</mark>);
    at = s.to;
  }
  if (at < zh.length) out.push(zh.slice(at));
  return <>{out}</>;
}

/** A template with slots, what each takes, and fillings with the slot words marked. */
function PatternBlock({ b }: { b: Block<"pattern"> }) {
  const notes = new Map(b.slots.map((s) => [s.name, s.note]));
  const pieces = b.template.split(/\{([^}]+)\}/);
  return (
    <div className="cf-lk-pattern">
      <p className="cf-lk-pt-tmpl" lang="zh">
        {pieces.map((piece, i) =>
          i % 2 === 1 ? (
            <span key={i} className="cf-lk-pt-slot">
              <span>{piece}</span>
              {notes.get(piece) && <small>{notes.get(piece)}</small>}
            </span>
          ) : (
            piece && <span key={i}>{piece}</span>
          ),
        )}
      </p>
      {b.fillings.length > 0 && (
        <ul className="cf-lk-pt-fills">
          {b.fillings.map((f, i) => (
            <li key={i} className={f.mine ? "" : "is-written"}>
              <span className="cf-zh">
                <MarkedText zh={f.zh} marks={f.marks} />
              </span>
              {f.en && <span>{f.en}</span>}
              {!f.mine && <span className="cf-lk-from">written by the model</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The rule behind the answer, and what it combines with in the owner's sentences; a tap shows a member's words. */
function FamilyBlock({ b, ctx }: { b: Block<"family">; ctx: Ctx }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="cf-lk-family">
      <p className="cf-lk-fm-rule">
        <span className="cf-zh">{b.head}</span>
        <span>{b.rule}</span>
      </p>
      <ul className="cf-lk-fm-members">
        {b.members.map((m) => (
          <li key={m.zh}>
            <button
              className={`cf-lk-member${open === m.zh ? " is-on" : ""}`}
              aria-pressed={open === m.zh}
              onClick={() => setOpen(open === m.zh ? null : m.zh)}
            >
              <span className="cf-zh">{m.zh}</span>
              {m.count !== null && <small title="In your sentences">{m.count}×</small>}
              <DeckTick on={inDeck(ctx, m.zh)} />
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <div className="cf-lk-pick">
          <WordLine zh={open} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

/**
 * Where a right version differs from the wrong one: what comes before, the
 * right part, the wrong part, what comes after (他去年得了抑郁症 against
 * 他去年发展了抑郁症: 他去年 · 得 · 发展 · 了抑郁症). Where one side adds
 * nothing (哪个车站 against 哪个站), a character either side is taken in.
 */
function differ(wrong: string, right: string, words: string[] = []): { before: string; fix: string; was: string; after: string } {
  const w = [...wrong];
  const r = [...right];
  let p = 0;
  while (p < w.length && p < r.length && w[p] === r[p]) p++;
  let e = 0;
  while (e < w.length - p && e < r.length - p && w[w.length - 1 - e] === r[r.length - 1 - e]) e++;
  if (p + e >= w.length || p + e >= r.length) {
    if (p > 0) p--;
    else if (e > 0) e--;
  }
  // Out to the whole word, where the answer knows one covering the change
  // (幻觉 over 幻想, not 觉 over 想); the wrong side widens by as much, into
  // the part both share.
  for (const word of words) {
    const len = [...word].length;
    if (len < 2) continue;
    for (let start = 0; start + len <= r.length; start++) {
      if (r.slice(start, start + len).join("") !== word) continue;
      if (start <= p && start + len >= r.length - e) {
        e -= start + len - (r.length - e);
        p = start;
      }
    }
  }
  return {
    before: r.slice(0, p).join(""),
    fix: r.slice(p, r.length - e).join(""),
    was: w.slice(p, w.length - e).join(""),
    after: r.slice(r.length - e).join(""),
  };
}

/**
 * A word taken apart: a row per character (the character, its reading in
 * this word, what it means here, and deck words that share it), then the
 * characters' literal sense put together.
 */
function PartsBlock({ b }: { b: Block<"parts"> }) {
  return (
    <div className="cf-lk-parts">
      <ol className="cf-lk-pa-chars">
        {b.chars.map((c, i) => (
          <li key={i}>
            <span className="cf-zh cf-lk-pa-ch">{c.zh}</span>
            <span className="cf-lk-pa-body">
              <span className="cf-lk-pa-line">
                {c.pinyin && <span className="cf-lk-py">{c.pinyin}</span>}
                <span>{c.gloss}</span>
              </span>
              {c.also.length > 0 && (
                <span className="cf-lk-pa-also">
                  also in <span className="cf-zh">{c.also.join(" · ")}</span>
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {b.literal && <p className="cf-lk-pa-literal">{b.literal}</p>}
    </div>
  );
}

/**
 * The likely mistake, marked as a proofreader would: the right sentence in
 * white with the right word in green, and the wrong word struck in red over
 * it. Nothing else, at the owner's request (two coloured sentences and a
 * reason were too busy). Several right versions ("得了抑郁症 / 患上抑郁症")
 * each get their own mark. When the owner's own sentences use the "wrong"
 * part, the warning is in doubt: one of them, the part in green, and how
 * many there are.
 */
function WrongRightBlock({ b, words }: { b: Block<"wrong-right">; words: string[] }) {
  const used = b.used;
  if (used) {
    const [first] = used.examples;
    return (
      <div className="cf-lk-wr is-used">
        {first && (
          <p className="cf-zh cf-lk-wr-line">
            <GreenText zh={first.zh} mark={used.key} />
          </p>
        )}
        <small className="cf-lk-wr-count">
          {used.key} is in {used.count} of your sentences
        </small>
      </div>
    );
  }
  const rights = b.right.split(/\s*[/／|｜]\s*/).filter((x) => x.trim());
  return (
    <div className="cf-lk-wr">
      {rights.map((right, i) => {
        const d = differ(b.wrong.trim(), right.trim(), words);
        // Too different to mark one word: the wrong version struck, the right one under it.
        if (!d.fix || [...d.was].length > 8) {
          return (
            <p key={i} className="cf-zh cf-lk-wr-line">
              <s className="cf-lk-wr-was">{b.wrong}</s>
              <br />
              {right}
            </p>
          );
        }
        return (
          <p key={i} className="cf-zh cf-lk-wr-line">
            {d.before}
            <ruby className="cf-lk-fix">
              <b>{d.fix}</b>
              <rt>
                <s>{d.was}</s>
              </rt>
            </ruby>
            {d.after}
          </p>
        );
      })}
    </div>
  );
}

/** A sentence in white with one part of it in green. */
function GreenText({ zh, mark }: { zh: string; mark: string }) {
  const at = mark ? zh.indexOf(mark) : -1;
  if (at < 0) return <>{zh}</>;
  return (
    <>
      {zh.slice(0, at)}
      <b className="cf-lk-ok">{mark}</b>
      {zh.slice(at + mark.length)}
    </>
  );
}

/** Prose with its Chinese in the Chinese face, so 是…的 reads as Chinese inside English. */
function HanText({ text }: { text: string }) {
  return (
    <>
      {/* A run starts and ends with Chinese; a slot's capital inside it (围绕X转) stays with it. */}
      {text.split(/([\u3400-\u9fff…](?:[\u3400-\u9fff…A-Z]*[\u3400-\u9fff…])?)/).map((part, i) =>
        i % 2 ? (
          <span key={i} className="cf-zh cf-lk-gram-zh">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * The one thing worth knowing the other blocks don't show, of any kind, under
 * the label the model gives it ("Grammar in your question", "Culture"): the
 * Chinese it is about as a title, for a structure the question's words with
 * the structure's own characters in colour and its inside boxed, then the
 * point itself.
 */
function NoteBlock({ b }: { b: Block<"note"> }) {
  const shape = b.shape.match(/^([^{}]*)\{([^{}]+)\}([^{}]*)$/);
  return (
    <aside className="cf-lk-gram">
      <span className="cf-lk-gram-label">{b.label}</span>
      {b.title && <p className="cf-zh cf-lk-gram-title">{b.title}</p>}
      {shape && (
        <p className="cf-zh cf-lk-gram-shape" aria-label={b.shape.replace(/[{}]/g, "")}>
          {shape[1] && <b>{shape[1]}</b>}
          <span>{shape[2]}</span>
          {shape[3] && <b>{shape[3]}</b>}
        </p>
      )}
      <p className="cf-lk-gram-text">
        <HanText text={b.text} />
      </p>
    </aside>
  );
}

/** One sentence: the owner's, or labelled as the model's. */
function ExampleBlock({ b }: { b: Block<"example"> }) {
  return (
    <p className={`cf-lk-ex${b.mine ? "" : " is-written"}`}>
      <span className="cf-zh">{b.zh}</span>
      {b.en && <span>{b.en}</span>}
      <span className="cf-lk-from">{b.mine ? (b.readable ? "your sentence" : "your sentence · locked") : "written by the model"}</span>
    </p>
  );
}

function Answer({ a, onAgain, shell }: { a: LookupAnswer; onAgain: () => void; shell: Shell }) {
  const gap = a.blocks.find((b): b is Block<"gap"> => b.type === "gap") ?? null;
  const [picked, setPicked] = useState<string | null>(gap?.options.find((o) => o.fits)?.zh ?? null);
  const [verdict, setVerdict] = useState<"right" | "wrong" | null>(null);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctx: Ctx = { words: a.words, query: a.query, shell };

  const judge = async (v: "right" | "wrong" | null, n = "") => {
    setError(null);
    try {
      await send("lookup", { q: a.query, verdict: v, note: n || undefined });
      setVerdict(v);
      setSaved(v !== "wrong" || Boolean(n));
    } catch (e) {
      setError(message(e));
    }
  };

  const blocks = foldIntoGap(a.blocks);
  const sensed = new Set(blocks.flatMap((b) => (b.type === "sense" ? b.items.map((it) => it.zh) : [])));
  // Senses are numbered through the whole answer, as in a dictionary entry.
  let n = 0;
  return (
    <article className="cf-lk-answer">
      {/* How the question was read, the asked part in bold; the blocks show the answer. */}
      <p className="cf-lk-read">
        <span>{KIND[a.reading.kind]}</span>
        {a.reading.parts.length > 0 && (
          <span>
            {a.reading.parts.map((p, i) => (
              <Fragment key={i}>
                {i > 0 && " "}
                {p.asked ? <b>{p.text}</b> : p.text}
              </Fragment>
            ))}
          </span>
        )}
      </p>
      {/* The words of the corpus the question named: each opens its page. */}
      {(() => {
        const about = Object.keys(a.words).filter((w) => a.query.includes(w) && ["deck", "listed"].includes(a.words[w].deck?.status ?? ""));
        return about.length > 0 ? <WordChips label="About" words={about} /> : null;
      })()}
      {blocks.map((b, i) => {
        switch (b.type) {
          case "gap":
            return <GapBlock key={i} b={b} picked={picked} onPick={setPicked} ctx={ctx} sensed={sensed} />;
          case "sense":
            return (
              <ol key={i} className="cf-lk-entry">
                {b.items.map((it) => (
                  <SenseItem
                    key={it.zh}
                    it={it}
                    n={++n}
                    on={Boolean(gap) && picked === it.zh}
                    onPick={() => setPicked(it.zh)}
                    ctx={ctx}
                  />
                ))}
              </ol>
            );
          case "contrast":
            return <ContrastBlock key={i} b={b} ctx={ctx} />;
          case "scale":
            return <ScaleBlock key={i} b={b} ctx={ctx} />;
          case "pattern":
            return <PatternBlock key={i} b={b} />;
          case "family":
            return <FamilyBlock key={i} b={b} ctx={ctx} />;
          case "wrong-right":
            return <WrongRightBlock key={i} b={b} words={Object.keys(a.words)} />;
          case "example":
            return <ExampleBlock key={i} b={b} />;
          case "parts":
            return <PartsBlock key={i} b={b} />;
          case "note":
            return <NoteBlock key={i} b={b} />;
        }
      })}

      <section className="cf-lk-verdict">
        <span>Right?</span>
        <button
          className={`cf-lk-v${verdict === "right" ? " is-on" : ""}`}
          aria-pressed={verdict === "right"}
          aria-label="Right"
          onClick={() => void judge(verdict === "right" ? null : "right")}
        >
          ✓
        </button>
        <button
          className={`cf-lk-v${verdict === "wrong" ? " is-on" : ""}`}
          aria-pressed={verdict === "wrong"}
          aria-label="Wrong"
          onClick={() => void judge(verdict === "wrong" ? null : "wrong")}
        >
          ✗
        </button>
        {saved && <span className="cf-muted">Kept for the test set.</span>}
      </section>
      {verdict === "wrong" && !saved && (
        <form
          className="cf-lk-note"
          onSubmit={(e) => {
            e.preventDefault();
            void judge("wrong", note);
          }}
        >
          <textarea
            className="cf-input"
            rows={2}
            placeholder="What was wrong, or what you used in the end"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="cf-btn" disabled={!note.trim()}>
            Save
          </button>
        </form>
      )}
      {error && <p className="cf-error">{error}</p>}

      <details className="cf-lk-checks">
        <summary>How it was read, and what the check changed</summary>
        {a.summary && <p>{a.summary}</p>}
        {a.reading.note && <p>{a.reading.note}</p>}
        <ul>
          {a.checks.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
        <p>
          {a.model} ·{" "}
          <button className="cf-link" onClick={onAgain}>
            Ask again
          </button>
        </p>
      </details>
    </article>
  );
}

/** Words of the corpus, each a chip opening its page (lib/wordpage.ts). */
function WordChips({ words, label }: { words: string[]; label?: string }) {
  return (
    <p className="cf-lk-words">
      {label && <span className="cf-lk-words-label">{label}</span>}
      {words.map((w) => (
        <button key={w} className="cf-lk-wchip" onClick={() => openFromLookup(w)}>
          <span className="cf-zh">{w}</span> ›
        </button>
      ))}
    </p>
  );
}

/**
 * As the question is typed: words of the corpus that match it, as a
 * dictionary would list them, each opening its page; no model is asked. The
 * last row asks the AI about what is typed.
 */
function Suggestions({
  words,
  sentences,
  typed,
  onAsk,
}: {
  words: WordSuggestion[];
  sentences: SentenceSuggestion[];
  typed: string;
  onAsk: () => void;
}) {
  return (
    <>
    <ul className="cf-lk-suggest" role="listbox" aria-label="Your words">
      {words.map((w) => (
        <li key={w.word}>
          <button role="option" aria-selected={false} onClick={() => openFromLookup(w.word)}>
            <span className="cf-zh cf-lk-sg-zh">{w.word}</span>
            <span className="cf-lk-sg-body">
              {w.pinyin && <span className="cf-lk-py">{displayPinyin(w.pinyin)}</span>}
              {w.gloss && <span className="cf-lk-sg-gloss">{w.gloss}</span>}
            </span>
            <span className={`cf-lk-sg-where${w.inDeck ? " is-deck" : ""}`}>{w.inDeck ? "in deck" : "on a list"}</span>
          </button>
        </li>
      ))}
      <li>
        <button className="cf-lk-sg-ask" onClick={onAsk}>
          Ask about “{typed.trim()}” <span aria-hidden="true">→</span>
        </button>
      </li>
    </ul>
    {/* Under the words (the owner's order), a situation ("flight delayed"): the owner's own sentences that say it, the words for it marked, each to its page. */}
    {sentences.length > 0 && (
      <ul className="cf-lk-suggest cf-lk-sg-sents" aria-label="Your sentences">
        {sentences.map((x) => (
          <li key={x.id}>
            <p className="cf-zh cf-lk-sg-sent">
              <MarkedWords zh={x.zh} words={x.marked} />
              {!x.readable && <span className="cf-lk-sg-locked">locked</span>}
            </p>
            <p className="cf-lk-sg-en">{x.en}</p>
          </li>
        ))}
      </ul>
    )}
    </>
  );
}

/** A sentence with some of its words marked, each opening its word page. */
function MarkedWords({ zh, words }: { zh: string; words: string[] }) {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  if (!sorted.length) return <>{zh}</>;
  const parts = zh.split(new RegExp(`(${sorted.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`));
  return (
    <>
      {parts.map((p, i) =>
        words.includes(p) ? (
          <button key={i} className="cf-lk-sg-mark" onClick={() => openFromLookup(p)}>
            {p}
          </button>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/**
 * A word opened from Look up (a suggestion, a chip, a marked word, Enter on
 * a word): its page opens, and it is kept for the history beside the
 * questions (the owner's request), which hears and reloads.
 */
const viewedListeners = new Set<() => void>();
function openFromLookup(word: string) {
  wordpage.openWordPage(word);
  send("lookup", { viewed: word })
    .then(() => viewedListeners.forEach((f) => f()))
    .catch(() => {});
}

const RECENT = 6;
const hanRuns = (text: string): string[] => text.match(/[\u3400-\u9fff]+/g) ?? [];

/** A question asked, or a word opened from Look up: the history has both, by time. */
type Past = { q: LookupListed } | { w: LookupViewed };
const pastAt = (p: Past) => ("q" in p ? p.q.at : p.w.at);
const pastText = (p: Past) => ("q" in p ? p.q.query : p.w.word);

/**
 * Past questions and words opened, newest first: first those sharing Chinese
 * with what is in the field (one holding the other: 表达 finds "表达 vs 表示",
 * and so does 表达式), then the most recent, the rest a tap away. At the
 * owner's request; it was every question, newest first, and words opened
 * left no trace.
 */
function History({ past, viewed, typed, onPick }: { past: LookupListed[]; viewed: LookupViewed[]; typed: string; onPick: (q: string) => void }) {
  const [all, setAll] = useState(false);
  const items: Past[] = [...past.map((q) => ({ q })), ...viewed.map((w) => ({ w }))].sort((a, b) => pastAt(b) - pastAt(a));
  const wanted = hanRuns(typed);
  const related = wanted.length
    ? items.filter((p) => hanRuns(pastText(p)).some((r) => wanted.some((w) => r.includes(w) || w.includes(r))))
    : [];
  const rest = items.filter((p) => !related.includes(p));
  const recent = all ? rest : rest.slice(0, RECENT);
  const row = (p: Past) => {
    if ("w" in p) {
      const w = p.w;
      return (
        <li key={`w:${w.word}`}>
          {/* A word opened: the word, its reading and meaning, opening its page again. */}
          <button className="cf-lk-hist cf-lk-hist-word" onClick={() => openFromLookup(w.word)}>
            <span className="cf-lk-hist-q">
              <span className="cf-zh">{w.word}</span>
              {w.pinyin && <span className="cf-lk-py">{displayPinyin(w.pinyin)}</span>}
            </span>
            <span className="cf-lk-hist-kind">{w.gloss ?? (w.inDeck ? "In your deck" : "On a list")}</span>
            <em className="cf-lk-hist-go" aria-hidden="true">›</em>
          </button>
        </li>
      );
    }
    const l = p.q;
    return (
      <li key={`q:${l.query}`}>
        {/* The question on one line, the kind it was read as under it, the verdict at the end: opens the answer. */}
        <button className="cf-lk-hist" onClick={() => onPick(l.query)}>
          <span className="cf-lk-hist-q">{l.query}</span>
          {l.kind && <span className="cf-lk-hist-kind">{KIND[l.kind]}</span>}
          <em className={`cf-lk-mark is-${l.verdict ?? "none"}`}>{l.verdict === "right" ? "✓" : l.verdict === "wrong" ? "✗" : ""}</em>
        </button>
        {/* The words it was about, each to its page. */}
        {l.words.length > 0 && <WordChips words={l.words} />}
      </li>
    );
  };
  return (
    <>
      {related.length > 0 && (
        <section className="cf-lk-sec">
          <h3 className="cf-h3">
            With <span className="cf-zh">{wanted.join(" ")}</span>
          </h3>
          <ul className="cf-slist">{related.map(row)}</ul>
        </section>
      )}
      {recent.length > 0 && (
        <section className="cf-lk-sec">
          <h3 className="cf-h3">{related.length ? "Recent" : "History"}</h3>
          <ul className="cf-slist">{recent.map(row)}</ul>
          {!all && rest.length > RECENT && (
            <button className="cf-more" onClick={() => setAll(true)}>
              Show all {rest.length}
            </button>
          )}
        </section>
      )}
    </>
  );
}

/** `start` fills the field, as from a review card's Look up; nothing is asked until the arrow is tapped. */
export function LookupPanel({
  shell,
  start = "",
  routed = false,
  from,
}: {
  shell: Shell;
  start?: string;
  routed?: boolean;
  /** The card it was opened from: sent with each question asked, and kept beside it. */
  from?: LookupFrom;
}) {
  // The Look up tab keeps the question answered in the address, and a reload asks it again
  // (kept answers come back free); a review card's sheet leaves the address alone.
  const [typed, setTyped] = useState(() => start || (routed ? (routeParam("q") ?? "") : ""));
  const [answer, setAnswer] = useState<LookupAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [past, setPast] = useState<{ lookups: LookupListed[]; viewed: LookupViewed[] } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  // The type-ahead: words of the corpus matching what is typed (no model), for that text.
  const [suggest, setSuggest] = useState<{ q: string; words: WordSuggestion[]; sentences: SentenceSuggestion[] } | null>(null);
  useEffect(() => {
    const q = typed.trim();
    if (!q || busy) return setSuggest(null);
    const t = window.setTimeout(() => {
      get<{ words: WordSuggestion[]; sentences?: SentenceSuggestion[] }>("words/suggest", { q })
        .then((r) => setSuggest({ q, words: r.words, sentences: r.sentences ?? [] }))
        .catch(() => setSuggest(null));
    }, 140);
    return () => window.clearTimeout(t);
  }, [typed, busy]);
  /**
   * Enter: a word of the corpus, just that, opens its page; anything more is
   * a question for the AI (a word on its own can still be asked from the
   * suggestions' last row).
   */
  const submit = async () => {
    const q = typed.trim();
    if (!q || busy) return;
    let words = suggest?.q === q ? suggest.words : null;
    if (!words && /^[\u3400-\u9fff]{1,8}$/.test(q)) {
      words = await get<{ words: WordSuggestion[] }>("words/suggest", { q })
        .then((r) => r.words)
        .catch(() => []);
    }
    if (words?.some((w) => w.word === q)) return openFromLookup(q);
    void ask(q);
  };

  // Opened, the field takes the focus, so the phone's keyboard comes up ready
  // (the owner's request), the cursor after anything filled in.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    if (!shell.canWrite || answer) return;
    const load = () =>
      get<{ lookups: LookupListed[]; viewed?: LookupViewed[] }>("lookup")
        .then((r) => setPast({ lookups: r.lookups, viewed: r.viewed ?? [] }))
        .catch(() => setPast({ lookups: [], viewed: [] }));
    void load();
    viewedListeners.add(load);
    return () => {
      viewedListeners.delete(load);
    };
  }, [shell.canWrite, answer]);

  // Asked again on a reload; until then the address is left as it came.
  const [fromAddress] = useState(() => (routed ? routeParam("q") : null));
  const [settled, setSettled] = useState(false);
  useRouteParam("q", answer?.query ?? (busy && typed.trim() ? typed.trim() : null), routed && settled);
  useEffect(() => {
    if (fromAddress) void ask(fromAddress);
    setSettled(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async (q: string, fresh = false) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await send<LookupAnswer>("lookup", { q, fresh: fresh || undefined, from }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (!shell.canWrite) {
    return <p className="cf-muted cf-pad">Look up is Benji&apos;s own: each lookup asks a model, which costs money.</p>;
  }

  return (
    <div className="cf-panel cf-lk">
      {/* One field, with a small round arrow inside it to ask. */}
      <form
        className="cf-lk-ask"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={field}
          type="search"
          enterKeyHint="go"
          placeholder="What do you want to say?"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label="What do you want to say?"
        />
        <button className={`cf-lk-go${busy ? " is-busy" : ""}`} disabled={busy || !typed.trim()} aria-label={busy ? "Looking it up" : "Look up"}>
          {busy ? (
            <i className="cf-lk-spin" aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M4 10h11M11 5.5 15.5 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </form>
      {!busy && suggest && suggest.q === typed.trim() && suggest.q !== answer?.query && (
        <Suggestions words={suggest.words} sentences={suggest.sentences} typed={typed} onAsk={() => void ask(typed)} />
      )}
      {!answer && !busy && !suggest && (
        <p className="cf-muted cf-lk-hint">
          A word of yours opens its page; anything more asks the AI. English, Chinese or both: heavy rain · 拍 a photo · the more… the more
        </p>
      )}

      {busy && <Loading label="Looking through your sentences and the dictionary… this can take a minute." />}
      {error && <p className="cf-error">{error}</p>}
      {answer && <Answer key={answer.query + answer.at} a={answer} shell={shell} onAgain={() => void ask(answer.query, true)} />}

      {!answer && !busy && past && past.lookups.length + past.viewed.length > 0 && (
        <History
          past={past.lookups}
          viewed={past.viewed}
          typed={typed}
          onPick={(q) => {
            setTyped(q);
            void ask(q);
          }}
        />
      )}
    </div>
  );
}
