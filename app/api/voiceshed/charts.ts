// The owner's iFake Pro playlists (the ones they own or edit), each song as a
// tune for Practice: its chords in order, a chord held into the next bar
// written once, as the standards are. Read-only; the charts stay in iFake
// Pro. A spectator gets only the public ones.

import { sanitizeChart, type Chart } from '@ifakepro/lib/chart';
import type { ChartPlaylist, ChartTune } from '@voiceshed/lib/types';

type Row = Record<string, unknown>;
type Query = { query: (text: string, params: unknown[]) => Promise<unknown> };

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** iReal's key ("Eb", "G-") as a pitch class and minor or not. */
export function keyOf(k: unknown): { home_key: number; is_minor: boolean } {
  const m = typeof k === 'string' ? /^([A-G])([b#]?)(-?)$/.exec(k.trim()) : null;
  if (!m) return { home_key: 0, is_minor: false };
  const pc = (LETTER[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0) + 12) % 12;
  return { home_key: pc, is_minor: m[3] === '-' };
}

/** Chords in playing order; a 1- or 2-bar repeat sign plays the bars it stands for. */
export function chartChords(chart: Chart): string[] {
  const perBar: string[][] = [];
  chart.bars.forEach((bar, i) => {
    const own = bar.events.filter(e => (e.kind === 'chord' || e.kind === 'hit') && e.ch).map(e => e.ch as string);
    perBar.push(bar.simile && !own.length ? perBar.slice(Math.max(0, i - bar.simile), i).flat() : own);
  });
  const out: string[] = [];
  for (const c of perBar.flat()) if (out[out.length - 1] !== c) out.push(c);
  return out;
}

/** The playlists the owner (by email) owns or edits, newest first; public ones only unless `all`. */
export async function loadCharts(sql: Query, owner: string, all: boolean): Promise<ChartPlaylist[]> {
  const lists = (await sql.query(
    `SELECT p.id, p.slug, p.title
     FROM ifp_playlists p
     WHERE p.deleted_at IS NULL
       AND ($2 OR p.visibility = 'public')
       AND EXISTS (
         SELECT 1 FROM ifp_profiles pr
         WHERE lower(pr.email) = lower($1)
           AND (pr.id = p.owner_id OR EXISTS (SELECT 1 FROM ifp_members m WHERE m.playlist_id = p.id AND m.user_id = pr.id))
       )
     ORDER BY p.updated_at DESC`,
    [owner, all],
  )) as Row[];
  if (!lists.length) return [];
  const songs = (await sql.query(
    `SELECT id, playlist_id, meta, chart, updated_at FROM ifp_songs
     WHERE playlist_id = ANY($1::uuid[]) AND deleted_at IS NULL
     ORDER BY position`,
    [lists.map(l => l.id)],
  )) as Row[];
  return lists.map(l => ({
    id: String(l.id),
    slug: String(l.slug),
    title: String(l.title),
    songs: songs
      .filter(s => String(s.playlist_id) === String(l.id))
      .map((s): ChartTune => {
        const meta = (s.meta ?? {}) as Record<string, unknown>;
        const chart = sanitizeChart(s.chart) ?? { v: 2, bars: [] };
        return {
          id: `ifp-${s.id}`,
          title: typeof meta.title === 'string' && meta.title ? meta.title : 'Untitled',
          composer: typeof meta.composer === 'string' && meta.composer ? meta.composer : null,
          ...keyOf(meta.key),
          key_name: typeof meta.key === 'string' && /^[A-G][b#]?-?$/.test(meta.key) ? meta.key.replace('-', '') : 'C',
          chords: chartChords(chart),
          playlist: String(l.title),
          href: `/ifakepro/p/${l.slug}/s/${s.id}`,
          updated_at: s.updated_at instanceof Date ? s.updated_at.toISOString() : String(s.updated_at),
        };
      }),
  }));
}
