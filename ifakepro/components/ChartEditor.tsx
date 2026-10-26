'use client';

// The chart, editable in place. Reading by default: nothing on screen but the
// chart. Tap a bar (as an editor) and a sheet opens at the bottom with the
// tapped chord selected; the chart stays visible above it, and the bar being
// edited is kept in view. The sheet has the bar's timeline and four panels —
// Chord (simple), Rhythm (timing), Bars (structure, ranges) and Type (text) —
// and stays open for edit after edit until Done.
//
// Keyboard: ← → events · ↑ ↓ rows · Shift+arrows extend bars · letters type a
// chord · Enter edit · r rest · n N.C. · s split · Delete remove ·
// ⌘Z / ⇧⌘Z undo / redo · ⌘C ⌘X ⌘V copy, cut, paste bars · ⌘D duplicate · Esc done.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Bar, type Chart, type Ev, eventAt, layout, metersOf } from '@ifakepro/lib/chart';
import { type ChordStyle, chordText } from '@ifakepro/lib/chords';
import { deleteBars, duplicateBars, gridStep, insertBars, insertCopies, moveBoundary, removeEvent, replaceEvents, splitEvent } from '@ifakepro/lib/edit';
import { barsText, parseProgression } from '@ifakepro/lib/progression';
import { ChartView, type ChartViewProps, type Selection } from './ChartView';
import { BarsPanel, ChordPanel, type EdCtx, RhythmPanel, TypePanel, addAt, quickKind } from './editor/EditorPanels';
import { Timeline, positionLabel } from './editor/Timeline';
import { useToast } from './ui';

export interface EditorProps {
  chart: Chart;
  change: (fn: (c: Chart) => Chart, opts?: { coalesce?: string }) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  sel: Selection | null;
  setSel: (s: Selection | null) => void;
  /** Allowed to edit (an editor, viewing the written key, not previewing a version). */
  editable: boolean;
  /** Why editing is off, and how to turn it back on. */
  locked?: { reason: string; fix?: { label: string; run: () => void } } | null;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canComment: boolean;
  onComment: (barId: string) => void;
  chordStyle: ChordStyle;
  /** Spell with flats (from the song's key). */
  flats: boolean;
  view: Omit<ChartViewProps, 'chart' | 'selection' | 'onBarClick' | 'chordStyle'>;
}

type Tab = 'chord' | 'rhythm' | 'bars' | 'type';

export function ChartEditor(p: EditorProps) {
  const { chart, sel, setSel, editing, setEditing, editable } = p;
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('chord');
  const [grid, setGrid] = useState(1);
  const [rangeMode, setRangeMode] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTick = useRef(0);
  const clip = useRef<Bar[] | null>(null);

  const meters = useMemo(() => metersOf(chart), [chart]);
  const rows = useMemo(() => layout(chart), [chart]);
  const n = chart.bars.length;

  // The current bar and event, kept valid as the chart changes underneath.
  const i = sel ? Math.min(sel.from, n - 1) : -1;
  const bar = i >= 0 ? chart.bars[i] : null;
  const m = i >= 0 ? meters[i] : meters[0];
  const ev: Ev | null = bar ? bar.events.find((e) => e.id === sel?.ev) ?? eventAt(bar, lastTick.current) : null;
  useEffect(() => {
    if (!sel) return;
    const single = sel.from === sel.to;
    if (sel.to >= n || (single && ev && sel.ev !== ev.id)) {
      setSel({ from: Math.min(sel.from, n - 1), to: Math.min(sel.to, n - 1), ev: single ? ev?.id ?? null : null });
    }
  }, [sel, n, ev, setSel]);
  if (ev) lastTick.current = ev.at;

  const select = useCallback(
    (from: number, to = from, evId: string | null = null) => {
      const a = Math.max(0, Math.min(from, n - 1));
      const b = Math.max(a, Math.min(to, n - 1));
      setSel({ from: a, to: b, ev: a === b ? evId ?? chart.bars[a].events[0].id : null });
    },
    [n, chart, setSel],
  );

  const change = p.change;
  const apply = useCallback((fn: (c: Chart) => Chart, coalesce?: string) => change(fn, coalesce ? { coalesce } : undefined), [change]);

  /** The next or previous event, across bars; past the end of the chart, a new bar. */
  const goEvent = useCallback(
    (d: 1 | -1) => {
      if (!bar || !ev) return;
      const k = bar.events.findIndex((e) => e.id === ev.id);
      const nk = k + d;
      if (nk >= 0 && nk < bar.events.length) return select(i, i, bar.events[nk].id);
      const ni = i + d;
      if (ni < 0) return;
      if (ni >= n) {
        let id = '';
        apply((c) => {
          const out = insertBars(c, n);
          id = out.bars[n].events[0].id;
          return out;
        });
        setSel({ from: n, to: n, ev: id });
        return;
      }
      const evs = chart.bars[ni].events;
      select(ni, ni, (d > 0 ? evs[0] : evs[evs.length - 1]).id);
    },
    [bar, ev, i, n, chart, select, apply, setSel],
  );

  // Keep the bar being edited in view, above the sheet (and below the header), without jumping about.
  const current = useRef(i);
  current.current = i;
  const reveal = useCallback(() => {
    const el = wrap.current?.querySelector(`[data-bar="${current.current}"]`) as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const bottom = window.innerHeight - (sheet.current?.offsetHeight ?? 0) - 12;
    if (r.top < 70) window.scrollBy({ top: r.top - 80 });
    else if (r.bottom > bottom) window.scrollBy({ top: r.bottom - bottom });
  }, []);
  useEffect(() => {
    if (editing && i >= 0) reveal();
  }, [editing, i, reveal]);

  // The sheet is fixed to the bottom of the screen, as wide as the chart column; the chart gets
  // room underneath for it, and it rides above the phone keyboard.
  useEffect(() => {
    if (!editing) return;
    const root = document.documentElement;
    const place = () => {
      const col = wrap.current?.closest('.song-sheet') as HTMLElement | null;
      const r = col?.getBoundingClientRect();
      const phone = window.innerWidth < 640;
      root.style.setProperty('--ed-left', phone || !r ? '0px' : `${r.left}px`);
      root.style.setProperty('--ed-w', phone || !r ? '100vw' : `${r.width}px`);
    };
    const ro = new ResizeObserver(() => {
      root.style.setProperty('--ed-h', `${sheet.current?.offsetHeight ?? 0}px`);
      place();
      reveal();
    });
    if (sheet.current) ro.observe(sheet.current);
    if (wrap.current) ro.observe(wrap.current);
    window.addEventListener('resize', place);
    place();
    const vv = window.visualViewport;
    const kb = () => {
      if (!vv) return;
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--kb', `${hidden > 60 ? hidden : 0}px`);
    };
    vv?.addEventListener('resize', kb);
    vv?.addEventListener('scroll', kb);
    kb();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      vv?.removeEventListener('resize', kb);
      vv?.removeEventListener('scroll', kb);
      for (const v of ['--ed-h', '--kb', '--ed-left', '--ed-w']) root.style.removeProperty(v);
    };
  }, [editing, reveal]);

  const onBarClick = (index: number, tick: number, e: React.MouseEvent) => {
    if (!editing) setEditing(true);
    if ((e.shiftKey || rangeMode) && sel && editing) return select(Math.min(sel.from, index), Math.max(sel.to, index));
    const target = eventAt(chart.bars[index], tick);
    lastTick.current = target.at;
    select(index, index, target.id);
  };

  const ctx: EdCtx | null =
    sel && bar && ev
      ? {
          chart, meters, sel, i, bar, m, ev, multi: sel.from !== sel.to,
          apply, select, goEvent, flats: p.flats, chordStyle: p.chordStyle,
          step: gridStep(m, grid), grid, setGrid,
          canComment: p.canComment, onComment: p.onComment, inputRef,
          note: (t) => toast(t, 'warn'),
        }
      : null;

  // ---- Keyboard and paste (laptops) ----
  useEffect(() => {
    if (!editing || !editable || p.locked) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        return e.shiftKey ? p.redo() : p.undo();
      }
      if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        return p.redo();
      }
      if (typing) return;
      if (e.key === 'Escape') return setEditing(false);
      if (!sel || !ctx) return;
      if (mod && e.key === 'd') {
        e.preventDefault();
        apply((c) => duplicateBars(c, sel.from, sel.to));
        return select(sel.to + 1, sel.to + 1 + (sel.to - sel.from));
      }
      if (mod && (e.key === 'c' || e.key === 'x')) {
        e.preventDefault();
        clip.current = structuredClone(chart.bars.slice(sel.from, sel.to + 1));
        navigator.clipboard?.writeText(barsText(clip.current, meters.slice(sel.from, sel.to + 1))).catch(() => {});
        if (e.key === 'x' && sel.to - sel.from + 1 < n) {
          apply((c) => deleteBars(c, sel.from, sel.to));
          select(Math.min(sel.from, n - (sel.to - sel.from + 1) - 1));
        }
        return;
      }
      if (mod) return;
      const row = (d: 1 | -1) => {
        const r = rows.findIndex((x) => x.items.some((it) => it.kind === 'bar' && it.index === i));
        const item = rows[r]?.items.find((it) => it.kind === 'bar' && it.index === i);
        const target = rows[r + d];
        if (!item || item.kind !== 'bar' || !target) return i;
        let best = i;
        let dist = Infinity;
        for (const it of target.items) {
          if (it.kind === 'bar' && Math.abs(it.start - item.start) < dist) {
            dist = Math.abs(it.start - item.start);
            best = it.index;
          }
        }
        return best;
      };
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowLeft': {
          e.preventDefault();
          const d = e.key === 'ArrowRight' ? 1 : -1;
          if (e.shiftKey) return select(d > 0 ? sel.from : Math.max(0, sel.from - 1), d > 0 ? Math.min(n - 1, sel.to + 1) : sel.to);
          return goEvent(d);
        }
        case 'ArrowDown':
        case 'ArrowUp':
          e.preventDefault();
          return select(row(e.key === 'ArrowDown' ? 1 : -1));
        case 'Enter':
          e.preventDefault();
          setTab('chord');
          return requestAnimationFrame(() => inputRef.current?.select());
        case 'Backspace':
        case 'Delete':
          e.preventDefault();
          return apply((c) => removeEvent(c, i, ctx.ev.id));
        case 'r':
          return quickKind(ctx, 'rest');
        case 'n':
          return quickKind(ctx, 'nc');
        case 's':
          return apply((c) => splitEvent(c, i, ctx.ev.id, 2));
      }
      // A chord letter starts a chord: move focus to the field now, so the key itself lands there.
      if (e.key.length === 1 && /[A-Ga-g]/.test(e.key) && !ctx.multi) {
        setTab('chord');
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || !sel) return;
      const text = (e.clipboardData?.getData('text/plain') ?? '').trim();
      if (!text) return;
      e.preventDefault();
      const at = sel.to + 1;
      const own = clip.current && barsText(clip.current, metersOf({ bars: clip.current })) === text;
      if (own) {
        const k = clip.current!.length;
        apply((c) => insertCopies(c, at, clip.current!));
        return select(at, at + k - 1);
      }
      const parsed = parseProgression(text, () => meters[Math.min(sel.to, meters.length - 1)]);
      if (!parsed.length) return;
      apply((c) => {
        let out = insertBars(c, at, parsed.length);
        parsed.forEach((b, k) => (out = replaceEvents(out, at + k, b.events.map((x) => ({ ...x })), b.simile)));
        return out;
      });
      select(at, at + parsed.length - 1);
      const flags = parsed.flatMap((b, k) => b.flags.map((f) => `bar ${at + 1 + k}: ${f}`));
      if (flags.length) toast(`Pasted — check ${flags.join('; ')}`, 'warn');
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
    };
  });

  const where = sel && ev
    ? sel.from !== sel.to
      ? `Bars ${sel.from + 1}–${sel.to + 1}`
      : `Bar ${sel.from + 1}${ev.at ? `, ${positionLabel(ev.at, m)}` : ''}${ev.ch ? ` · ${chordText(ev.ch)}` : ev.kind === 'rest' ? ' · rest' : ev.kind === 'nc' ? ' · N.C.' : ''}`
    : 'Tap a bar to edit it';

  return (
    <div className={`ifp-editor ${editing ? 'is-editing' : ''}`} ref={wrap}>
      <ChartView
        {...p.view}
        chart={chart}
        chordStyle={p.chordStyle}
        selection={editing ? sel : null}
        onBarClick={editable || editing ? onBarClick : undefined}
        barNumbers={editing}
        beatGrid={editing && tab === 'rhythm'}
        className={editing ? 'chart-editing' : ''}
      />

      {editing && (
        <div className="ed-sheet" ref={sheet} role="region" aria-label="Chart editor">
          <div className="ed-head">
            <button className="ed-icon" onClick={() => goEvent(-1)} disabled={!ctx || (i === 0 && bar?.events[0].id === ev?.id)} aria-label="Previous chord">‹</button>
            <div className="ed-where" aria-live="polite">{where}</div>
            <button className="ed-icon" onClick={() => goEvent(1)} disabled={!ctx} aria-label="Next chord">›</button>
            <span className="ed-spacer" />
            <button className="ed-icon" onClick={p.undo} disabled={!p.canUndo} aria-label="Undo" title="Undo (⌘Z)">↶</button>
            <button className="ed-icon" onClick={p.redo} disabled={!p.canRedo} aria-label="Redo" title="Redo (⇧⌘Z)">↷</button>
            <button className="ed-done" onClick={() => setEditing(false)}>Done</button>
          </div>

          {p.locked ? (
            <div className="ed-locked">
              <span>{p.locked.reason}</span>
              {p.locked.fix && (
                <button className="ed-btn primary" onClick={p.locked.fix.run}>
                  {p.locked.fix.label}
                </button>
              )}
            </div>
          ) : !ctx ? (
            <div className="ed-empty">
              <p>Tap any bar to edit its chords, or type a whole progression.</p>
              <div className="ed-row">
                <button className="ed-btn primary" onClick={() => { select(0, n - 1); setTab('type'); }}>Type chords</button>
                <button className="ed-btn" onClick={() => { apply((c) => insertBars(c, n, 4)); select(n); }}>+ 4 bars</button>
              </div>
            </div>
          ) : (
            <>
              {!ctx.multi && (
                <Timeline
                  bar={ctx.bar}
                  m={ctx.m}
                  selected={ctx.ev.id}
                  onSelect={(id) => select(i, i, id)}
                  rhythm={tab === 'rhythm'}
                  step={ctx.step}
                  chordStyle={p.chordStyle}
                  onMoveBoundary={(b, tick) => apply((c) => moveBoundary(c, i, b, tick, ctx.step), `boundary:${ctx.bar.id}:${b}`)}
                  onInsertAt={(tick) => {
                    const id = addAt(ctx, tick);
                    if (id) select(i, i, id);
                  }}
                />
              )}
              <div className="ed-tabs" role="tablist" aria-label="Editor panels">
                {([['chord', 'Chord'], ['rhythm', 'Rhythm'], ['bars', ctx.multi ? `Bars (${sel!.to - sel!.from + 1})` : 'Bar'], ['type', 'Type']] as [Tab, string][]).map(([t, label]) => (
                  <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} disabled={ctx.multi && (t === 'chord' || t === 'rhythm')}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="ed-panel" role="tabpanel">
                {tab === 'chord' && !ctx.multi && <ChordPanel c={ctx} />}
                {tab === 'rhythm' && !ctx.multi && <RhythmPanel c={ctx} />}
                {(tab === 'bars' || (ctx.multi && (tab === 'chord' || tab === 'rhythm'))) && <BarsPanel c={ctx} rangeMode={rangeMode} setRangeMode={setRangeMode} />}
                {tab === 'type' && <TypePanel c={ctx} />}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
