'use client';

// Adding songs (from iReal Pro, from the standards, or blank) — also used to
// start a new playlist — and sharing a playlist.

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ALL_KEYS } from '@ifakepro/lib/chords';
import { api, copyText, displayKey, timeAgo } from '@ifakepro/lib/client';
import type { Chart, SongMeta } from '@ifakepro/lib/chart';
import type { ImportPreview, PlaylistDetail, StandardHit } from '@ifakepro/lib/types';
import { ChartView } from './ChartView';
import { Avatar, Dialog, Empty, Spinner, Tabs, useToast } from './ui';

type Source = 'ireal' | 'standards' | 'blank';

/**
 * mode "create": a new playlist (title, visibility), optionally starting with songs.
 * mode "add": add songs to the playlist `slug`.
 */
export function AddSongsDialog({ mode, slug, onClose, onDone, initial = 'ireal' }: { mode: 'create' | 'add'; slug?: string; onClose: () => void; onDone?: () => void; initial?: Source }) {
  const toast = useToast();
  const router = useRouter();
  const [source, setSource] = useState<Source>(initial);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const loadFile = async (f: File) => {
    setFileName(f.name);
    await readPreview(await f.text());
  };
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public');
  const [busy, setBusy] = useState(false);

  // iReal
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const file = useRef<HTMLInputElement>(null);

  // Standards
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<StandardHit[] | null>(null);
  const [picked, setPicked] = useState<Map<number, StandardHit>>(new Map());
  const [peek, setPeek] = useState<{ meta: SongMeta; chart: Chart } | null>(null);

  // Blank
  const [blankTitle, setBlankTitle] = useState('');
  const [blankKey, setBlankKey] = useState('C');

  useEffect(() => {
    if (source !== 'standards') return;
    const t = setTimeout(() => {
      api<{ results: StandardHit[] }>(`/standards?q=${encodeURIComponent(q)}`).then((r) => setHits(r.results)).catch(() => setHits([]));
    }, 180);
    return () => clearTimeout(t);
  }, [q, source]);

  const readPreview = async (t: string) => {
    setText(t);
    setPreview(null);
    if (!t.trim()) return;
    try {
      const p = await api<ImportPreview>('/import', { body: { text: t } });
      setPreview(p);
      setInclude(new Set(p.songs.map((_, i) => i)));
      if (mode === 'create' && !title && p.name) setTitle(p.name);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that', 'error');
    }
  };

  const payload = (): Record<string, unknown> | null => {
    if (source === 'ireal') return preview && include.size ? { ireal: text, include: [...include] } : null;
    if (source === 'standards') return picked.size ? { standards: [...picked.keys()] } : null;
    if (mode === 'add') return { blank: { title: blankTitle.trim() || 'Untitled', key: blankKey } };
    return {};
  };

  const submit = async () => {
    const body = payload();
    if (mode === 'add' && !body) return;
    setBusy(true);
    try {
      if (mode === 'create') {
        if (!title.trim()) {
          toast('Give the playlist a title', 'warn');
          return;
        }
        const r = await api<{ slug: string }>('/playlists', { body: { title, visibility, ...(body ?? {}) } });
        router.push(`/ifakepro/p/${r.slug}`);
      } else {
        const r = await api<{ ids: string[] }>(`/playlists/${slug}/songs`, { body: body! });
        if (source === 'blank') router.push(`/ifakepro/p/${slug}/s/${r.ids[0]}`);
        else toast(`Added ${r.ids.length} song${r.ids.length === 1 ? '' : 's'}`);
        onDone?.();
      }
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  };

  const count = source === 'ireal' ? include.size : source === 'standards' ? picked.size : 1;
  const action =
    mode === 'create'
      ? count && source !== 'blank' ? `Create with ${count} song${count === 1 ? '' : 's'}` : 'Create playlist'
      : source === 'blank' ? 'Create song' : `Add ${count || ''} song${count === 1 ? '' : 's'}`;

  return (
    <Dialog
      title={mode === 'create' ? 'New playlist' : 'Add songs'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="ifp-btn" onClick={onClose}>Cancel</button>
          <button className="ifp-btn primary" disabled={busy || (mode === 'add' && !payload()) || (mode === 'create' && !title.trim())} onClick={submit}>
            {busy ? 'Working…' : action}
          </button>
        </>
      }
    >
      {mode === 'create' && (
        <div className="form">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Friday at the Lodge" />
          </label>
          <div className="seg">
            <button className={visibility === 'public' ? 'on' : ''} onClick={() => setVisibility('public')}>Public — listed on iFake Pro</button>
            <button className={visibility === 'unlisted' ? 'on' : ''} onClick={() => setVisibility('unlisted')}>Unlisted — link only</button>
          </div>
        </div>
      )}
      <Tabs<Source>
        tabs={[
          { id: 'ireal', label: 'Upload from iReal Pro' },
          { id: 'standards', label: 'Standards' },
          { id: 'blank', label: mode === 'create' ? 'Start empty' : 'Blank chart' },
        ]}
        value={source}
        onChange={setSource}
      />

      {source === 'blank' && mode === 'create' && <p className="muted">Start with no songs; add them from the playlist page.</p>}

      {source === 'blank' && mode === 'add' && (
        <div className="form">
          <label>Title<input value={blankTitle} onChange={(e) => setBlankTitle(e.target.value)} placeholder="New tune" /></label>
          <label>
            Key
            <select value={blankKey} onChange={(e) => setBlankKey(e.target.value)}>
              {ALL_KEYS.map((k) => <option key={k} value={k}>{displayKey(k)}</option>)}
            </select>
          </label>
          <p className="muted">Starts as 16 empty bars of 4/4.</p>
        </div>
      )}

      {source === 'ireal' && (
        <div className="form">
          <div
            className={`dropzone ${dragging ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) await loadFile(f);
              else {
                setFileName(null);
                await readPreview(e.dataTransfer.getData('text/plain'));
              }
            }}
          >
            <input ref={file} type="file" accept=".html,.htm,.txt,text/html,text/plain" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await loadFile(f);
              e.target.value = '';
            }} />
            <button className="ifp-btn primary" onClick={() => file.current?.click()}>⇪ Upload iReal Pro file</button>
            <span className="muted small">{fileName ? <>Loaded <b>{fileName}</b></> : 'or drop it here · the .html file iReal Pro shares'}</span>
          </div>
          <label>
            …or paste an iReal Pro link
            <textarea
              rows={2}
              value={fileName ? '' : text}
              onChange={(e) => {
                setFileName(null);
                readPreview(e.target.value);
              }}
              placeholder="irealb://…"
              spellCheck={false}
            />
          </label>
          <details className="howto">
            <summary>How do I get my charts out of iReal Pro?</summary>
            <p>
              In iReal Pro, open a playlist (or a song), tap <b>Share</b>, and choose the <b>iReal Pro</b> format (HTML). Send it to yourself or
              save it to Files, then upload it here. A copied <code>irealb://</code> link works too. Each song becomes your own editable chart.
            </p>
          </details>
          {preview && (
            <div className="pick-wrap">
              <div className="pick-head">
                <b>{preview.name ?? 'Songs'}</b> · {preview.songs.length} song{preview.songs.length === 1 ? '' : 's'}
                <button className="ifp-link" onClick={() => setInclude(include.size === preview.songs.length ? new Set() : new Set(preview.songs.map((_, i) => i)))}>
                  {include.size === preview.songs.length ? 'Select none' : 'Select all'}
                </button>
              </div>
              <div className="pick-list scroll">
                {preview.songs.map((s, i) => (
                  <label key={i} className="pick">
                    <input type="checkbox" checked={include.has(i)} onChange={() => {
                      const n = new Set(include);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      setInclude(n);
                    }} />
                    <span className="pick-text">
                      <b>{s.title}</b>
                      <span>{[s.composer, s.style, displayKey(s.key)].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                ))}
              </div>
              {preview.failed.length > 0 && <p className="muted">Couldn’t read: {preview.failed.map((f) => f.title).join(', ')}</p>}
            </div>
          )}
        </div>
      )}

      {source === 'standards' && (
        <div className="form">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 1,460 standards by title, composer or style" autoFocus />
          {picked.size > 0 && (
            <div className="chips">
              {[...picked.values()].map((h) => (
                <button key={h.index} className="chip" onClick={() => {
                  const n = new Map(picked);
                  n.delete(h.index);
                  setPicked(n);
                }}>
                  {h.title} ✕
                </button>
              ))}
            </div>
          )}
          {!hits ? (
            <Spinner />
          ) : !hits.length ? (
            <Empty>No standards match.</Empty>
          ) : (
            <div className="pick-list scroll">
              {hits.map((h) => (
                <div key={h.index} className={`pick ${picked.has(h.index) ? 'on' : ''}`}>
                  <label>
                    <input type="checkbox" checked={picked.has(h.index)} onChange={() => {
                      const n = new Map(picked);
                      if (n.has(h.index)) n.delete(h.index);
                      else n.set(h.index, h);
                      setPicked(n);
                    }} />
                    <span className="pick-text">
                      <b>{h.title}</b>
                      <span>{[h.composer, h.style, displayKey(h.key)].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                  <button className="ifp-link" onClick={async () => setPeek(await api(`/standards/${h.index}`))}>Preview</button>
                </div>
              ))}
            </div>
          )}
          <p className="muted">Each pick is copied into the playlist as your own chart to edit; the library itself never changes.</p>
        </div>
      )}

      {peek && (
        <Dialog title={peek.meta.title} onClose={() => setPeek(null)} wide>
          <div className="peek">
            <div className="muted">{[peek.meta.composer, peek.meta.style, displayKey(peek.meta.key)].filter(Boolean).join(' · ')}</div>
            <ChartView chart={peek.chart} />
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}

export function ShareDialog({ playlist, onClose, onChange }: { playlist: PlaylistDetail; onClose: () => void; onChange: (p: PlaylistDetail) => void }) {
  const toast = useToast();
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const viewLink = `${origin}/ifakepro/p/${playlist.slug}`;
  const inviteLink = playlist.inviteToken ? `${viewLink}?invite=${playlist.inviteToken}` : null;
  const owner = playlist.role === 'owner';
  const patch = async (body: object) => {
    try {
      onChange(await api<PlaylistDetail>(`/playlists/${playlist.slug}`, { method: 'PATCH', body }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update', 'error');
    }
  };
  const share = async (url: string, title: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ url, title });
        return;
      } catch {}
    }
    toast((await copyText(url)) ? 'Link copied' : 'Couldn’t copy the link');
  };
  return (
    <Dialog title={`Share “${playlist.title}”`} onClose={onClose}>
      <div className="share">
        <section>
          <h3>View link</h3>
          <p className="muted">Anyone with this link can read the charts{playlist.visibility === 'public' ? ' (it’s also listed on iFake Pro)' : ''}.</p>
          <div className="linkbox">
            <input readOnly value={viewLink} onFocus={(e) => e.target.select()} />
            <button className="ifp-btn small" onClick={() => share(viewLink, playlist.title)}>Share</button>
          </div>
        </section>
        {inviteLink && (
          <section>
            <h3>Invite to edit</h3>
            <p className="muted">Send this to bandmates. They sign in with Google and can then edit charts and comment.</p>
            <div className="linkbox">
              <input readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
              <button className="ifp-btn small primary" onClick={() => share(inviteLink, `Edit ${playlist.title} on iFake Pro`)}>Share</button>
            </div>
            {owner && (
              <button className="ifp-link" onClick={() => window.confirm('Make a new invite link? The old one stops working (people who already joined stay).') && patch({ rotateToken: true })}>
                Reset invite link
              </button>
            )}
          </section>
        )}
        {owner && (
          <section>
            <h3>Visibility</h3>
            <div className="seg">
              <button className={playlist.visibility === 'public' ? 'on' : ''} onClick={() => patch({ visibility: 'public' })}>Public</button>
              <button className={playlist.visibility === 'unlisted' ? 'on' : ''} onClick={() => patch({ visibility: 'unlisted' })}>Unlisted</button>
            </div>
          </section>
        )}
        {playlist.members && (
          <section>
            <h3>People ({playlist.members.length})</h3>
            <ul className="members">
              {playlist.members.map((m) => (
                <li key={m.id}>
                  <Avatar person={m} size={28} />
                  <div>
                    <b>{m.name}</b> <span className="muted">{m.role === 'owner' ? 'owner' : `editor · joined ${timeAgo(m.joinedAt)}`}</span>
                    {m.email && <div className="muted small">{m.email}</div>}
                  </div>
                  {owner && m.role !== 'owner' && (
                    <button className="ifp-link danger" onClick={() => window.confirm(`Remove ${m.name}?`) && patch({ removeMember: m.id })}>Remove</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}
