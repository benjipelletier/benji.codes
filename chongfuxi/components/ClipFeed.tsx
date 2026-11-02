"use client";

// Clips to scroll through like TikTok, to test listening (the owner: "scroll
// through parts of chapters or whole episodes as if it's tiktok, to help me
// test my comprehension, maybe organized by what words are waiting for
// review or recently reviewed or having trouble"; app/api/chongfuxi/clipfeed.ts).
// Full screen: the video fixed on top, one player for every clip, and under
// it the clips, one a screen, snapping as they are swiped up. Each plays as
// it comes to rest, the text hidden: listen, Show, then say whether it was
// caught. The tally stays on the screen; nothing touches a schedule.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClipFeed as Feed, ClipMode, FeedClip } from "@chongfuxi/lib/api";
import { get, today } from "@chongfuxi/lib/client";
import { displayPinyin } from "@chongfuxi/lib/hanzi";
import * as wordpage from "@chongfuxi/lib/wordpage";
import { say } from "./Drill";
import { CLIP_AFTER, CLIP_BEFORE, EnglishLine, SpeedButton, VIDEO_TICK, clock, loadYouTube, useSpeed, type YTPlayer } from "./Watch";
import { Loading, fmt, message } from "./shared";

const MODES: Array<{ mode: ClipMode; label: string; empty: string; noun: string }> = [
  { mode: "due", label: "Due", empty: "None of the words due today is said in your episodes.", noun: "due" },
  { mode: "recent", label: "Recent", empty: "None of the words you reviewed in the last few days is said in your episodes.", noun: "recently reviewed" },
  { mode: "trouble", label: "Trouble", empty: "None of the words you've forgotten this month is said in your episodes.", noun: "trouble" },
  { mode: "learnt", label: "Just learnt", empty: "None of the words you've learnt these two weeks is said in your episodes.", noun: "new" },
  { mode: "episode", label: "This episode", empty: "This episode has no lines.", noun: "review" },
];

/** A clip comes to rest this long after the last scroll (ms) before it plays. */
const SETTLE = 140;
/** Clips drawn either side of the one on screen; the rest are empty boxes of the same height. */
const NEAR = 3;

/** The span a clip plays (subtitle ms), a breath either side. */
const spanOf = (c: FeedClip): [number, number] => [c.lines[0].s - CLIP_BEFORE, c.lines[c.lines.length - 1].e + CLIP_AFTER];

/** A line with the feed's words marked, each opening its page. */
function Marked({ zh, words }: { zh: string; words: string[] }) {
  const out: Array<string | { w: string }> = [];
  let rest = zh;
  while (rest) {
    let best: { at: number; w: string } | null = null;
    for (const w of words) {
      const at = rest.indexOf(w);
      if (at >= 0 && (!best || at < best.at || (at === best.at && w.length > best.w.length))) best = { at, w };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.at) out.push(rest.slice(0, best.at));
    out.push({ w: best.w });
    rest = rest.slice(best.at + best.w.length);
  }
  return (
    <>
      {out.map((p, k) =>
        typeof p === "string" ? (
          <span key={k}>{p}</span>
        ) : (
          <button key={k} className="cf-feed-mark" onClick={() => wordpage.openWordPage(p.w)}>
            {p.w}
          </button>
        ),
      )}
    </>
  );
}

/**
 * The feed, over everything. Opened from Muse's Watch rows on Due (the
 * words due today), or from an episode on This episode, at the chapter in
 * view (`start`, a line index). Modes: Due, Recent, Trouble, Just learnt
 * (across every episode, or this one), This episode (its lines in order).
 */
export function ClipFeed({ id, start, onEnd }: { id?: number; start?: number; onEnd: () => void }) {
  const [mode, setMode] = useState<ClipMode>(id ? "episode" : "due");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, boolean>>(new Map());
  const list = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Where an episode's feed opens: the first clip at or after `start`, once.
  const opening = useRef(start ?? null);

  useEffect(() => {
    let live = true;
    setFeed(null);
    setError(null);
    setShown(new Set());
    get<Feed>("episodes", { feed: mode, ...(id ? { id } : {}), ...today() })
      .then((f) => live && setFeed(f))
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [mode, id]);

  // The player: one for the whole feed, made once a clip has a video, moved from video to video.
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const rate = useSpeed(player);
  const applyRate = useRef(rate.apply);
  applyRate.current = rate.apply;
  const ready = useRef(false);
  const loaded = useRef<string | null>(null);
  const pending = useRef<FeedClip | null>(null);
  const stopAt = useRef<number | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const firstVideo = feed?.clips.find((c) => c.video)?.video ?? null;
  const firstRef = useRef(firstVideo);
  firstRef.current = firstVideo;
  // Once a feed has had a video the player stays, through feeds loading and feeds without one.
  const [needPlayer, setNeedPlayer] = useState(false);
  useEffect(() => {
    if (firstVideo) setNeedPlayer(true);
  }, [firstVideo]);
  const play = (c: FeedClip) => {
    const [from, to] = spanOf(c);
    const secs = (ms: number) => Math.max(0, (ms + c.offset) / 1000);
    if (!c.video) {
      player.current?.pauseVideo?.();
      stopAt.current = null;
      say(c.lines.map((l) => l.zh).join(""));
      return;
    }
    const p = player.current;
    if (!p || !ready.current) {
      pending.current = c;
      return;
    }
    stopAt.current = secs(to);
    if (loaded.current !== c.video) {
      loaded.current = c.video;
      p.loadVideoById({ videoId: c.video, startSeconds: secs(from) });
    } else {
      p.seekTo(secs(from), true);
      p.playVideo();
    }
  };
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    const firstVideo = firstRef.current;
    if (!needPlayer || !host.current || !firstVideo) return;
    let gone = false;
    let tick: ReturnType<typeof setInterval> | undefined;
    const el = document.createElement("div");
    host.current.appendChild(el);
    loadYouTube()
      .then((YT) => {
        if (gone) return;
        loaded.current = firstVideo;
        player.current = new YT.Player(el, {
          videoId: firstVideo,
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0, controls: 0, disablekb: 1 },
          events: {
            onReady: () => {
              ready.current = true;
              applyRate.current();
              const c = pending.current;
              pending.current = null;
              if (c) playRef.current(c);
            },
            // A newly loaded video starts at normal speed: the chosen one again.
            onStateChange: (e: { data: number }) => {
              if (e.data === 1) applyRate.current();
            },
            onError: () => setVideoError("YouTube won't play this video here."),
          },
        });
        // Stop at the end of the clip, however it was started.
        tick = setInterval(() => {
          const p = player.current;
          if (stopAt.current === null || !p?.getCurrentTime || p.getPlayerState?.() !== 1) return;
          if (p.getCurrentTime() >= stopAt.current) {
            p.pauseVideo();
            stopAt.current = null;
          }
        }, VIDEO_TICK / 2);
      })
      .catch((e) => setVideoError(message(e)));
    return () => {
      gone = true;
      ready.current = false;
      loaded.current = null;
      if (tick) clearInterval(tick);
      player.current?.destroy?.();
      player.current = null;
      el.remove();
    };
    // Made once a feed with a video arrives; later feeds load their videos into it.
  }, [needPlayer]);
  useEffect(
    () => () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // No voice.
      }
    },
    [],
  );

  // A new feed opens at its first clip (an episode's, at the chapter it was opened on).
  useLayoutEffect(() => {
    if (!feed || !list.current) return;
    let at = 0;
    if (opening.current !== null && feed.mode === "episode") {
      const s = opening.current;
      at = Math.max(0, feed.clips.findIndex((c) => c.from + c.lines.length > s));
      opening.current = null;
    }
    list.current.scrollTop = at * list.current.clientHeight;
    setActive(at);
  }, [feed]);
  // The clip on screen plays as it comes to rest.
  const clips = feed?.clips ?? [];
  useEffect(() => {
    const c = clips[active];
    if (c) playRef.current(c);
  }, [active, feed]);

  const onScroll = () => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const box = list.current;
      if (!box || !box.clientHeight) return;
      const at = Math.round(box.scrollTop / box.clientHeight);
      setActive((a) => (a === at ? a : at));
    }, SETTLE);
  };
  const goTo = (k: number) => {
    const box = list.current;
    if (box) box.scrollTo({ top: k * box.clientHeight, behavior: "smooth" });
  };
  const grade = (c: FeedClip, k: number, got: boolean) => {
    setResults((r) => new Map(r).set(c.key, got));
    setTimeout(() => goTo(k + 1), 280);
  };
  const reveal = (c: FeedClip) => setShown((s) => new Set(s).add(c.key));

  const graded = clips.filter((c) => results.has(c.key));
  const got = graded.filter((c) => results.get(c.key)).length;
  const meta = MODES.find((m) => m.mode === mode)!;
  const current = clips[active];
  // From an episode, its own clips lead.
  const modes = id ? [MODES[MODES.length - 1], ...MODES.slice(0, -1)] : MODES.slice(0, -1);

  return (
    <div className="cf-over cf-feed">
      <div className="cf-over-top">
        <button className="cf-close" onClick={onEnd} aria-label="Close the clips">
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="cf-over-title">
          <small>{feed ? `${fmt(clips.length)} clips${feed.words ? ` · ${fmt(feed.words)} words` : ""}` : "Clips"}</small>
          <b>Listen</b>
        </p>
        {graded.length > 0 && (
          <span className="cf-feed-tally" aria-label={`Got ${got} of ${graded.length}`}>
            <b>{fmt(got)}</b> / {fmt(graded.length)} caught
          </span>
        )}
        {needPlayer && <SpeedButton speed={rate.speed} onNext={rate.next} />}
      </div>
      <div className="cf-feed-modes" role="tablist">
        {modes.map((m) => (
          <button key={m.mode} role="tab" aria-selected={m.mode === mode} className={`cf-chip${m.mode === mode ? " is-on" : ""}`} onClick={() => setMode(m.mode)}>
            {m.label}
          </button>
        ))}
      </div>
      {/* The player stays mounted while the feed has a video; a clip without one covers it. */}
      {needPlayer && (
        <div className="cf-wv-frame cf-feed-frame" ref={host}>
          {current && !current.video && <p className="cf-feed-novideo">No video for this one: the phone&apos;s voice reads it.</p>}
        </div>
      )}
      {videoError && <p className="cf-error cf-feed-error">{videoError}</p>}
      {error && <p className="cf-error cf-feed-error">{error}</p>}
      {!feed && !error && <Loading label="Finding clips…" />}
      {feed && !clips.length && <p className="cf-muted cf-feed-empty">{meta.empty}</p>}
      {feed && clips.length > 0 && (
        <div className="cf-feed-list" ref={list} onScroll={onScroll}>
          {clips.map((c, k) => {
            const near = Math.abs(k - active) <= NEAR;
            const open = shown.has(c.key);
            const result = results.get(c.key);
            return (
              <section key={c.key} className={`cf-feed-card${result === true ? " is-got" : result === false ? " is-missed" : ""}`} aria-label={`Clip ${k + 1} of ${clips.length}`}>
                {near && (
                  <>
                    <p className="cf-feed-at">
                      <span>
                        <b className="cf-zh">{c.show}</b> {c.episode} · {clock(c.lines[0].s)}
                      </span>
                      <small>
                        {fmt(k + 1)} / {fmt(clips.length)}
                      </small>
                    </p>
                    {open ? (
                      <div className="cf-feed-text">
                        {c.lines.map((l, j) => (
                          <p key={j} className="cf-feed-line">
                            <span className="cf-zh cf-feed-zh">
                              <Marked zh={l.zh} words={c.words} />
                            </span>
                            {l.en && <EnglishLine en={l.en} english={false} />}
                          </p>
                        ))}
                        {c.words.length > 0 && (
                          <ul className="cf-feed-words">
                            {c.words.map((w) => {
                              const look = feed.looks[w];
                              return (
                                <li key={w}>
                                  <button onClick={() => wordpage.openWordPage(w)}>
                                    <b className="cf-zh">{w}</b>
                                    {look?.pinyin && <span>{displayPinyin(look.pinyin)}</span>}
                                    {look?.gloss && <small>{look.gloss}</small>}
                                    <i aria-hidden="true">›</i>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <div className="cf-feed-hidden">
                        <p className="cf-feed-prompt">Did you catch it?</p>
                        <p className="cf-muted">
                          {c.lines.length === 1 ? "One line" : `${c.lines.length} lines`}
                          {c.words.length > 0 && mode !== "episode" ? `, with ${c.words.length === 1 ? "one" : c.words.length} of your ${meta.noun} words` : ""}
                          {c.words.length > 0 && mode === "episode" ? `, with ${c.words.length === 1 ? "a word" : `${c.words.length} words`} you're working on` : ""}
                        </p>
                      </div>
                    )}
                    <div className="cf-feed-bar">
                      {!open ? (
                        <button className="cf-btn cf-feed-show" onClick={() => reveal(c)}>
                          Show it
                        </button>
                      ) : result === undefined ? (
                        <>
                          <button className="cf-btn cf-feed-miss" onClick={() => grade(c, k, false)}>
                            Missed it
                          </button>
                          <button className="cf-btn cf-feed-got" onClick={() => grade(c, k, true)}>
                            Got it
                          </button>
                        </>
                      ) : (
                        <span className="cf-feed-result">{result ? "✓ Caught it" : "✗ Missed it"}</span>
                      )}
                      <button className="cf-clip-again" onClick={() => playRef.current(c)}>
                        {c.video ? "↺ Again" : "🔊 Again"}
                      </button>
                    </div>
                  </>
                )}
              </section>
            );
          })}
          <section className="cf-feed-card cf-feed-end">
            <p className="cf-ep-big">
              ✓ <small>{graded.length ? `Caught ${fmt(got)} of ${fmt(graded.length)}` : `${fmt(clips.length)} clips`}</small>
            </p>
            <p className="cf-muted">Try another set:</p>
            <div className="cf-feed-endmodes">
              {modes
                .filter((m) => m.mode !== mode)
                .map((m) => (
                  <button key={m.mode} className="cf-chip" onClick={() => setMode(m.mode)}>
                    {m.label}
                  </button>
                ))}
            </div>
            <button className="cf-link" onClick={onEnd}>
              Close
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
