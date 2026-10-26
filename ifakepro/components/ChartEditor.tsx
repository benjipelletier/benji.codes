'use client';

// The chart with editing on top: select bars, type a bar's chords in one go
// ("C-7 F7", Enter for the next bar), and a toolbar for barlines, repeats,
// endings, sections, time signatures and marks. Works with a keyboard on a
// laptop and with taps and a docked entry bar on a phone.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent } from 'react';
import { type Chart, layout } from '@ifakepro/lib/chart';
import { type ChordStyle, barToText, parseBarText } from '@ifakepro/lib/chords';
import {
  barsToText, clearBarlines, clearChords, deleteBars, insertBars, insertCopies, patchBar, patchCell, setCellCount, setCells, textToBars, toggleWrap,
} from '@ifakepro/lib/edit';
import type { Bar } from '@ifakepro/lib/chart';
import { ChartView, type ChartViewProps, type Selection } from './ChartView';

export interface EditorProps {
  chart: Chart;
  change: (fn: (c: Chart) => Chart) => void;
  sel: Selection | null;
  setSel: (s: Selection | null) => void;
  editable: boolean;
  /** Why editing is off, shown in place of the toolbar (e.g. while transposed). */
  lockedReason?: string | null;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canComment: boolean;
  onComment: (barId: string) => void;
  chordStyle: ChordStyle;
  view: Omit<ChartViewProps, 'chart' | 'selection' | 'onBarClick' | 'chordStyle'>;
}

const SECTIONS = [
  ['', 'Section'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['i', 'Intro'], ['V', 'Verse'],
] as const;
const TIMES = ['4/4', '3/4', '2/4', '5/4', '6/4', '7/4', '2/2', '3/2', '3/8', '5/8', '6/8', '7/8', '9/8', '12/8'];
const QUICK: [string, string][] = [
  ['♭', 'b'], ['♯', '#'], ['–', '-'], ['△', '^'], ['ø', 'h'], ['°', 'o'], ['7', '7'], ['9', '9'], ['/', '/'], ['(', '('], [')', ')'], ['%', '%'], ['·', '.'],
];

let clipboard: { text: string; bars: Bar[] } | null = null;

export function ChartEditor(p: EditorProps) {
  const { chart, change, sel, setSel, editable } = p;
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rangeMode, setRangeMode] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const rows = useMemo(() => layout(chart), [chart]);

  const bar = sel ? chart.bars[sel.from] : null;
  const single = sel && sel.from === sel.to;
  const from = sel?.from ?? 0;
  const to = sel?.to ?? 0;

  // The entry shows the selected bar's chords; reset whenever another bar is picked or the bar changes under us.
  const barKey = bar ? `${bar.id}:${barToText(bar.cells)}` : '';
  useEffect(() => {
    setText(bar ? barToText(bar.cells) : '');
    setError(null);
  }, [barKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (i: number, extend = false, cell: number | null = null) => {
    const n = chart.bars.length;
    const j = Math.max(0, Math.min(n - 1, i));
    if (extend && sel) {
      const anchor = sel.from === j ? sel.to : sel.from < j ? sel.from : sel.to;
      setSel({ from: Math.min(anchor, j), to: Math.max(anchor, j), cell: null });
    } else setSel({ from: j, to: j, cell });
  };

  /** Write the entry into the bar. Returns false if something couldn't be read. */
  const commit = (): boolean => {
    if (!bar || !editable) return true;
    if (text.trim() === barToText(bar.cells)) return true;
    const parsed = parseBarText(text, bar.cells);
    if (parsed.errors.length) {
      setError(`Can’t read ${parsed.errors.map((e) => `“${e}”`).join(', ')}`);
      return false;
    }
    const id = bar.id;
    change((c) => {
      const i = c.bars.findIndex((b) => b.id === id);
      return i < 0 ? c : setCells(c, i, parsed.cells);
    });
    return true;
  };

  const moveEntry = (delta: number) => {
    if (!commit()) return;
    const next = from + delta;
    if (next >= chart.bars.length && delta > 0) {
      // Past the end: grow the chart, like iReal.
      change((c) => insertBars(c, c.bars.length, 1, bar?.cells.length ?? 4));
    }
    setSel({ from: Math.max(0, next), to: Math.max(0, next), cell: 0 });
    requestAnimationFrame(() => input.current?.select());
  };

  const focusEntry = (initial?: string) => {
    setEntryOpen(true);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      if (initial !== undefined) {
        setText(initial);
        requestAnimationFrame(() => el.setSelectionRange(initial.length, initial.length));
      } else el.select();
    });
  };

  // ---- Toolbar actions over the selection ----
  const act = (fn: (c: Chart) => Chart) => {
    if (!sel || !editable) return;
    commit();
    change(fn);
  };
  const firstCell = sel?.cell ?? 0;
  const cellOf = bar?.cells[Math.min(firstCell, (bar?.cells.length ?? 1) - 1)];

  const toggleCellMark = (k: 'segno' | 'coda' | 'fermata') => act((c) => patchCell(c, from, Math.min(firstCell, c.bars[from].cells.length - 1), { [k]: !cellOf?.[k] }));
  const setText_ = () => {
    const t = window.prompt('Text above this beat (e.g. “D.C. al Coda”, “Fine”, “Solos”) — empty to remove', cellOf?.text?.replace(/^\*\d\d/, '') ?? '');
    if (t === null) return;
    act((c) => patchCell(c, from, Math.min(firstCell, c.bars[from].cells.length - 1), { text: t.trim() || undefined }));
  };
  const toggleSmall = () => {
    const on = !chart.bars.slice(from, to + 1).some((b) => b.cells.some((x) => x.small));
    act((c) => {
      let out = c;
      for (let i = from; i <= to; i++) out.bars[i].cells.forEach((x, j) => {
        if (x.ch || x.sym === 'p') out = patchCell(out, i, j, { small: on });
      });
      return out;
    });
  };
  const copy = (cut: boolean) => {
    if (!sel) return;
    const bars = chart.bars.slice(from, to + 1);
    const t = barsToText(bars);
    clipboard = { text: t, bars: structuredClone(bars) };
    navigator.clipboard?.writeText(t).catch(() => {});
    if (cut && editable) {
      change((c) => deleteBars(c, from, to));
      const at = Math.max(0, Math.min(from, chart.bars.length - (to - from + 1) - 1));
      setSel({ from: at, to: at, cell: null });
    }
  };
  const paste = (t: string) => {
    if (!editable) return;
    const bars = clipboard && clipboard.text === t ? clipboard.bars : textToBars(t);
    if (!bars?.length) return;
    const at = sel ? to + 1 : chart.bars.length;
    change((c) => insertCopies(c, at, bars));
    setSel({ from: at, to: at + bars.length - 1, cell: null });
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!wrap.current?.contains(document.activeElement) || document.activeElement === input.current) return;
      const t = e.clipboardData?.getData('text/plain');
      if (t) {
        e.preventDefault();
        paste(t);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  /** The bar above or below at about the same place in the row. */
  const vertical = (i: number, dir: 1 | -1) => {
    const r = rows.findIndex((row) => row.items.some((it) => it.kind === 'bar' && it.index === i));
    const item = rows[r]?.items.find((it) => it.kind === 'bar' && it.index === i);
    const target = rows[r + dir];
    if (!item || item.kind !== 'bar' || !target) return i;
    let best = i;
    let dist = Infinity;
    for (const it of target.items) {
      if (it.kind !== 'bar') continue;
      const d = Math.abs(it.start - item.start);
      if (d < dist) {
        dist = d;
        best = it.index;
      }
    }
    return best;
  };

  const onKey = (e: RKeyboardEvent) => {
    if (e.target === input.current) return;
    const mod = e.metaKey || e.ctrlKey;
    const n = chart.bars.length;
    const cur = sel ? (e.shiftKey ? (sel.to > sel.from ? sel.to : sel.from) : sel.from) : -1;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) p.redo();
      else p.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      p.redo();
      return;
    }
    if (mod && (e.key === 'c' || e.key === 'x')) {
      e.preventDefault();
      copy(e.key === 'x');
      return;
    }
    if (mod && e.key === 'd' && sel && editable) {
      e.preventDefault();
      change((c) => insertCopies(c, to + 1, c.bars.slice(from, to + 1)));
      return;
    }
    if (mod && e.key === 'a') {
      e.preventDefault();
      setSel({ from: 0, to: n - 1, cell: null });
      return;
    }
    if (mod) return;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowLeft':
        e.preventDefault();
        select(cur < 0 ? 0 : cur + (e.key === 'ArrowRight' ? 1 : -1), e.shiftKey);
        return;
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        select(cur < 0 ? 0 : vertical(cur, e.key === 'ArrowDown' ? 1 : -1), e.shiftKey);
        return;
      case 'Home':
        select(0, e.shiftKey);
        return;
      case 'End':
        select(n - 1, e.shiftKey);
        return;
      case 'Escape':
        setSel(null);
        return;
      case 'Enter':
      case 'F2':
        if (sel && editable) {
          e.preventDefault();
          focusEntry();
        }
        return;
      case 'Backspace':
      case 'Delete':
        if (sel && editable) {
          e.preventDefault();
          change((c) => clearChords(c, from, to));
        }
        return;
    }
    if (sel && editable && e.key.length === 1 && /[A-Ga-g/%.nN]/.test(e.key)) {
      e.preventDefault();
      focusEntry(e.key.toUpperCase() === e.key ? e.key : e.key.toUpperCase());
    }
  };

  const onEntryKey = (e: RKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      moveEntry(1);
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      moveEntry(-1);
    } else if (e.key === '|') {
      e.preventDefault();
      moveEntry(1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setText(bar ? barToText(bar.cells) : '');
      setEntryOpen(false);
      wrap.current?.querySelector<HTMLElement>('.ifp-chart-focus')?.focus();
    }
  };

  const insertQuick = (s: string) => {
    const el = input.current;
    if (!el) return;
    const a = el.selectionStart ?? text.length;
    const b = el.selectionEnd ?? text.length;
    const next = text.slice(0, a) + s + text.slice(b);
    setText(next);
    setError(null);
    requestAnimationFrame(() => el.setSelectionRange(a + s.length, a + s.length));
  };

  const pointer = (i: number, cell: number, e: React.MouseEvent) => {
    if (sel && entryOpen) commit();
    const extend = e.shiftKey || (rangeMode && !!sel);
    select(i, extend, extend ? null : cell);
    // A tap opens the entry (and the keyboard) straight away; with a mouse it takes a double-click or typing.
    const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch' || (e.nativeEvent as PointerEvent).pointerType === 'pen';
    if (!extend && editable && (touch || e.detail >= 2)) focusEntry();
  };

  const allSmall = sel ? chart.bars.slice(from, to + 1).some((b) => b.cells.some((x) => x.small)) : false;
  const last = chart.bars[to];

  return (
    <div className="ifp-editor" ref={wrap}>
      {editable && (
        <div className="ifp-toolbar" role="toolbar" aria-label="Chart tools">
          <div className="tb-group">
            <button className="tb" onClick={p.undo} disabled={!p.canUndo} title="Undo (⌘Z)" aria-label="Undo">↶</button>
            <button className="tb" onClick={p.redo} disabled={!p.canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">↷</button>
          </div>
          <div className="tb-group">
            <button className="tb" disabled={!sel} onClick={() => act((c) => insertBars(c, to + 1, 1, c.bars[to].cells.length))} title="Add a bar after">＋ Bar</button>
            <button className="tb" disabled={!sel} onClick={() => act((c) => insertCopies(c, to + 1, c.bars.slice(from, to + 1)))} title="Duplicate (⌘D)">Dup</button>
            <button
              className="tb"
              disabled={!sel}
              onClick={() => {
                act((c) => deleteBars(c, from, to));
                setSel({ from: Math.max(0, from - 1), to: Math.max(0, from - 1), cell: null });
              }}
              title="Delete bars"
            >
              Del
            </button>
            <button className={`tb tb-range ${rangeMode ? 'on' : ''}`} onClick={() => setRangeMode((r) => !r)} aria-pressed={rangeMode} title="Tap a second bar to select a range">
              Range
            </button>
          </div>
          <div className="tb-group">
            <select className="tb-select" disabled={!sel} value={bar?.section ?? ''} onChange={(e) => act((c) => patchBar(c, from, { section: e.target.value || undefined }))} aria-label="Section">
              {SECTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select className="tb-select" disabled={!sel} value={bar?.time ?? ''} onChange={(e) => act((c) => patchBar(c, from, { time: e.target.value || undefined }))} aria-label="Time signature">
              <option value="">Time</option>
              {TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              className="tb-select"
              disabled={!sel}
              value={bar?.ending != null ? String(bar.ending) : ''}
              onChange={(e) => act((c) => patchBar(c, from, { ending: e.target.value === '' ? undefined : Number(e.target.value) }))}
              aria-label="Ending"
            >
              <option value="">Ending</option>
              <option value="1">1st</option>
              <option value="2">2nd</option>
              <option value="3">3rd</option>
            </select>
          </div>
          <div className="tb-group">
            <button className={`tb sym ${bar?.open === '{' && last?.close === '}' ? 'on' : ''}`} disabled={!sel} onClick={() => act((c) => toggleWrap(c, from, to, '{', '}'))} title="Repeat the selected bars">𝄆 𝄇</button>
            <button className={`tb ${bar?.open === '[' && last?.close === ']' ? 'on' : ''}`} disabled={!sel} onClick={() => act((c) => toggleWrap(c, from, to, '[', ']'))} title="Double barlines around the selection">‖ ‖</button>
            <button className={`tb sym ${last?.close === 'Z' ? 'on' : ''}`} disabled={!sel} onClick={() => act((c) => patchBar(c, to, { close: c.bars[to].close === 'Z' ? undefined : 'Z' }))} title="Final barline">𝄂</button>
            <button className="tb" disabled={!sel} onClick={() => act((c) => clearBarlines(c, from, to))} title="Plain barlines">| |</button>
          </div>
          <div className="tb-group">
            <button className={`tb sym ${cellOf?.segno ? 'on' : ''}`} disabled={!sel} onClick={() => toggleCellMark('segno')} title="Segno">𝄋</button>
            <button className={`tb sym ${cellOf?.coda ? 'on' : ''}`} disabled={!sel} onClick={() => toggleCellMark('coda')} title="Coda">𝄌</button>
            <button className={`tb sym ${cellOf?.fermata ? 'on' : ''}`} disabled={!sel} onClick={() => toggleCellMark('fermata')} title="Fermata">𝄐</button>
            <button className={`tb ${cellOf?.text ? 'on' : ''}`} disabled={!sel} onClick={setText_} title="Text above the beat">Text</button>
            <button className={`tb ${allSmall ? 'on' : ''}`} disabled={!sel} onClick={toggleSmall} title="Small chords (pushes, passing chords)">small</button>
          </div>
          <div className="tb-group">
            <select className="tb-select" disabled={!sel} value={single && bar ? String(bar.cells.length) : ''} onChange={(e) => act((c) => setCellCount(c, from, to, Number(e.target.value)))} aria-label="Beats per bar" title="Cells in the bar">
              {!single && <option value="">Cells</option>}
              {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n} cells</option>)}
            </select>
            <button className={`tb ${bar?.br ? 'on' : ''}`} disabled={!sel} onClick={() => act((c) => patchBar(c, from, { br: c.bars[from].br ? undefined : true }))} title="Start a new line at this bar">⏎ Line</button>
          </div>
          {p.canComment && (
            <div className="tb-group">
              <button className="tb" disabled={!sel} onClick={() => bar && p.onComment(bar.id)} title="Comment on this bar">💬 Comment</button>
            </div>
          )}
        </div>
      )}
      {!editable && p.lockedReason && <div className="ifp-locked">{p.lockedReason}</div>}
      {!editable && p.canComment && sel && bar && (
        <div className="ifp-toolbar">
          <div className="tb-group">
            <button className="tb" onClick={() => p.onComment(bar.id)}>💬 Comment on bar {from + 1}</button>
          </div>
        </div>
      )}

      <div className="ifp-chart-focus" tabIndex={0} onKeyDown={onKey} aria-label="Chart. Arrow keys move between bars; type to enter chords.">
        <ChartView {...p.view} chart={chart} chordStyle={p.chordStyle} selection={sel} onBarClick={pointer} barNumbers={editable} />
      </div>

      {editable && sel && single && bar && (
        <div className={`ifp-entry ${entryOpen ? 'open' : ''}`}>
          <div className="entry-row">
            <span className="entry-label">Bar {from + 1}</span>
            <button className="entry-nav" onPointerDown={(e) => e.preventDefault()} onClick={() => moveEntry(-1)} aria-label="Previous bar" disabled={from === 0}>‹</button>
            <input
              ref={input}
              className={`entry-input ${error ? 'bad' : ''}`}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              onFocus={() => setEntryOpen(true)}
              onBlur={(e) => {
                if (e.relatedTarget && (e.relatedTarget as HTMLElement).closest('.ifp-entry')) return;
                commit();
                setEntryOpen(false);
              }}
              onKeyDown={onEntryKey}
              placeholder="C-7 F7"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="next"
              aria-label={`Chords in bar ${from + 1}`}
            />
            <button className="entry-nav entry-next" onPointerDown={(e) => e.preventDefault()} onClick={() => moveEntry(1)}>Next ›</button>
          </div>
          <div className="entry-keys" onPointerDown={(e) => e.preventDefault()}>
            {QUICK.map(([label, ins]) => (
              <button key={label} tabIndex={-1} onClick={() => insertQuick(ins)}>{label}</button>
            ))}
            <button tabIndex={-1} onClick={() => insertQuick(' ')} className="wide">space</button>
          </div>
          <div className="entry-help">
            {error ?? (
              <>
                Chords with spaces: <code>Cm7 F7</code> · <code>.</code> empty beat · <code>%</code> repeat bar · <code>C7(Db7)</code> alternate · Enter for the next bar. Stored the iReal way: <code>-</code> minor, <code>^</code> maj7, <code>h</code> ø, <code>o</code> dim.
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
