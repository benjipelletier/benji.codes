'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, displayKey, signInWithGoogle, signOut, timeAgo, usePref } from '@ifakepro/lib/client';
import type { SongMeta } from '@ifakepro/lib/chart';
import type { PlaylistDetail, PlaylistSummary, Person, SongSummary } from '@ifakepro/lib/types';
import { AddSongsDialog, ShareDialog } from './Dialogs';
import { ActivityFeed } from './Panels';
import { ExportDialog } from './SongPage';
import { Avatar, Empty, Menu, Spinner, Tabs, useToast, useViewer } from './ui';

// ---- Header ----

export function Shell({ children }: { children: ReactNode }) {
  const { viewer } = useViewer();
  const path = usePathname();
  const [theme, setTheme] = usePref<'auto' | 'light' | 'dark'>('theme', 'auto');
  useEffect(() => {
    const root = document.querySelector('.ifp');
    if (!root) return;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  const nav = (href: string, label: string) => (
    <Link href={href} className={path === href ? 'on' : ''}>
      {label}
    </Link>
  );
  return (
    <>
      <header className="ifp-header">
        <Link href="/ifakepro" className="ifp-logo">
          <span className="logo-mark">𝄞</span> iFake<em>Pro</em>
        </Link>
        <nav className="ifp-nav">
          {nav('/ifakepro', 'Playlists')}
          {nav('/ifakepro/songs', 'Songs')}
          {nav('/ifakepro/activity', 'Activity')}
        </nav>
        <div className="ifp-account">
          <button
            className="ifp-icon-btn"
            title={`Theme: ${theme}`}
            onClick={() => setTheme(theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto')}
            aria-label="Switch theme"
          >
            <svg viewBox="0 0 20 20" aria-hidden>
              <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
              {theme === 'auto' && <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />}
              {theme === 'dark' && <circle cx="10" cy="10" r="7" fill="currentColor" />}
            </svg>
          </button>
          {viewer?.user ? (
            <Menu label={<Avatar person={viewer.user} size={26} />}>
              <div className="menu-note">
                Signed in as <b>{viewer.user.email}</b>
              </div>
              <button onClick={signOut}>Sign out</button>
            </Menu>
          ) : viewer ? (
            <button className="ifp-btn small" onClick={signInWithGoogle}>
              Sign in
            </button>
          ) : null}
        </div>
      </header>
      <main className="ifp-content">{children}</main>
    </>
  );
}

// ---- Home ----

export function HomePage() {
  const { viewer } = useViewer();
  const [lists, setLists] = useState<PlaylistSummary[] | null>(null);
  const [creating, setCreating] = useState<null | 'ireal' | 'standards' | 'blank'>(null);
  useEffect(() => {
    api<{ playlists: PlaylistSummary[] }>('/playlists').then((r) => setLists(r.playlists)).catch(() => setLists([]));
  }, [viewer?.user?.id]);
  const mine = lists?.filter((p) => p.role) ?? [];
  const others = lists?.filter((p) => !p.role) ?? [];
  return (
    <div className="ifp-page">
      <section className="hero">
        <h1>Charts for the band, shared.</h1>
        <p>Every chart for the show in one place: import from iReal Pro or the standards, edit together, leave notes on bars, and never lose a version.</p>
        <div className="hero-actions">
          {viewer?.isAdmin && (
            <>
              <button className="ifp-btn primary" onClick={() => setCreating('ireal')}>
                ⇪ Upload from iReal Pro
              </button>
              <button className="ifp-btn" onClick={() => setCreating('blank')}>
                ＋ New playlist
              </button>
            </>
          )}
          <Link className="ifp-btn" href="/ifakepro/songs">Browse songs</Link>
          {viewer && !viewer.user && (
            <button className="ifp-btn" onClick={signInWithGoogle}>
              Sign in with Google
            </button>
          )}
        </div>
      </section>
      {!lists ? (
        <Spinner />
      ) : (
        <>
          {mine.length > 0 && <PlaylistGrid title="Your playlists" lists={mine} />}
          <PlaylistGrid title={mine.length ? 'Other playlists' : 'Playlists'} lists={others} empty={mine.length ? null : 'No playlists yet.'} />
        </>
      )}
      <section className="block">
        <div className="block-head">
          <h2>Recent activity</h2>
          <Link href="/ifakepro/activity">All activity ›</Link>
        </div>
        <ActivityFeed query="limit=8" />
      </section>
      {creating && <AddSongsDialog mode="create" initial={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

function PlaylistGrid({ title, lists, empty }: { title: string; lists: PlaylistSummary[]; empty?: string | null }) {
  if (!lists.length && !empty) return null;
  return (
    <section className="block">
      <h2>{title}</h2>
      {!lists.length ? (
        <Empty>{empty}</Empty>
      ) : (
        <div className="cards">
          {lists.map((p) => (
            <Link key={p.id} href={`/ifakepro/p/${p.slug}`} className="card">
              <div className="card-title">{p.title}</div>
              <div className="card-meta">
                {p.songCount} song{p.songCount === 1 ? '' : 's'} · updated {timeAgo(p.updatedAt)}
              </div>
              <div className="card-foot">
                <Avatar person={p.owner} size={18} /> {p.owner.name}
                {p.role && <span className="tag">{p.role}</span>}
                {p.visibility === 'unlisted' && <span className="tag muted">unlisted</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

// ---- Playlist ----

export function PlaylistPage({ slug }: { slug: string }) {
  const { viewer, refresh: refreshViewer } = useViewer();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const invite = params.get('invite');
  const [p, setP] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'songs' | 'activity'>('songs');
  const [dialog, setDialog] = useState<'add' | 'share' | 'export' | null>(null);
  const [renaming, setRenaming] = useState(false);
  const joining = useRef(false);

  const load = useCallback(() => {
    api<PlaylistDetail>(`/playlists/${slug}`).then(setP).catch((e) => setError(e.message));
  }, [slug]);
  useEffect(load, [load, viewer?.user?.id]);
  // Refresh now and then so other people's additions show up.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 20000);
    return () => clearInterval(t);
  }, [load]);

  // Arriving from an invite link, signed in: join, then drop the token from the address.
  useEffect(() => {
    if (!invite || !viewer?.user || !p || joining.current) return;
    if (p.role) {
      router.replace(`/ifakepro/p/${slug}`);
      return;
    }
    joining.current = true;
    api<{ joined: boolean }>(`/playlists/${slug}/join`, { body: { token: invite } })
      .then(() => {
        toast(`You can now edit “${p.title}”`);
        router.replace(`/ifakepro/p/${slug}`);
        refreshViewer();
        load();
      })
      .catch((e) => toast(e.message, 'error'));
  }, [invite, viewer, p, slug, router, toast, load, refreshViewer]);

  if (error) return <div className="ifp-page"><p className="ifp-error">{error}</p><Link href="/ifakepro">← All playlists</Link></div>;
  if (!p) return <div className="ifp-page"><Spinner /></div>;
  const member = !!p.role;

  return (
    <div className="ifp-page">
      {invite && !viewer?.user && viewer && (
        <div className="ifp-banner invite">
          <span>You’re invited to edit <b>{p.title}</b>. Sign in with Google to join.</span>
          <button className="ifp-btn primary small" onClick={signInWithGoogle}>Sign in with Google</button>
        </div>
      )}
      <header className="pl-head">
        {renaming ? (
          <form
            className="pl-rename"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setP(await api<PlaylistDetail>(`/playlists/${slug}`, { method: 'PATCH', body: { title: f.get('title'), description: f.get('description') } }));
              setRenaming(false);
            }}
          >
            <input name="title" defaultValue={p.title} autoFocus />
            <textarea name="description" defaultValue={p.description} placeholder="Notes: date, venue, who’s playing…" rows={2} />
            <div>
              <button className="ifp-btn primary small">Save</button> <button type="button" className="ifp-btn small" onClick={() => setRenaming(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <h1>
              {p.title}
              {member && <button className="ifp-icon-btn" onClick={() => setRenaming(true)} aria-label="Rename">✎</button>}
            </h1>
            {p.description && <p className="pl-desc">{p.description}</p>}
            <div className="pl-meta">
              <Avatar person={p.owner} size={18} /> {p.owner.name} · {p.songCount} song{p.songCount === 1 ? '' : 's'}
              {p.visibility === 'unlisted' && ' · unlisted'}
              {p.members && p.members.length > 1 && (
                <span className="pl-members">
                  {p.members.slice(0, 6).map((m) => <Avatar key={m.id} person={m} size={20} />)}
                </span>
              )}
            </div>
          </>
        )}
        <div className="pl-actions">
          <Link className="ifp-btn primary" href={`/ifakepro/p/${slug}/play`} aria-disabled={!p.songs.length}>▶ Setlist<span className="pl-play-long">&nbsp;mode</span></Link>
          {member && <button className="ifp-btn" onClick={() => setDialog('add')}>＋ Add<span className="pl-play-long">&nbsp;songs</span></button>}
          <button className="ifp-btn" onClick={() => setDialog('share')}>Share</button>
          <button className="ifp-btn" onClick={() => setDialog('export')} disabled={!p.songs.length} title="Download the playlist for iReal Pro">⬇ iReal Pro</button>
          <Menu label="⋯">
            <Link href={`/ifakepro/p/${slug}/print?auto=1`} target="_blank">Print all / PDF</Link>
            {p.role === 'owner' && (
              <button
                className="danger"
                onClick={async () => {
                  if (!window.confirm(`Delete the playlist “${p.title}” and all its songs?`)) return;
                  await api(`/playlists/${slug}`, { method: 'DELETE' });
                  router.push('/ifakepro');
                }}
              >
                Delete playlist
              </button>
            )}
          </Menu>
        </div>
      </header>

      <Tabs<'songs' | 'activity'> tabs={[{ id: 'songs', label: `Songs (${p.songs.length})` }, { id: 'activity', label: 'Activity' }]} value={tab} onChange={setTab} />
      {tab === 'songs' ? (
        <>
          <SongList slug={slug} songs={p.songs} editable={member} onReordered={(songs) => setP({ ...p, songs })} />
          {member && !p.songs.length && (
            <Empty>
              No songs yet. <button className="ifp-link" onClick={() => setDialog('add')}>Add some</button> from the standards or iReal Pro.
            </Empty>
          )}
          {member && p.deletedSongs && p.deletedSongs.length > 0 && (
            <details className="deleted">
              <summary>Recently deleted ({p.deletedSongs.length})</summary>
              <ul>
                {p.deletedSongs.map((s) => (
                  <li key={s.id}>
                    <span>{s.meta.title}</span>
                    <button
                      className="ifp-link"
                      onClick={async () => {
                        await api(`/songs/${s.id}`, { method: 'PATCH', body: { deleted: false } });
                        load();
                      }}
                    >
                      Bring back
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <ActivityFeed query={`playlist=${slug}`} showPlaylist={false} />
      )}

      {dialog === 'add' && <AddSongsDialog mode="add" slug={slug} onClose={() => setDialog(null)} onDone={load} />}
      {dialog === 'share' && <ShareDialog playlist={p} onClose={() => setDialog(null)} onChange={setP} />}
      {dialog === 'export' && <ExportDialog path={`/playlists/${slug}/export`} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** The running order. Drag the handle (mouse or finger) to reorder. */
function SongList({ slug, songs, editable, onReordered }: { slug: string; songs: SongSummary[]; editable: boolean; onReordered: (s: SongSummary[]) => void }) {
  const toast = useToast();
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);

  const start = (e: React.PointerEvent, id: string, index: number) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, over: index });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag || !list.current) return;
    const rows = [...list.current.querySelectorAll<HTMLElement>('.song-row')];
    let over = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        over = i;
        break;
      }
    }
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const end = async () => {
    if (!drag) return;
    const from = songs.findIndex((s) => s.id === drag.id);
    const to = drag.over;
    setDrag(null);
    if (from < 0 || from === to) return;
    const next = songs.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    onReordered(next);
    try {
      await api(`/playlists/${slug}/songs`, { method: 'PATCH', body: { order: next.map((s) => s.id) } });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not reorder', 'error');
      onReordered(songs);
    }
  };

  const shown = drag
    ? (() => {
        const a = songs.slice();
        const i = a.findIndex((s) => s.id === drag.id);
        const [m] = a.splice(i, 1);
        a.splice(drag.over, 0, m);
        return a;
      })()
    : songs;

  return (
    <ol className="song-list" ref={list} onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
      {shown.map((s, i) => (
        <li key={s.id} className={`song-row ${drag?.id === s.id ? 'dragging' : ''}`}>
          <span className="song-no">{i + 1}</span>
          <Link href={`/ifakepro/p/${slug}/s/${s.id}`} className="song-link">
            <span className="song-name">{s.meta.title}</span>
            <span className="song-sub">{[s.meta.composer, s.meta.style].filter(Boolean).join(' · ')}</span>
          </Link>
          <span className="song-key">{displayKey(s.meta.key)}</span>
          {s.openComments > 0 && <span className="song-comments" title={`${s.openComments} open comments`}>💬 {s.openComments}</span>}
          <span className="song-when" title={s.updatedBy ? `Last edited by ${s.updatedBy.name}` : undefined}>{timeAgo(s.updatedAt)}</span>
          {editable && (
            <button className="drag" aria-label={`Move ${s.meta.title}`} onPointerDown={(e) => start(e, s.id, i)}>
              ⠿
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

// ---- All songs ----

interface SongHit {
  id: string;
  meta: SongMeta;
  updatedAt: string;
  updatedBy: Person;
  playlist: { slug: string; title: string };
}

export function SongsPage() {
  const [q, setQ] = useState('');
  const [songs, setSongs] = useState<SongHit[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ songs: SongHit[] }>(`/songs?q=${encodeURIComponent(q)}`).then((r) => setSongs(r.songs)).catch(() => setSongs([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="ifp-page">
      <h1>Songs</h1>
      <p className="muted">Every chart in every playlist you can see.</p>
      <input className="search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, composer or style" />
      {!songs ? (
        <Spinner />
      ) : !songs.length ? (
        <Empty>No songs{q ? ' match' : ' yet'}.</Empty>
      ) : (
        <ol className="song-list">
          {songs.map((s) => (
            <li key={s.id} className="song-row">
              <Link href={`/ifakepro/p/${s.playlist.slug}/s/${s.id}`} className="song-link">
                <span className="song-name">{s.meta.title}</span>
                <span className="song-sub">{[s.meta.composer, s.playlist.title].filter(Boolean).join(' · ')}</span>
              </Link>
              <span className="song-key">{displayKey(s.meta.key)}</span>
              <span className="song-when">{timeAgo(s.updatedAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---- Activity ----

export function ActivityPage() {
  const [lists, setLists] = useState<PlaylistSummary[]>([]);
  const [playlist, setPlaylist] = useState('');
  const { viewer } = useViewer();
  const [mineOnly, setMineOnly] = useState(false);
  useEffect(() => {
    api<{ playlists: PlaylistSummary[] }>('/playlists').then((r) => setLists(r.playlists)).catch(() => {});
  }, []);
  const q = new URLSearchParams();
  if (playlist) q.set('playlist', playlist);
  if (mineOnly && viewer?.user) q.set('actor', viewer.user.id);
  return (
    <div className="ifp-page">
      <h1>Activity</h1>
      <p className="muted">Every edit, import, comment and restore, across all songs.</p>
      <div className="filters">
        <select value={playlist} onChange={(e) => setPlaylist(e.target.value)} aria-label="Playlist">
          <option value="">All playlists</option>
          {lists.map((p) => <option key={p.id} value={p.slug}>{p.title}</option>)}
        </select>
        {viewer?.user && (
          <label className="check">
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Only mine
          </label>
        )}
      </div>
      <ActivityFeed query={q.toString()} />
    </div>
  );
}
