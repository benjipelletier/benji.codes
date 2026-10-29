'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type SongMeta, sanitizeMeta } from '@ifakepro/lib/chart';
import { ALL_KEYS, type ChordStyle, keyDistance, prefersFlats, transposeKey } from '@ifakepro/lib/chords';
import { api, copyText, displayKey, download, personColor, usePref, when } from '@ifakepro/lib/client';
import { diffCharts, ranges } from '@ifakepro/lib/diff';
import { transposeChart } from '@ifakepro/lib/edit';
import { exportHtml, serializeSong } from '@ifakepro/lib/ireal';
import type { Doc } from '@ifakepro/lib/merge';
import type { CommentDTO, PlaylistSummary, SongDetail, VersionDetail } from '@ifakepro/lib/types';
import { ChartEditor } from './ChartEditor';
import { ChartHead, ChartView, type Selection } from './ChartView';
import { ActivityFeed, CommentsPanel, VersionsPanel } from './Panels';
import { AgentPill, Avatar, Dialog, Menu, Spinner, Tabs, useToast, useViewer } from './ui';
import { useSongSync } from './useSongSync';

export const STYLES = [
  'Medium Swing', 'Medium Up Swing', 'Up Tempo Swing', 'Slow Swing', 'Ballad', 'Jazz Waltz', 'Waltz', 'Bossa Nova', 'Samba', 'Latin', 'Afro',
  'Even 8ths', 'Funk', 'Blues', 'Shuffle', 'R&B', 'Gospel', 'Soul', 'Pop', 'Rock', 'Rock Pop', 'Reggae', 'Country',
];

type PanelTab = 'comments' | 'history' | 'activity';

/** Transposing instruments, by how far their part sits from concert pitch (the short way round). */
const INSTRUMENTS: Record<number, string> = { 2: 'B♭ instruments', [-3]: 'E♭ instruments', [-5]: 'F instruments' };

export function SongPage({ songId }: { songId: string }) {
  const [song, setSong] = useState<SongDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { viewer } = useViewer();
  useEffect(() => {
    setSong(null);
    api<SongDetail>(`/songs/${songId}`).then(setSong).catch((e) => setError(e.message));
  }, [songId, viewer?.user?.id]);
  if (error) return <div className="ifp-page"><p className="ifp-error">{error}</p><Link href="/ifakepro">← iFake Pro</Link></div>;
  if (!song) return <div className="ifp-page"><Spinner /></div>;
  return <SongEditor key={`${song.id}:${song.playlist.role}`} song={song} onReload={() => api<SongDetail>(`/songs/${songId}`).then(setSong)} />;
}

function SongEditor({ song, onReload }: { song: SongDetail; onReload: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [deleted, setDeleted] = useState(song.deleted);
  const member = !!song.playlist.role;
  const [sel, setSel] = useState<Selection | null>(null);
  const [editing, setEditing] = useState(false);
  const [shift, setShift] = useState(0);
  const [chordStyle, setChordStyle] = usePref<ChordStyle>('chordStyle', 'jazz');
  const [preview, setPreview] = useState<VersionDetail | null>(null);
  const [tab, setTab] = useState<PanelTab>('comments');
  const [sheet, setSheet] = useState(false);
  const [comments, setComments] = useState<CommentDTO[] | null>(null);
  const [commentBar, setCommentBar] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'info' | 'export' | 'copy' | null>(null);
  const [lastRemote, setLastRemote] = useState<{ name: string; agent: string | null; bars: number[]; at: number } | null>(null);
  const [barNumbers, setBarNumbers] = usePref<'on' | 'off'>('barNumbers', 'off');
  // The whole chart on one screen, unless the person scrolls instead; editing wants full-size bars.
  const [fitPref, setFitPref] = usePref<'on' | 'off'>('fitChart', 'on');
  const sheetRef = useRef<HTMLDivElement>(null);
  const room = useScreenRoom(fitPref === 'on' && !editing, sheetRef);

  const { viewer } = useViewer();
  const [presBar, setPresBar] = useState<string | null>(null);
  const sync = useSongSync({
    songId: song.id,
    initial: { meta: song.meta, chart: song.chart },
    revision: song.revision,
    canEdit: member && !deleted,
    barId: presBar,
    onConflict: (by, n) => toast(`${by.name} changed ${n === 1 ? 'a bar' : `${n} bars`} you were editing at the same time — kept their version`, 'warn'),
    onRemote: (by, agent, bars) => by && setLastRemote({ name: by.name, agent, bars, at: Date.now() }),
    onDeleted: () => setDeleted(true),
  });
  const { doc } = sync;
  const barId = sel ? doc.chart.bars[sel.from]?.id ?? null : null;

  // Keep the selection on real bars as the chart changes underneath it.
  useEffect(() => {
    if (sel && sel.to >= doc.chart.bars.length) {
      const n = doc.chart.bars.length - 1;
      setSel({ from: Math.min(sel.from, n), to: n, ev: null });
    }
  }, [doc.chart.bars.length, sel]);

  const loadComments = useCallback(() => {
    api<{ comments: CommentDTO[] }>(`/songs/${song.id}/comments`).then((r) => setComments(r.comments)).catch(() => {});
  }, [song.id]);
  useEffect(loadComments, [loadComments, sync.commentsStamp]);

  const pins = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of comments ?? []) if (!c.parentId && !c.resolvedAt && c.barId) out[c.barId] = (out[c.barId] ?? 0) + 1;
    return out;
  }, [comments]);

  const presence = useMemo(() => {
    const out: Record<string, { name: string; color: string }[]> = {};
    for (const p of sync.presence) if (p.barId) (out[p.barId] ??= []).push({ name: p.user.name, color: personColor(p.user.id) });
    return out;
  }, [sync.presence]);

  const viewKey = transposeKey(doc.meta.key, shift);
  const flats = prefersFlats(viewKey);
  // Editors can open the editor any time; while the chart is shown in another key it can't change.
  const editable = member && !deleted && !preview;
  const locked =
    shift !== 0
      ? {
          reason: `You’re viewing it in ${displayKey(viewKey)}. Edit in the written key, ${displayKey(doc.meta.key)} (to move the song itself, tap its title).`,
          fix: { label: `Show in ${displayKey(doc.meta.key)}`, run: () => setShift(0) },
        }
      : null;

  // A brand-new song opens straight into the editor.
  useEffect(() => {
    if (!editable || new URLSearchParams(window.location.search).get('edit') !== '1') return;
    setEditing(true);
    window.history.replaceState(null, '', window.location.pathname);
  }, [editable]);

  const previewChanged = useMemo(() => (preview ? diffCharts(doc.chart, preview.chart).changed : undefined), [preview, doc.chart]);

  const openComment = (id: string) => {
    setCommentBar(id);
    setTab('comments');
    setSheet(true);
  };
  const selectBar = (id: string) => {
    const i = doc.chart.bars.findIndex((b) => b.id === id);
    if (i < 0) return;
    setSel({ from: i, to: i, ev: null });
    setCommentBar(id);
    document.querySelector(`[data-bar="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  useEffect(() => {
    setPresBar(barId);
    if (barId) setCommentBar(barId);
  }, [barId]);

  const remoteRecent = lastRemote && Date.now() - lastRemote.at < 8000;

  const panel = (
    <>
      <Tabs<PanelTab>
        tabs={[
          { id: 'comments', label: `Comments${Object.values(pins).reduce((a, b) => a + b, 0) ? ` (${(comments ?? []).filter((c) => !c.parentId && !c.resolvedAt).length})` : ''}` },
          { id: 'history', label: 'History' },
          { id: 'activity', label: 'Activity' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'comments' && (
        <CommentsPanel
          songId={song.id}
          chart={doc.chart}
          comments={comments}
          setComments={setComments}
          canComment={member}
          focusBar={commentBar}
          setFocusBar={setCommentBar}
          onSelectBar={selectBar}
        />
      )}
      {tab === 'history' && (
        <VersionsPanel
          songId={song.id}
          revision={sync.revision}
          preview={preview}
          setPreview={setPreview}
          canEdit={member && !deleted}
          onRestored={async () => {
            const s = await api<SongDetail>(`/songs/${song.id}`);
            sync.reload({ meta: s.meta, chart: s.chart }, s.revision);
          }}
        />
      )}
      {tab === 'activity' && <div className="ifp-panel"><ActivityFeed query={`song=${song.id}`} showPlaylist={false} showSong={false} refreshKey={sync.revision} /></div>}
    </>
  );

  const meta = preview ? preview.meta : doc.meta;
  return (
    <div className="ifp-song">
      <div className="song-main">
        <nav className="crumbs">
          <Link href={`/ifakepro/p/${song.playlist.slug}`}>‹ {song.playlist.title}</Link>
          <span className="crumbs-nav">
            {song.prev ? <Link href={`/ifakepro/p/${song.playlist.slug}/s/${song.prev.id}`} title={song.prev.title}>‹ Prev</Link> : <span />}
            {song.next ? <Link href={`/ifakepro/p/${song.playlist.slug}/s/${song.next.id}`} title={song.next.title}>Next ›</Link> : <span />}
          </span>
        </nav>

        <div className="song-bar">
          <label className="keysel" title="Show the chart in another key, just for you. To change the song's key for everyone, tap its title.">
            View in
            <select value={shift} onChange={(e) => setShift(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i - 5).map((s) => (
                <option key={s} value={s}>
                  {displayKey(transposeKey(doc.meta.key, s))}
                  {s === 0 ? ' (written)' : INSTRUMENTS[s] ? ` — for ${INSTRUMENTS[s]}` : ''}
                </option>
              ))}
            </select>
          </label>
          {editable && (
            <button className={`ifp-btn small ${editing ? 'primary' : ''}`} onClick={() => (editing ? (setEditing(false), setSel(null)) : setEditing(true))} aria-pressed={editing}>
              {editing ? 'Done editing' : '✎ Edit chart'}
            </button>
          )}
          <button
            className={`ifp-btn small ${fitPref === 'on' ? 'on' : ''}`}
            onClick={() => setFitPref(fitPref === 'on' ? 'off' : 'on')}
            aria-pressed={fitPref === 'on'}
            title="Fit the whole chart on the screen, or show it full size and scroll"
          >
            ⤢ Fit
          </button>
          <button
            className={`ifp-btn small ${barNumbers === 'on' ? 'on' : ''}`}
            onClick={() => setBarNumbers(barNumbers === 'on' ? 'off' : 'on')}
            aria-pressed={barNumbers === 'on'}
            title="Number every bar, to say “bar 12, beat 3” (always on while editing)"
          >
            # Bars
          </button>
          <button className="ifp-btn small" onClick={() => setChordStyle(chordStyle === 'jazz' ? 'plain' : 'jazz')} title="Chord symbols: △ ø – or maj m7♭5 m">
            {chordStyle === 'jazz' ? 'C△ C–7' : 'Cmaj7 Cm7'}
          </button>
          <div className="song-people">
            {sync.presence.map((p) => (
              <Avatar key={p.user.id} person={p.user} size={24} ring />
            ))}
          </div>
          <SaveBadge status={sync.status} />
          <button className="ifp-btn small" onClick={() => setDialog('export')} title="Download this chart for iReal Pro">
            ⬇ iReal Pro
          </button>
          <Menu label="⋯">
            {member && !deleted && <button onClick={() => setDialog('info')}>Edit song info &amp; key…</button>}
            <Link href={`/ifakepro/p/${song.playlist.slug}/print?song=${song.id}&auto=1`} target="_blank">Print / PDF</Link>
            <Link href={`/ifakepro/p/${song.playlist.slug}/play?song=${song.id}`}>Setlist mode</Link>
            {viewer?.user && <button onClick={() => setDialog('copy')}>Copy to playlist…</button>}
            {member && !deleted && (
              <button
                className="danger"
                onClick={async () => {
                  if (!window.confirm(`Delete “${doc.meta.title}”? It can be brought back from the playlist.`)) return;
                  await api(`/songs/${song.id}`, { method: 'DELETE' });
                  router.push(`/ifakepro/p/${song.playlist.slug}`);
                }}
              >
                Delete song
              </button>
            )}
          </Menu>
        </div>

        {deleted && (
          <div className="ifp-banner warn">
            This song was deleted.
            {member && (
              <button
                className="ifp-btn small"
                onClick={async () => {
                  await api(`/songs/${song.id}`, { method: 'PATCH', body: { deleted: false } });
                  onReload();
                }}
              >
                Bring it back
              </button>
            )}
          </div>
        )}
        {!member && !deleted && <JoinHint slug={song.playlist.slug} />}
        {remoteRecent && (
          <div className="ifp-banner info subtle">
            {lastRemote!.agent ? (
              <span>
                <AgentPill name={lastRemote!.agent} /> changed {lastRemote!.bars.length ? `bar${lastRemote!.bars.length === 1 ? '' : 's'} ${ranges(lastRemote!.bars)}` : 'the song'} for {lastRemote!.name}
              </span>
            ) : (
              <>Updated by {lastRemote!.name}</>
            )}
          </div>
        )}
        {preview && (
          <div className="ifp-banner preview">
            <span>
              Viewing {preview.label ? <b>“{preview.label}”</b> : 'the version'} from {when(preview.createdAt)} by {preview.author.name}. Highlighted bars differ from now.
            </span>
            <span className="banner-actions">
              {member && (
                <button
                  className="ifp-btn small primary"
                  onClick={async () => {
                    if (!window.confirm('Make this version the current chart? The current chart stays in the history.')) return;
                    await api(`/songs/${song.id}/versions/${preview.id}`, { body: { action: 'restore' } });
                    const s = await api<SongDetail>(`/songs/${song.id}`);
                    sync.reload({ meta: s.meta, chart: s.chart }, s.revision);
                    setPreview(null);
                    toast('Version restored');
                  }}
                >
                  Restore this version
                </button>
              )}
              <button className="ifp-btn small" onClick={() => setPreview(null)}>Back to current</button>
            </span>
          </div>
        )}

        <div className="song-sheet" ref={sheetRef}>
          <ChartHead
            meta={meta}
            playlist={song.playlist.title}
            keyShown={preview ? undefined : viewKey}
            onEdit={member && !deleted && !preview ? () => setDialog('info') : undefined}
          />
          {preview ? (
            <ChartView chart={preview.chart} shift={shift} flats={flats} chordStyle={chordStyle} changed={previewChanged} barNumbers={barNumbers === 'on'} fitHeight={room} />
          ) : (
            <ChartEditor
              chart={doc.chart}
              change={(fn, opts) => sync.change((d) => ({ ...d, chart: fn(d.chart) }), opts)}
              editing={editing}
              setEditing={(v) => {
                setEditing(v);
                if (!v) setSel(null);
              }}
              sel={sel}
              setSel={setSel}
              editable={editable}
              locked={locked}
              flats={prefersFlats(doc.meta.key)}
              undo={sync.undo}
              redo={sync.redo}
              canUndo={sync.canUndo}
              canRedo={sync.canRedo}
              canComment={member && !deleted}
              onComment={openComment}
              chordStyle={chordStyle}
              view={{ shift, flats, presence, pins, onPin: openComment, flash: sync.flash, barNumbers: barNumbers === 'on', fitHeight: room }}
            />
          )}
        </div>
      </div>

      <aside className={`song-side ${sheet ? 'sheet-open' : ''}`}>
        <div className="sheet-handle" onClick={() => setSheet(false)} aria-hidden>
          <span />
        </div>
        {panel}
      </aside>
      <div className="song-tabbar">
        {(['comments', 'history', 'activity'] as PanelTab[]).map((t) => (
          <button
            key={t}
            className={sheet && tab === t ? 'on' : ''}
            onClick={() => {
              if (sheet && tab === t) setSheet(false);
              else {
                setTab(t);
                setSheet(true);
              }
            }}
          >
            {t === 'comments' ? `💬 ${(comments ?? []).filter((c) => !c.parentId && !c.resolvedAt).length || ''}` : t === 'history' ? '🕘 History' : '≡ Activity'}
          </button>
        ))}
      </div>
      {sheet && <div className="sheet-scrim" onClick={() => setSheet(false)} />}

      {dialog === 'info' && (
        <SongInfoDialog
          meta={doc.meta}
          onClose={() => setDialog(null)}
          onSave={(m, semis) => sync.change((d) => ({ meta: m, chart: semis ? transposeChart(d.chart, semis, prefersFlats(m.key)) : d.chart }))}
        />
      )}
      {dialog === 'export' && <ExportDialog song={preview ? { meta: preview.meta, chart: preview.chart } : doc} onClose={() => setDialog(null)} />}
      {dialog === 'copy' && <CopyDialog songId={song.id} onClose={() => setDialog(null)} />}
    </div>
  );

}

/**
 * The height left on screen for the chart, from where it starts down to the
 * bottom of the window (above the phone's tab bar), or null when not fitting.
 * Measured with the page scrolled to the top, and again whenever the window
 * or anything above the chart changes size.
 */
function useScreenRoom(on: boolean, sheet: RefObject<HTMLDivElement | null>): number | null {
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!on) {
      setRoom(null);
      return;
    }
    const measure = () => {
      const el = sheet.current;
      const chart = el?.querySelector('.chart');
      if (!el || !chart) return;
      const top = chart.getBoundingClientRect().top + window.scrollY;
      const bar = document.querySelector('.song-tabbar');
      const barH = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().height : 0;
      const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      setRoom(Math.max(240, Math.floor(window.innerHeight - top - barH - pad - 6)));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    if (sheet.current?.parentElement) ro.observe(sheet.current.parentElement);
    return () => {
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [on, sheet]);
  return room;
}

function SaveBadge({ status }: { status: string }) {
  const label = { saved: 'Saved', pending: 'Editing…', saving: 'Saving…', offline: 'Offline — retrying', readonly: 'View only' }[status] ?? status;
  return <span className={`save save-${status}`}>{label}</span>;
}

function JoinHint({ slug }: { slug: string }) {
  const { viewer } = useViewer();
  return (
    <div className="ifp-banner subtle">
      {viewer?.user ? 'You can view this chart. To edit or comment, open the playlist’s invite link.' : 'Viewing as a guest. Band members: open your invite link and sign in to edit and comment.'}{' '}
      <Link href={`/ifakepro/p/${slug}`}>Playlist</Link>
    </div>
  );
}

function SongInfoDialog({ meta, onSave, onClose }: { meta: SongMeta; onSave: (m: SongMeta, semis: number) => void; onClose: () => void }) {
  const [m, setM] = useState(meta);
  const [move, setMove] = useState(true);
  const set = (k: keyof SongMeta, v: string | number) => setM((x) => ({ ...x, [k]: v }));
  const semis = move ? keyDistance(meta.key, m.key) : 0;
  const keyChanged = m.key !== meta.key;
  return (
    <Dialog
      title="Song info"
      onClose={onClose}
      footer={
        <>
          <button className="ifp-btn" onClick={onClose}>Cancel</button>
          <button
            className="ifp-btn primary"
            onClick={() => {
              onSave(sanitizeMeta(m, meta), semis);
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="form">
        <label>Title<input value={m.title} onChange={(e) => set('title', e.target.value)} /></label>
        <label>Composer<input value={m.composer} onChange={(e) => set('composer', e.target.value)} /></label>
        <div className="form-row">
          <label>Style
            <input list="ifp-styles" value={m.style} onChange={(e) => set('style', e.target.value)} />
            <datalist id="ifp-styles">{STYLES.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label>Tempo (BPM)<input type="number" inputMode="numeric" min={0} max={400} value={m.bpm || ''} onChange={(e) => set('bpm', Number(e.target.value) || 0)} /></label>
        </div>
        <label>
          Key — the key everyone sees by default
          <select value={m.key} onChange={(e) => set('key', e.target.value)}>
            {ALL_KEYS.map((k) => <option key={k} value={k}>{displayKey(k)}{k === meta.key ? ' (now)' : ''}</option>)}
          </select>
        </label>
        {keyChanged && (
          <div className="key-move">
            <label className="check">
              <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} />
              Move the chords to {displayKey(m.key)}
            </label>
            <small>
              {move
                ? `Every chord goes ${Math.abs(semis)} half step${Math.abs(semis) === 1 ? '' : 's'} ${semis > 0 ? 'up' : 'down'} (${displayKey(meta.key)} → ${displayKey(m.key)}), for everyone. ⌘Z undoes it.`
                : 'Only the label changes — use this when the chords are already written in that key.'}
            </small>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Get charts into iReal Pro: the irealb:// link (iReal's own URL-encoded
 * format, which opens the app), the same as an .html file to send or save, or
 * the link to copy. A song is encoded right here from what's on screen; a
 * playlist is fetched.
 */
export function ExportDialog({ path, song, onClose }: { path?: string; song?: Doc; onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<{ name: string; link: string | null } | null>(
    song ? { name: song.meta.title, link: serializeSong(song) } : null,
  );
  useEffect(() => {
    if (path) api<{ name: string; link: string | null }>(path).then(setData).catch((e) => toast(e.message, 'error'));
  }, [path, toast]);
  return (
    <Dialog title="Download for iReal Pro" onClose={onClose}>
      {!data ? (
        <Spinner />
      ) : !data.link ? (
        <p>Nothing to export yet.</p>
      ) : (
        <div className="export">
          <p>
            On a phone or iPad with iReal Pro, <b>Open in iReal Pro</b> imports {path ? 'the whole playlist' : 'this chart'} straight into the app.
            On a computer, download the file and send it to your phone (or open it on a Mac with iReal Pro).
          </p>
          <a className="ifp-btn primary block" href={data.link}>Open in iReal Pro</a>
          <button className="ifp-btn block" onClick={() => download(`${data.name.replace(/[^\w\s-]/g, '').trim() || 'chart'}.html`, exportHtml(data.name, data.link!))}>
            ⬇ Download iReal Pro file (.html)
          </button>
          <button className="ifp-btn block" onClick={async () => toast((await copyText(data.link!)) ? 'Link copied' : 'Couldn’t copy — long-press the button above instead')}>
            Copy irealb:// link
          </button>
        </div>
      )}
    </Dialog>
  );
}

function CopyDialog({ songId, onClose }: { songId: string; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [lists, setLists] = useState<PlaylistSummary[] | null>(null);
  useEffect(() => {
    api<{ playlists: PlaylistSummary[] }>('/playlists').then((r) => setLists(r.playlists.filter((p) => p.role)));
  }, []);
  return (
    <Dialog title="Copy to playlist" onClose={onClose}>
      {!lists ? (
        <Spinner />
      ) : !lists.length ? (
        <p>You aren’t an editor of any playlist yet.</p>
      ) : (
        <div className="pick-list">
          {lists.map((p) => (
            <button
              key={p.id}
              className="pick"
              onClick={async () => {
                try {
                  const r = await api<{ id: string; slug: string }>(`/songs/${songId}`, { body: { copyTo: p.slug } });
                  toast(`Copied to ${p.title}`);
                  onClose();
                  router.push(`/ifakepro/p/${r.slug}/s/${r.id}`);
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Could not copy', 'error');
                }
              }}
            >
              <b>{p.title}</b>
              <span>{p.songCount} songs</span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
