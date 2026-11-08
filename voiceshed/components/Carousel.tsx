'use client';

// The Voicings page's views as a carousel (the owner: "make map list deck
// found a proper carousel"): the panels side by side on a track moved by a
// transform — not a scroll container, so the page's sticky bars still stick —
// a sideways swipe drags it with the finger and settles on the next or the
// same panel. Up and down scroll the page as ever (touch-action: pan-y); a
// swipe that starts in something that scrolls sideways itself (the filter's
// chips, a rail) or in an open sheet is left to it. The wrapper takes the
// current panel's height, so a short one doesn't leave the page long. A panel
// renders once it's current or swiped toward, and stays.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Past this share of the width, or flicked faster than FLICK px/ms, the swipe changes panel. */
const SHARE = 0.22;
const FLICK = 0.45;

/** Does something between `el` and `stop` scroll sideways on its own? */
function scrollsSideways(el: Element | null, stop: Element): boolean {
  for (let e = el; e && e !== stop; e = e.parentElement) {
    const ox = getComputedStyle(e).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1) return true;
  }
  return false;
}

export function Carousel({ index, onIndex, panels, onPos }: { index: number; onIndex: (i: number) => void; panels: (() => React.ReactNode)[]; onPos?: (pos: number, dragging: boolean) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(() => new Set([index]));
  const [height, setHeight] = useState<number | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; t: number; on: boolean | null; dx: number } | null>(null);
  const onPosRef = useRef(onPos);
  onPosRef.current = onPos;

  useEffect(() => setSeen(s => (s.has(index) ? s : new Set(s).add(index))), [index]);

  // Where the track sits: the panel, plus the drag.
  const place = (dx: number, animate: boolean) => {
    const t = track.current;
    const w = wrap.current?.clientWidth || 1;
    if (!t) return;
    t.style.transition = animate ? 'transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    t.style.transform = `translate3d(calc(${-index * 100}% + ${dx}px), 0, 0)`;
    onPosRef.current?.(index - dx / w, !animate);
  };
  useLayoutEffect(() => place(0, true)); // eslint-disable-line react-hooks/exhaustive-deps

  // The wrapper's height: the current panel's.
  useEffect(() => {
    const panel = track.current?.children[index] as HTMLElement | undefined;
    if (!panel || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHeight(panel.offsetHeight));
    ro.observe(panel);
    setHeight(panel.offsetHeight);
    return () => ro.disconnect();
  }, [index, seen]);

  // A new panel starts at its top: back up to the carousel if the page was scrolled past it.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const w = wrap.current;
    if (!w) return;
    const stuck = [...document.querySelectorAll<HTMLElement>('.vt-bar, .vf-top')].reduce((n, e) => n + e.offsetHeight, 0);
    const top = w.getBoundingClientRect().top + window.scrollY - stuck;
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
  }, [index]);

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest('.vt-modal, input, textarea, select') || scrollsSideways(target, e.currentTarget)) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), on: null, dx: 0 };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.on == null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.on = Math.abs(dx) > Math.abs(dy) * 1.2;
      if (!d.on) return;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      // No text selected by the drag (a mouse would).
      document.documentElement.classList.add('cs-dragging');
      window.getSelection()?.removeAllRanges();
      // Seen as we drag toward them.
      setSeen(s => {
        const n = new Set(s);
        if (index > 0) n.add(index - 1);
        if (index < panels.length - 1) n.add(index + 1);
        return n.size === s.size ? s : n;
      });
    }
    if (!d.on) return;
    // Past the ends it gives, but only a little.
    const atEnd = (dx > 0 && index === 0) || (dx < 0 && index === panels.length - 1);
    d.dx = atEnd ? dx / 3 : dx;
    place(d.dx, false);
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    document.documentElement.classList.remove('cs-dragging');
    if (!d || d.id !== e.pointerId || !d.on) return;
    const w = wrap.current?.clientWidth || 1;
    const speed = d.dx / Math.max(1, performance.now() - d.t);
    let next = index;
    if ((d.dx < -w * SHARE || speed < -FLICK) && index < panels.length - 1) next = index + 1;
    else if ((d.dx > w * SHARE || speed > FLICK) && index > 0) next = index - 1;
    if (next === index) place(0, true);
    else onIndex(next);
  };
  // A tap at the end of a swipe isn't a tap on what's under it.
  const click = (e: React.MouseEvent) => {
    if (swiped.current) {
      e.stopPropagation();
      e.preventDefault();
      swiped.current = false;
    }
  };
  const swiped = useRef(false);
  const upCapture = (e: React.PointerEvent) => {
    swiped.current = !!drag.current?.on && Math.abs(drag.current.dx) > 8;
    up(e);
  };

  const near = (i: number) => seen.has(i);
  return (
    <div className="cs" ref={wrap} style={height != null ? { height } : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={upCapture} onPointerCancel={upCapture} onClickCapture={click}>
      <div className="cs-track" ref={track}>
        {panels.map((render, i) => (
          <div key={i} className={`cs-panel ${i === index ? 'on' : ''}`} aria-hidden={i !== index} inert={i !== index}>
            {near(i) ? render() : null}
          </div>
        ))}
      </div>
    </div>
  );
}
