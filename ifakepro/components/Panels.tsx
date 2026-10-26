'use client';

// The song page's side panels: comment threads, version history, and the
// edit log (which the playlist and activity pages use too).

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Chart } from '@ifakepro/lib/chart';
import { api, timeAgo, when } from '@ifakepro/lib/client';
import type { ActivityDTO, CommentDTO, VersionDetail, VersionSummary } from '@ifakepro/lib/types';
import { Avatar, Empty, Spinner, useToast, useViewer } from './ui';

// ---- Comments ----

export function CommentsPanel({
  songId, chart, comments, setComments, canComment, focusBar, setFocusBar, onSelectBar,
}: {
  songId: string;
  chart: Chart;
  comments: CommentDTO[] | null;
  setComments: (c: CommentDTO[]) => void;
  canComment: boolean;
  /** The bar a new comment goes on; null for the whole song. */
  focusBar: string | null;
  setFocusBar: (id: string | null) => void;
  onSelectBar: (barId: string) => void;
}) {
  const toast = useToast();
  const { viewer } = useViewer();
  const [show, setShow] = useState<'open' | 'resolved' | 'all'>('open');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const barNo = (id: string | null) => (id ? chart.bars.findIndex((b) => b.id === id) + 1 : 0);

  const threads = useMemo(() => {
    const roots = (comments ?? []).filter((c) => !c.parentId);
    const replies = (comments ?? []).filter((c) => c.parentId);
    return roots
      .filter((r) => (show === 'all' ? true : show === 'open' ? !r.resolvedAt : !!r.resolvedAt))
      .map((r) => ({ root: r, replies: replies.filter((x) => x.parentId === r.id) }))
      .sort((a, b) => (barNo(a.root.barId) || 1e9) - (barNo(b.root.barId) || 1e9) || a.root.createdAt.localeCompare(b.root.createdAt));
  }, [comments, show, chart]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (body: string, extra: { barId?: string | null; parentId?: string }) => {
    setBusy(true);
    try {
      const r = await api<{ comments: CommentDTO[] }>(`/songs/${songId}/comments`, { body: { body, ...extra } });
      setComments(r.comments);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not post', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const patch = async (id: string, body: object) => {
    try {
      const r = await api<{ comments: CommentDTO[] }>(`/comments/${id}`, { method: 'PATCH', body });
      setComments(r.comments);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update', 'error');
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      const r = await api<{ comments: CommentDTO[] }>(`/comments/${id}`, { method: 'DELETE' });
      setComments(r.comments);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not delete', 'error');
    }
  };

  const focusNo = barNo(focusBar);
  const counts = {
    open: (comments ?? []).filter((c) => !c.parentId && !c.resolvedAt).length,
    resolved: (comments ?? []).filter((c) => !c.parentId && c.resolvedAt).length,
  };

  return (
    <div className="ifp-panel">
      {canComment && (
        <form
          className="c-new"
          onSubmit={async (e) => {
            e.preventDefault();
            if (draft.trim() && (await send(draft, { barId: focusBar }))) setDraft('');
          }}
        >
          <div className="c-new-where">
            {focusBar && focusNo > 0 ? (
              <>
                On <b>bar {focusNo}</b>{' '}
                <button type="button" className="ifp-link" onClick={() => setFocusBar(null)}>
                  comment on the whole song instead
                </button>
              </>
            ) : (
              <>On the whole song · select a bar to comment on it</>
            )}
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={focusNo > 0 ? `Note for bar ${focusNo}…` : 'Note for the band…'}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }}
          />
          <button className="ifp-btn primary" disabled={busy || !draft.trim()}>
            Comment
          </button>
        </form>
      )}
      <div className="c-filter">
        {(['open', 'resolved', 'all'] as const).map((f) => (
          <button key={f} className={show === f ? 'on' : ''} onClick={() => setShow(f)}>
            {f === 'open' ? `Open (${counts.open})` : f === 'resolved' ? `Resolved (${counts.resolved})` : 'All'}
          </button>
        ))}
      </div>
      {!comments ? (
        <Spinner />
      ) : !threads.length ? (
        <Empty>{show === 'open' ? 'No open comments.' : 'Nothing here.'}</Empty>
      ) : (
        threads.map(({ root, replies }) => (
          <Thread
            key={root.id}
            root={root}
            replies={replies}
            barNo={barNo(root.barId)}
            mine={(c) => c.author.id === viewer?.user?.id}
            canComment={canComment}
            onBar={() => root.barId && onSelectBar(root.barId)}
            onReply={(body) => send(body, { parentId: root.id })}
            onResolve={(v) => patch(root.id, { resolved: v })}
            onEdit={(id, body) => patch(id, { body })}
            onDelete={remove}
            active={!!focusBar && root.barId === focusBar}
          />
        ))
      )}
    </div>
  );
}

function Thread(p: {
  root: CommentDTO;
  replies: CommentDTO[];
  barNo: number;
  mine: (c: CommentDTO) => boolean;
  canComment: boolean;
  onBar: () => void;
  onReply: (body: string) => Promise<boolean>;
  onResolve: (v: boolean) => void;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
  active: boolean;
}) {
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const one = (c: CommentDTO) => (
    <div key={c.id} className="c-item">
      <Avatar person={c.author} size={22} />
      <div className="c-main">
        <div className="c-meta">
          <b>{c.author.name}</b> <span title={when(c.createdAt)}>{timeAgo(c.createdAt)}</span>
          {c.editedAt && <span> · edited</span>}
        </div>
        {editing === c.id ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              p.onEdit(c.id, editText);
              setEditing(null);
            }}
          >
            <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} autoFocus />
            <div className="c-actions">
              <button className="ifp-btn small primary">Save</button>
              <button type="button" className="ifp-btn small" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="c-body">{c.body}</div>
        )}
        {p.mine(c) && editing !== c.id && (
          <div className="c-actions subtle">
            <button className="ifp-link" onClick={() => { setEditing(c.id); setEditText(c.body); }}>Edit</button>
            <button className="ifp-link" onClick={() => p.onDelete(c.id)}>Delete</button>
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className={`c-thread ${p.root.resolvedAt ? 'resolved' : ''} ${p.active ? 'active' : ''}`}>
      <div className="c-thread-head">
        {p.root.barId ? (
          <button className="c-bar" onClick={p.onBar} disabled={p.barNo <= 0}>
            {p.barNo > 0 ? `Bar ${p.barNo}` : 'Bar removed'}
          </button>
        ) : (
          <span className="c-bar song">Song</span>
        )}
        {p.canComment && (
          <button className="ifp-link" onClick={() => p.onResolve(!p.root.resolvedAt)}>
            {p.root.resolvedAt ? 'Reopen' : '✓ Resolve'}
          </button>
        )}
      </div>
      {one(p.root)}
      {p.replies.map(one)}
      {p.root.resolvedAt && p.root.resolvedBy && <div className="c-resolved">Resolved by {p.root.resolvedBy.name} · {timeAgo(p.root.resolvedAt)}</div>}
      {p.canComment && (
        <form
          className="c-reply"
          onSubmit={async (e) => {
            e.preventDefault();
            if (reply.trim() && (await p.onReply(reply))) setReply('');
          }}
        >
          <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" />
          {reply.trim() && <button className="ifp-btn small primary">Reply</button>}
        </form>
      )}
    </div>
  );
}

// ---- Version history ----

const KIND_LABEL: Record<VersionSummary['kind'], string> = {
  create: 'Created', import: 'Imported', edit: 'Edited', restore: 'Restored', copy: 'Copied',
};

export function VersionsPanel({
  songId, revision, preview, setPreview, canEdit, onRestored,
}: {
  songId: string;
  revision: number;
  preview: VersionDetail | null;
  setPreview: (v: VersionDetail | null) => void;
  canEdit: boolean;
  onRestored: () => void;
}) {
  const toast = useToast();
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [namedOnly, setNamedOnly] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ versions: VersionSummary[] }>(`/songs/${songId}/versions`).then((r) => setVersions(r.versions)).catch(() => {});
    }, versions ? 1500 : 0);
    return () => clearTimeout(t);
  }, [songId, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (v: VersionSummary, i: number) => {
    if (i === 0) return setPreview(null);
    setLoading(v.id);
    try {
      setPreview(await api<VersionDetail>(`/songs/${songId}/versions/${v.id}`));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load that version', 'error');
    } finally {
      setLoading(null);
    }
  };
  const name = async (v: VersionSummary) => {
    const label = window.prompt('Name this version (e.g. “Gig chart 10/24”). Empty to remove the name.', v.label ?? '');
    if (label === null) return;
    try {
      const r = await api<VersionDetail>(`/songs/${songId}/versions/${v.id}`, { method: 'PATCH', body: { label } });
      setVersions((vs) => vs?.map((x) => (x.id === v.id ? { ...x, label: r.label } : x)) ?? null);
      if (preview?.id === v.id) setPreview(r);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not name it', 'error');
    }
  };
  const restore = async (v: VersionSummary) => {
    if (!window.confirm('Make this version the current chart? The current chart stays in the history.')) return;
    try {
      await api(`/songs/${songId}/versions/${v.id}`, { body: { action: 'restore' } });
      setPreview(null);
      onRestored();
      toast('Version restored');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not restore', 'error');
    }
  };

  if (!versions) return <div className="ifp-panel"><Spinner /></div>;
  const shown = namedOnly ? versions.filter((v, i) => v.label || i === 0) : versions;
  return (
    <div className="ifp-panel">
      <label className="v-named">
        <input type="checkbox" checked={namedOnly} onChange={(e) => setNamedOnly(e.target.checked)} /> Only named versions
      </label>
      <ol className="v-list">
        {shown.map((v) => {
          const i = versions.indexOf(v);
          const active = i === 0 ? !preview : preview?.id === v.id;
          return (
            <li key={v.id} className={`v-item ${active ? 'on' : ''}`}>
              <button className="v-main" onClick={() => open(v, i)} disabled={loading === v.id}>
                <span className="v-when">{i === 0 ? 'Current version' : when(v.createdAt)}</span>
                {v.label && <span className="v-label">{v.label}</span>}
                <span className="v-who">
                  <Avatar person={v.author} size={16} /> {v.author.name} · {KIND_LABEL[v.kind]}
                </span>
                {v.summary && <span className="v-sum">{v.summary}</span>}
              </button>
              {canEdit && (
                <div className="v-actions">
                  <button className="ifp-link" onClick={() => name(v)}>{v.label ? 'Rename' : 'Name'}</button>
                  {i > 0 && <button className="ifp-link" onClick={() => restore(v)}>Restore</button>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---- Edit log ----

const ACT_ICON: Record<string, string> = {
  'song.edit': '✎', 'song.create': '＋', 'song.import': '⇣', 'song.copy': '⧉', 'song.delete': '🗑', 'song.undelete': '↺', 'song.restore': '↺',
  'comment.add': '💬', 'comment.reply': '💬', 'comment.resolve': '✓', 'member.join': '👋', 'playlist.create': '★', 'playlist.update': '✎', 'playlist.reorder': '⇅',
};

export function ActivityList({ items, showPlaylist = true, showSong = true }: { items: ActivityDTO[]; showPlaylist?: boolean; showSong?: boolean }) {
  if (!items.length) return <Empty>Nothing yet.</Empty>;
  return (
    <ol className="a-list">
      {items.map((a) => {
        const songHref = a.song ? `/ifakepro/p/${a.playlist.slug}/s/${a.song.id}` : null;
        return (
          <li key={a.id} className="a-item">
            <span className="a-icon" aria-hidden>{ACT_ICON[a.kind] ?? '•'}</span>
            <Avatar person={a.actor} size={22} />
            <div className="a-main">
              <div className="a-line">
                <b>{a.actor.name}</b> <span className="a-sum">{a.summary.charAt(0).toLowerCase() + a.summary.slice(1)}</span>
              </div>
              <div className="a-where">
                {showSong && a.song && songHref && <Link href={songHref}>{a.song.title}</Link>}
                {showSong && a.song && showPlaylist && ' · '}
                {showPlaylist && <Link href={`/ifakepro/p/${a.playlist.slug}`}>{a.playlist.title}</Link>}
                {(showSong && a.song) || showPlaylist ? ' · ' : ''}
                <span title={when(a.createdAt)}>{timeAgo(a.createdAt)}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The edit log with paging, for a playlist, a song, or everything. */
export function ActivityFeed({ query, showPlaylist, showSong, refreshKey }: { query: string; showPlaylist?: boolean; showSong?: boolean; refreshKey?: unknown }) {
  const [items, setItems] = useState<ActivityDTO[] | null>(null);
  const [more, setMore] = useState(true);
  useEffect(() => {
    api<{ activity: ActivityDTO[] }>(`/activity?${query}`).then((r) => {
      setItems(r.activity);
      setMore(r.activity.length >= 50);
    }).catch(() => setItems([]));
  }, [query, refreshKey]);
  if (!items) return <Spinner />;
  return (
    <>
      <ActivityList items={items} showPlaylist={showPlaylist} showSong={showSong} />
      {more && items.length > 0 && (
        <button
          className="ifp-btn more"
          onClick={async () => {
            const r = await api<{ activity: ActivityDTO[] }>(`/activity?${query}&before=${encodeURIComponent(items[items.length - 1].createdAt)}`);
            setItems([...items, ...r.activity]);
            setMore(r.activity.length >= 50);
          }}
        >
          Older
        </button>
      )}
    </>
  );
}
