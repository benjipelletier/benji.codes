import 'server-only';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, getDb } from './db';
import { HttpError, type SessionUser, isAdmin, roleIn } from '@ifakepro/lib/session';
import { type Chart, type SongMeta, canon, sanitizeChart, sanitizeMeta } from '@ifakepro/lib/chart';
import { summarize } from '@ifakepro/lib/diff';
import type {
  ActivityDTO, CommentDTO, FullSong, Member, Person, PlaylistDetail, PlaylistSummary, Role, SongDetail, SongSummary, VersionDetail, VersionSummary,
} from '@ifakepro/lib/types';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Ctx<P> = { params: Promise<P> };

/** Wrap a route: HttpErrors become their status, anything else a logged 500. */
export function handle<P = Record<string, never>>(fn: (req: NextRequest, params: P) => Promise<unknown>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      await ensureSchema();
      const out = await fn(req, (await ctx?.params) as P);
      return out instanceof NextResponse ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error('[ifakepro]', e);
      return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
    }
  };
}

export async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? b : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));

/**
 * A chart as stored, in the current model. Charts saved before bars were
 * timelines (v1, iReal cells) are upgraded here, deterministically, so the
 * server, every client and the merge all see the same event ids.
 */
export function upgrade(chart: unknown): Chart {
  return sanitizeChart(chart) ?? { v: 2, bars: [] };
}

export function person(id: string | null, name: string | null, image: string | null): Person {
  return { id: id ?? '', name: name || 'Someone', image: image ?? null };
}

// ---- Playlists ----

const PLAYLIST_COLS = `
  p.id, p.slug, p.title, p.description, p.visibility, p.updated_at, p.owner_id, p.edit_token,
  o.name AS owner_name, o.image AS owner_image,
  (SELECT count(*) FROM ifp_songs s WHERE s.playlist_id = p.id AND s.deleted_at IS NULL)::int AS song_count`;

function toSummary(r: Row, role: Role | null): PlaylistSummary {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    visibility: r.visibility,
    songCount: r.song_count,
    updatedAt: iso(r.updated_at),
    owner: person(r.owner_id, r.owner_name, r.owner_image),
    role,
  };
}

export async function findPlaylist(slug: string): Promise<Row> {
  const rows = await getDb().query(
    `SELECT ${PLAYLIST_COLS} FROM ifp_playlists p LEFT JOIN ifp_profiles o ON o.id = p.owner_id
     WHERE p.slug = $1 AND p.deleted_at IS NULL`,
    [slug],
  );
  if (!rows[0]) throw new HttpError(404, 'No such playlist');
  return rows[0];
}

export async function listPlaylists(user: SessionUser | null): Promise<PlaylistSummary[]> {
  const admin = isAdmin(user);
  const rows = await getDb().query(
    `SELECT ${PLAYLIST_COLS}, m.role
     FROM ifp_playlists p
     LEFT JOIN ifp_profiles o ON o.id = p.owner_id
     LEFT JOIN ifp_members m ON m.playlist_id = p.id AND m.user_id = $1
     WHERE p.deleted_at IS NULL AND (p.visibility = 'public' OR m.user_id IS NOT NULL OR $2)
     ORDER BY p.updated_at DESC`,
    [user?.id ?? '', admin],
  );
  return rows.map((r) => toSummary(r, admin ? 'owner' : (r.role ?? null)));
}

function slugify(title: string): string {
  const base = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${base || 'playlist'}-${randomBytes(3).toString('hex')}`;
}

export const newToken = () => randomBytes(18).toString('base64url');

export function tokenMatches(given: unknown, actual: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createPlaylist(user: SessionUser, input: { title: string; description: string; visibility: 'public' | 'unlisted' }) {
  const sql = getDb();
  const id = randomUUID();
  const slug = slugify(input.title);
  await sql.transaction([
    sql`INSERT INTO ifp_playlists (id, slug, title, description, owner_id, visibility, edit_token)
        VALUES (${id}, ${slug}, ${input.title}, ${input.description}, ${user.id}, ${input.visibility}, ${newToken()})`,
    sql`INSERT INTO ifp_members (playlist_id, user_id, role) VALUES (${id}, ${user.id}, 'owner')`,
    sql`INSERT INTO ifp_activity (playlist_id, actor_id, kind, summary) VALUES (${id}, ${user.id}, 'playlist.create', ${`Created “${input.title}”`})`,
  ]);
  return { id, slug };
}

export async function playlistDetail(slug: string, user: SessionUser | null, full = false): Promise<PlaylistDetail & { fullSongs?: FullSong[] }> {
  const r = await findPlaylist(slug);
  const role = await roleIn(r.id, user);
  const out: PlaylistDetail & { fullSongs?: FullSong[] } = { ...toSummary(r, role), songs: await songSummaries(r.id, false) };
  if (role) {
    out.deletedSongs = await songSummaries(r.id, true);
    out.inviteToken = r.edit_token;
    const members = await getDb()`
      SELECT m.user_id, m.role, m.joined_at, u.name, u.image, u.email
      FROM ifp_members m LEFT JOIN ifp_profiles u ON u.id = m.user_id
      WHERE m.playlist_id = ${r.id} ORDER BY m.joined_at`;
    out.members = members.map((m): Member => ({
      ...person(m.user_id, m.name, m.image),
      role: m.role,
      joinedAt: iso(m.joined_at),
      ...(role === 'owner' && m.email ? { email: m.email } : {}),
    }));
  }
  if (full) {
    const rows = await getDb()`
      SELECT id, meta, chart, revision FROM ifp_songs WHERE playlist_id = ${r.id} AND deleted_at IS NULL ORDER BY position`;
    out.fullSongs = rows.map((s) => ({ id: s.id, meta: s.meta, chart: upgrade(s.chart), revision: s.revision }));
  }
  return out;
}

async function songSummaries(playlistId: string, deleted: boolean): Promise<SongSummary[]> {
  const rows = await getDb()`
    SELECT s.id, s.meta, s.revision, s.updated_at, s.updated_by, u.name, u.image,
      jsonb_array_length(s.chart->'bars') AS bars,
      (SELECT count(*) FROM ifp_comments c
        WHERE c.song_id = s.id AND c.parent_id IS NULL AND c.resolved_at IS NULL AND c.deleted_at IS NULL)::int AS open_comments
    FROM ifp_songs s LEFT JOIN ifp_profiles u ON u.id = s.updated_by
    WHERE s.playlist_id = ${playlistId} AND (s.deleted_at IS NOT NULL) = ${deleted}
    ORDER BY ${deleted ? 's.deleted_at DESC' : 's.position'}`;
  return rows.map((s) => ({
    id: s.id,
    meta: s.meta,
    revision: s.revision,
    updatedAt: iso(s.updated_at),
    updatedBy: s.updated_by ? person(s.updated_by, s.name, s.image) : null,
    openComments: s.open_comments,
    bars: s.bars ?? 0,
  }));
}

// ---- Activity ----

const FOLD_MINUTES = 10;

export async function logActivity(
  playlistId: string, songId: string | null, actorId: string, kind: string, summary: string, data: Record<string, unknown> = {},
) {
  await getDb()`
    INSERT INTO ifp_activity (playlist_id, song_id, actor_id, kind, summary, data)
    VALUES (${playlistId}, ${songId}, ${actorId}, ${kind}, ${summary}, ${JSON.stringify(data)}::jsonb)`;
  await getDb()`UPDATE ifp_playlists SET updated_at = now() WHERE id = ${playlistId}`;
}

/** Like logActivity, but a repeat of the same thing by the same person shortly after updates the last entry. */
export async function foldActivity(playlistId: string, songId: string | null, actorId: string, kind: string, summary: string) {
  const rows = await getDb()`
    UPDATE ifp_activity SET summary = ${summary}, created_at = now()
    WHERE id = (
      SELECT id FROM ifp_activity WHERE playlist_id = ${playlistId} AND song_id IS NOT DISTINCT FROM ${songId}
      ORDER BY created_at DESC LIMIT 1)
      AND actor_id = ${actorId} AND kind = ${kind} AND created_at > now() - make_interval(mins => ${FOLD_MINUTES})
    RETURNING id`;
  if (!rows.length) await logActivity(playlistId, songId, actorId, kind, summary);
}

export async function listActivity(
  user: SessionUser | null,
  f: { playlistId?: string; songId?: string; actorId?: string; before?: string; limit?: number },
): Promise<ActivityDTO[]> {
  const rows = await getDb().query(
    `SELECT a.id, a.kind, a.summary, a.data, a.created_at, a.actor_id, u.name, u.image,
       p.slug, p.title AS ptitle, a.song_id, s.meta->>'title' AS stitle
     FROM ifp_activity a
     JOIN ifp_playlists p ON p.id = a.playlist_id AND p.deleted_at IS NULL
     LEFT JOIN ifp_songs s ON s.id = a.song_id
     LEFT JOIN ifp_profiles u ON u.id = a.actor_id
     WHERE ($1::uuid IS NULL OR a.playlist_id = $1)
       AND ($2::uuid IS NULL OR a.song_id = $2)
       AND ($3::text IS NULL OR a.actor_id = $3)
       AND ($4::timestamptz IS NULL OR a.created_at < $4)
       AND (p.visibility = 'public' OR $5 OR EXISTS (SELECT 1 FROM ifp_members m WHERE m.playlist_id = p.id AND m.user_id = $6))
     ORDER BY a.created_at DESC, a.id DESC LIMIT $7`,
    [f.playlistId ?? null, f.songId ?? null, f.actorId ?? null, f.before ?? null, isAdmin(user), user?.id ?? '', Math.min(f.limit ?? 50, 200)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind,
    summary: r.summary,
    actor: person(r.actor_id, r.name, r.image),
    agent: typeof r.data?.agent === 'string' ? r.data.agent : null,
    playlist: { slug: r.slug, title: r.ptitle },
    song: r.song_id ? { id: r.song_id, title: r.stitle ?? 'a song' } : null,
    data: r.data ?? {},
    createdAt: iso(r.created_at),
  }));
}

// ---- Songs ----

/** An edit made by the owner's agent for the signed-in person (app/api/ifakepro/agent.ts): its name and what it was asked. */
export interface AgentMark {
  name: string;
  note: string;
}

export interface NewSong {
  meta: SongMeta;
  chart: Chart;
}

/** Add songs to the end of a playlist, each with its first version, in batches small enough for one request. */
export async function insertSongs(
  playlistId: string, user: SessionUser, songs: NewSong[], kind: 'create' | 'import' | 'copy', versionSummary: string, activity: { kind: string; summary: string },
  agent?: AgentMark,
): Promise<string[]> {
  const sql = getDb();
  const top = await sql`SELECT coalesce(max(position), 0) AS p FROM ifp_songs WHERE playlist_id = ${playlistId}`;
  let position = Number(top[0].p);
  const ids: string[] = [];
  for (let i = 0; i < songs.length; i += 150) {
    const rows = songs.slice(i, i + 150).map((s) => {
      const id = randomUUID();
      ids.push(id);
      return { id, position: ++position, meta: sanitizeMeta(s.meta), chart: sanitizeChart(s.chart) };
    });
    const json = JSON.stringify(rows);
    await sql.transaction([
      sql.query(
        `INSERT INTO ifp_songs (id, playlist_id, position, meta, chart, created_by, updated_by, updated_agent)
         SELECT (x->>'id')::uuid, $1, (x->>'position')::float8, x->'meta', x->'chart', $2, $2, $4 FROM jsonb_array_elements($3::jsonb) x`,
        [playlistId, user.id, json, agent?.name ?? null],
      ),
      sql.query(
        `INSERT INTO ifp_versions (song_id, revision, meta, chart, author_id, kind, summary, agent, note)
         SELECT (x->>'id')::uuid, 1, x->'meta', x->'chart', $1, $2, $3, $5, $6 FROM jsonb_array_elements($4::jsonb) x`,
        [user.id, kind, versionSummary, json, agent?.name ?? null, agent?.note ?? null],
      ),
    ]);
  }
  await logActivity(playlistId, ids.length === 1 ? ids[0] : null, user.id, activity.kind, activity.summary, {
    count: ids.length,
    ...(agent ? { agent: agent.name, note: agent.note } : {}),
  });
  return ids;
}

export async function findSong(id: string): Promise<Row> {
  if (!isUuid(id)) throw new HttpError(404, 'No such song');
  const rows = await getDb()`
    SELECT s.*, p.slug, p.title AS ptitle, u.name, u.image
    FROM ifp_songs s JOIN ifp_playlists p ON p.id = s.playlist_id AND p.deleted_at IS NULL
    LEFT JOIN ifp_profiles u ON u.id = s.updated_by
    WHERE s.id = ${id}`;
  if (!rows[0]) throw new HttpError(404, 'No such song');
  return { ...rows[0], chart: upgrade(rows[0].chart) };
}

export async function songDetail(id: string, user: SessionUser | null): Promise<SongDetail> {
  const s = await findSong(id);
  const role = await roleIn(s.playlist_id, user);
  const near = await getDb()`
    WITH o AS (
      SELECT id, meta->>'title' AS title, lag(id) OVER w AS prev_id, lag(meta->>'title') OVER w AS prev_title,
        lead(id) OVER w AS next_id, lead(meta->>'title') OVER w AS next_title
      FROM ifp_songs WHERE playlist_id = ${s.playlist_id} AND deleted_at IS NULL WINDOW w AS (ORDER BY position))
    SELECT * FROM o WHERE id = ${id}`;
  const n = near[0];
  return {
    id: s.id,
    playlist: { id: s.playlist_id, slug: s.slug, title: s.ptitle, role },
    meta: s.meta,
    chart: s.chart,
    revision: s.revision,
    updatedAt: iso(s.updated_at),
    updatedBy: person(s.updated_by, s.name, s.image),
    prev: n?.prev_id ? { id: n.prev_id, title: n.prev_title } : null,
    next: n?.next_id ? { id: n.next_id, title: n.next_title } : null,
    deleted: !!s.deleted_at,
  };
}

/**
 * Save an edit, if it starts from the revision that's current; otherwise
 * null, and the caller answers 409 with the song as it now is. Then fold it
 * into the version history and the edit log. An agent's edit is always a
 * version of its own (`versionId`), so it can be told apart and undone.
 */
export async function saveSong(
  song: Row, user: SessionUser, baseRevision: number, meta: SongMeta, chart: Chart, agent?: AgentMark,
): Promise<{ revision: number; versionId: string | null } | null> {
  const sql = getDb();
  if (canon(meta) === canon(song.meta) && canon(chart) === canon(song.chart) && baseRevision === song.revision) return { revision: song.revision, versionId: null };
  const updated = await sql`
    UPDATE ifp_songs SET meta = ${JSON.stringify(meta)}::jsonb, chart = ${JSON.stringify(chart)}::jsonb,
      revision = revision + 1, updated_at = now(), updated_by = ${user.id}, updated_agent = ${agent?.name ?? null}
    WHERE id = ${song.id} AND revision = ${baseRevision} AND deleted_at IS NULL
    RETURNING revision`;
  if (!updated.length) return null;
  const revision = updated[0].revision as number;
  const versionId = await recordVersion(song, user, revision, { meta, chart }, agent);
  return { revision, versionId };
}

async function recordVersion(song: Row, user: SessionUser, revision: number, doc: NewSong, agent?: AgentMark): Promise<string> {
  const sql = getDb();
  const recent = await sql`
    SELECT id, author_id, kind, label, agent, meta, chart, created_at > now() - make_interval(mins => ${FOLD_MINUTES}) AS fresh
    FROM ifp_versions WHERE song_id = ${song.id} ORDER BY created_at DESC LIMIT 2`;
  const [latest, before] = recent;
  // A person's saves fold together; an agent's never fold, and a person's never fold into one.
  if (!agent && latest && latest.author_id === user.id && latest.kind === 'edit' && !latest.label && !latest.agent && latest.fresh) {
    const summary = summarize(before ? { meta: before.meta, chart: upgrade(before.chart) } : null, doc);
    await sql`
      UPDATE ifp_versions SET revision = ${revision}, meta = ${JSON.stringify(doc.meta)}::jsonb, chart = ${JSON.stringify(doc.chart)}::jsonb,
        summary = ${summary}, created_at = now()
      WHERE id = ${latest.id}`;
    const act = await sql`
      UPDATE ifp_activity SET summary = ${summary}, created_at = now()
      WHERE kind = 'song.edit' AND song_id = ${song.id} AND data->>'versionId' = ${latest.id} RETURNING id`;
    if (!act.length) await logActivity(song.playlist_id, song.id, user.id, 'song.edit', summary, { versionId: latest.id });
    else await sql`UPDATE ifp_playlists SET updated_at = now() WHERE id = ${song.playlist_id}`;
    return latest.id;
  }
  const summary = summarize(latest ? { meta: latest.meta, chart: upgrade(latest.chart) } : null, doc);
  const ins = await sql`
    INSERT INTO ifp_versions (song_id, revision, meta, chart, author_id, kind, summary, agent, note)
    VALUES (${song.id}, ${revision}, ${JSON.stringify(doc.meta)}::jsonb, ${JSON.stringify(doc.chart)}::jsonb, ${user.id}, 'edit', ${summary},
      ${agent?.name ?? null}, ${agent?.note ?? null})
    RETURNING id`;
  await logActivity(song.playlist_id, song.id, user.id, 'song.edit', summary, {
    versionId: ins[0].id,
    ...(agent ? { agent: agent.name, note: agent.note } : {}),
  });
  return ins[0].id;
}

/** Put a version back as the current chart: a new revision and a new version, nothing lost. */
export async function restoreVersion(song: Row, user: SessionUser, versionId: string): Promise<number> {
  const sql = getDb();
  const v = (await sql`SELECT * FROM ifp_versions WHERE id = ${versionId} AND song_id = ${song.id}`)[0];
  if (!v) throw new HttpError(404, 'No such version');
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = (await sql`SELECT revision FROM ifp_songs WHERE id = ${song.id}`)[0];
    const updated = await sql`
      UPDATE ifp_songs SET meta = ${JSON.stringify(v.meta)}::jsonb, chart = ${JSON.stringify(v.chart)}::jsonb,
        revision = revision + 1, updated_at = now(), updated_by = ${user.id}, updated_agent = NULL
      WHERE id = ${song.id} AND revision = ${cur.revision} RETURNING revision`;
    if (!updated.length) continue;
    const revision = updated[0].revision as number;
    const what = v.label ? `“${v.label}”` : 'an earlier version';
    const ins = await sql`
      INSERT INTO ifp_versions (song_id, revision, meta, chart, author_id, kind, summary)
      VALUES (${song.id}, ${revision}, ${JSON.stringify(v.meta)}::jsonb, ${JSON.stringify(v.chart)}::jsonb, ${user.id}, 'restore', ${`Restored ${what}`})
      RETURNING id`;
    await logActivity(song.playlist_id, song.id, user.id, 'song.restore', `Restored ${what}`, {
      versionId: ins[0].id, fromVersionId: v.id, fromCreatedAt: iso(v.created_at),
    });
    return revision;
  }
  throw new HttpError(409, 'The song is being edited too quickly to restore; try again');
}

function toVersion(r: Row): VersionSummary {
  return {
    id: r.id,
    revision: r.revision,
    kind: r.kind,
    summary: r.summary,
    label: r.label,
    author: person(r.author_id, r.name, r.image),
    agent: r.agent ?? null,
    note: r.note ?? null,
    startedAt: iso(r.started_at),
    createdAt: iso(r.created_at),
  };
}

export async function listVersions(songId: string): Promise<VersionSummary[]> {
  const rows = await getDb()`
    SELECT v.id, v.revision, v.kind, v.summary, v.label, v.agent, v.note, v.author_id, v.started_at, v.created_at, u.name, u.image
    FROM ifp_versions v LEFT JOIN ifp_profiles u ON u.id = v.author_id
    WHERE v.song_id = ${songId} ORDER BY v.created_at DESC LIMIT 300`;
  return rows.map(toVersion);
}

export async function getVersion(songId: string, versionId: string): Promise<VersionDetail> {
  if (!isUuid(versionId)) throw new HttpError(404, 'No such version');
  const rows = await getDb()`
    SELECT v.*, u.name, u.image FROM ifp_versions v LEFT JOIN ifp_profiles u ON u.id = v.author_id
    WHERE v.id = ${versionId} AND v.song_id = ${songId}`;
  if (!rows[0]) throw new HttpError(404, 'No such version');
  return { ...toVersion(rows[0]), meta: rows[0].meta, chart: upgrade(rows[0].chart) };
}

// ---- Comments ----

export async function listComments(songId: string): Promise<CommentDTO[]> {
  const rows = await getDb()`
    SELECT c.*, u.name, u.image, r.name AS rname, r.image AS rimage
    FROM ifp_comments c
    LEFT JOIN ifp_profiles u ON u.id = c.author_id
    LEFT JOIN ifp_profiles r ON r.id = c.resolved_by
    LEFT JOIN ifp_comments p ON p.id = c.parent_id
    WHERE c.song_id = ${songId} AND c.deleted_at IS NULL AND (p.id IS NULL OR p.deleted_at IS NULL)
    ORDER BY c.created_at`;
  return rows.map((c) => ({
    id: c.id,
    barId: c.bar_id,
    parentId: c.parent_id,
    body: c.body,
    author: person(c.author_id, c.name, c.image),
    createdAt: iso(c.created_at),
    editedAt: c.edited_at ? iso(c.edited_at) : null,
    resolvedAt: c.resolved_at ? iso(c.resolved_at) : null,
    resolvedBy: c.resolved_by ? person(c.resolved_by, c.rname, c.rimage) : null,
  }));
}

export async function commentsStamp(songId: string): Promise<string> {
  const r = await getDb()`SELECT count(*)::int AS n, max(updated_at) AS t FROM ifp_comments WHERE song_id = ${songId}`;
  return `${r[0].n}:${r[0].t ? iso(r[0].t) : ''}`;
}
