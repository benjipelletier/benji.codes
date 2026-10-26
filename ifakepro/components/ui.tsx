'use client';

// Small shared pieces: the viewer, toasts, avatars, dialogs, tabs.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, personColor } from '@ifakepro/lib/client';
import type { Person, Viewer } from '@ifakepro/lib/types';

// ---- Viewer ----

const ViewerCtx = createContext<{ viewer: Viewer | null; refresh: () => void }>({ viewer: null, refresh: () => {} });

export function useViewer() {
  return useContext(ViewerCtx);
}

// ---- Toasts ----

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error';
}
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function Providers({ children }: { children: ReactNode }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const refresh = useCallback(() => {
    api<Viewer>('/viewer').then(setViewer).catch(() => setViewer({ user: null, isAdmin: false }));
  }, []);
  useEffect(refresh, [refresh]);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'info' ? 3500 : 7000);
  }, []);

  return (
    <ViewerCtx.Provider value={{ viewer, refresh }}>
      <ToastCtx.Provider value={toast}>
        {children}
        <div className="ifp-toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`ifp-toast ifp-toast-${t.tone}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              {t.text}
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </ViewerCtx.Provider>
  );
}

// ---- Avatars ----

export function Avatar({ person, size = 24, ring }: { person: Person; size?: number; ring?: boolean }) {
  const initials = person.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const style = { width: size, height: size, fontSize: size * 0.42, background: personColor(person.id), ...(ring ? { boxShadow: `0 0 0 2px var(--paper), 0 0 0 4px ${personColor(person.id)}` } : {}) };
  return person.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="ifp-avatar" src={person.image} alt={person.name} title={person.name} style={style} referrerPolicy="no-referrer" />
  ) : (
    <span className="ifp-avatar" title={person.name} style={style}>
      {initials}
    </span>
  );
}

// ---- Dialog: centered on wide screens, a bottom sheet on phones ----

export function Dialog({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('ifp-noscroll');
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button.primary')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('ifp-noscroll');
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="ifp-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`ifp-dialog ${wide ? 'ifp-dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="ifp-dialog-head">
          <h2>{title}</h2>
          <button className="ifp-icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="ifp-dialog-body">{children}</div>
        {footer && <div className="ifp-dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="ifp-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Menu({ label, children, align = 'right' }: { label: ReactNode; children: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="ifp-menu" ref={ref}>
      <button className="ifp-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className={`ifp-menu-pop ifp-menu-${align}`} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="ifp-loading">
      <span className="ifp-spin" aria-hidden /> {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ifp-empty">{children}</div>;
}
