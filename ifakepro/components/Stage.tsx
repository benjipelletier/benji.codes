'use client';

// Setlist mode (one chart at a time, filling the screen, for playing the
// show) and the print view (one chart per page).

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type ChordStyle, prefersFlats, transposeKey } from '@ifakepro/lib/chords';
import { api, displayKey, usePref } from '@ifakepro/lib/client';
import type { FullSong, PlaylistDetail } from '@ifakepro/lib/types';
import { ChartHead, ChartView } from './ChartView';
import { Spinner } from './ui';

type Full = PlaylistDetail & { fullSongs: FullSong[] };

function useFullPlaylist(slug: string, refreshMs = 0) {
  const [p, setP] = useState<Full | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Full>(`/playlists/${slug}?full=1`).then(setP).catch((e) => setError(e.message));
  }, [slug]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!refreshMs) return;
    const t = setInterval(() => document.visibilityState === 'visible' && load(), refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  return { p, error };
}

/** Scale a chart to fit its box: narrower is smaller, since sizes follow the chart's width. */
/** The narrowest a setlist chart gets (chords about 24px tall). */
const READABLE = 320;

function FitChart({ children, deps }: { children: React.ReactNode; deps: unknown[] }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const fit = useCallback(() => {
    const b = box.current;
    const c = inner.current;
    if (!b || !c) return;
    const W = b.clientWidth;
    const H = b.clientHeight;
    c.style.width = `${W}px`;
    c.style.setProperty('--row-extra', '0px');
    let h = c.scrollHeight;
    if (h > H) {
      // The chart's height grows with its width, but not in proportion (chord
      // sizes cap, bars with several chords wrap), so search for the widest
      // chart that fits. Narrower than READABLE the chords get too small to
      // play from, so a long tune on a short screen (a phone on its side)
      // scrolls instead.
      let lo = Math.min(W, READABLE);
      c.style.width = `${lo}px`;
      const fits = c.scrollHeight <= H;
      b.classList.toggle('scrolls', !fits);
      if (fits) {
        let hi = W;
        while (hi - lo > 4) {
          const mid = Math.floor((lo + hi) / 2);
          c.style.width = `${mid}px`;
          if (c.scrollHeight <= H) lo = mid;
          else hi = mid;
        }
        c.style.width = `${lo}px`;
      } else c.style.width = `${Math.min(W, READABLE * 1.5)}px`;
      h = c.scrollHeight;
    } else b.classList.remove('scrolls');
    // Room to spare (a phone held upright): spread the rows out instead.
    const rows = c.querySelectorAll('.chart-row').length;
    if (h < H && rows) c.style.setProperty('--row-extra', `${Math.min(48, Math.floor((H - h) / rows) - 2)}px`);
  }, []);
  useLayoutEffect(() => {
    fit();
    box.current?.scrollTo(0, 0);
  }, [fit, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Re-fit when the screen changes and when the chart itself does (fonts arriving, an edit coming in).
    let last = '';
    const ro = new ResizeObserver(() => {
      const sig = `${box.current?.clientWidth}x${box.current?.clientHeight}:${inner.current?.scrollHeight}`;
      if (sig !== last) {
        fit();
        last = `${box.current?.clientWidth}x${box.current?.clientHeight}:${inner.current?.scrollHeight}`;
      }
    });
    if (box.current) ro.observe(box.current);
    if (inner.current) ro.observe(inner.current);
    // The chart's fonts arrive after the first measure and change its height.
    document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [fit]);
  return (
    <div className="fit-box" ref={box}>
      <div className="fit-inner" ref={inner}>
        {children}
      </div>
    </div>
  );
}

export function SetlistMode({ slug }: { slug: string }) {
  const { p, error } = useFullPlaylist(slug, 30000);
  const params = useSearchParams();
  const [i, setI] = useState(0);
  const [shift, setShift] = useState(0);
  const [chordStyle] = usePref<ChordStyle>('chordStyle', 'jazz');
  const [chrome, setChrome] = useState(true);
  const started = useRef(false);
  const songs = p?.fullSongs ?? [];

  useEffect(() => {
    if (!p || started.current) return;
    started.current = true;
    const at = songs.findIndex((s) => s.id === params.get('song'));
    if (at >= 0) setI(at);
  }, [p, params, songs]);

  const go = useCallback(
    (d: number) => {
      setI((x) => Math.max(0, Math.min(songs.length - 1, x + d)));
      setShift(0);
    },
    [songs.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' ', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'f') document.documentElement.requestFullscreen?.().catch(() => {});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // Keep the screen on while playing.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const get = async () => {
      try {
        lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof lock> } }).wakeLock?.request('screen') ?? null;
      } catch {}
    };
    get();
    const again = () => document.visibilityState === 'visible' && get();
    document.addEventListener('visibilitychange', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      lock?.release().catch(() => {});
    };
  }, []);

  // Swipe and tap-at-the-edges.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => (touch.current = { x: e.clientX, y: e.clientY, t: Date.now() });
  const onPointerUp = (e: React.PointerEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) return go(dx < 0 ? 1 : -1);
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - s.t < 400) {
      const w = window.innerWidth;
      if (e.clientX < w * 0.25) go(-1);
      else if (e.clientX > w * 0.75) go(1);
      else setChrome((c) => !c);
    }
  };

  if (error) return <div className="stage"><p className="ifp-error">{error}</p></div>;
  if (!p) return <div className="stage"><Spinner /></div>;
  if (!songs.length) return <div className="stage"><p>No songs in this playlist yet.</p><Link href={`/ifakepro/p/${slug}`}>Back</Link></div>;
  const song = songs[Math.min(i, songs.length - 1)];
  const next = songs[i + 1];
  const key = transposeKey(song.meta.key, shift);

  return (
    <div className="stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className={`stage-top ${chrome ? '' : 'hidden'}`} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <Link href={`/ifakepro/p/${slug}`} className="ifp-icon-btn" aria-label="Exit setlist mode">✕</Link>
        <span className="stage-count">{i + 1} / {songs.length}</span>
        <label className="keysel">
          <select value={shift} onChange={(e) => setShift(Number(e.target.value))} aria-label="Key">
            {Array.from({ length: 12 }, (_, k) => k - 5).map((s) => <option key={s} value={s}>{displayKey(transposeKey(song.meta.key, s))}</option>)}
          </select>
        </label>
        <button className="ifp-icon-btn" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} aria-label="Full screen">⛶</button>
      </div>
      <div className="stage-song">
        <ChartHead meta={song.meta} playlist={p.title} keyShown={key} />
        <FitChart deps={[song.id, shift, chordStyle]}>
          <ChartView chart={song.chart} shift={shift} flats={prefersFlats(key)} chordStyle={chordStyle} />
        </FitChart>
      </div>
      {next && (
        <button className="stage-next" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => go(1)}>
          Next: <b>{next.meta.title}</b> ›
        </button>
      )}
    </div>
  );
}

export function PrintView({ slug }: { slug: string }) {
  const { p, error } = useFullPlaylist(slug);
  const params = useSearchParams();
  const only = params.get('song');
  const auto = params.get('auto') === '1';
  const [chordStyle] = usePref<ChordStyle>('chordStyle', 'jazz');
  const printed = useRef(false);
  useEffect(() => {
    if (p && auto && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 600);
    }
  }, [p, auto]);
  if (error) return <p className="ifp-error">{error}</p>;
  if (!p) return <Spinner />;
  const songs = only ? p.fullSongs.filter((s) => s.id === only) : p.fullSongs;
  return (
    <div className="print">
      <div className="print-bar">
        <Link href={only ? `/ifakepro/p/${slug}/s/${only}` : `/ifakepro/p/${slug}`}>‹ Back</Link>
        <span>{songs.length} chart{songs.length === 1 ? '' : 's'} · one per page</span>
        <button className="ifp-btn primary small" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      {songs.map((s) => (
        <section key={s.id} className="print-page">
          <ChartHead meta={s.meta} playlist={p.title} />
          <ChartView chart={s.chart} chordStyle={chordStyle} flats={prefersFlats(s.meta.key)} />
          <footer className="print-foot">{p.title}</footer>
        </section>
      ))}
    </div>
  );
}
