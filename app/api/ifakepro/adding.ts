import 'server-only';
import { HttpError } from '@ifakepro/lib/session';
import { EMPTY_META, sanitizeMeta } from '@ifakepro/lib/chart';
import { FORMS, type FormId, formChart } from '@ifakepro/lib/forms';
import { parseIReal } from '@ifakepro/lib/ireal';
import { loadStandards } from '@ifakepro/lib/standards';
import type { NewSong } from './store';

export interface SongsToAdd {
  songs: NewSong[];
  kind: 'create' | 'import';
  versionSummary: string;
  activity: { kind: string; summary: string };
}

const some = (n: number, what: string) => (n === 1 ? what : `${n} songs`);

/**
 * The songs a request asks to add, from one of:
 *   { blank: { title?, key?, style?, form? } }   a new chart: empty, or a form (blues, AABA…)
 *   { ireal: "<link or exported HTML>", include? } songs from iReal Pro (include: indices to keep)
 *   { standards: [index, …] }                    copies from the standards library
 */
export function songsToAdd(body: Record<string, unknown>): SongsToAdd | null {
  if (body.blank && typeof body.blank === 'object') {
    const blank = body.blank as { form?: unknown; time?: unknown };
    const meta = sanitizeMeta({ ...EMPTY_META, ...(body.blank as object) });
    const form = FORMS.some((f) => f.id === blank.form) ? (blank.form as FormId) : 'empty';
    const time = typeof blank.time === 'string' && /^\d{1,2}\/(2|4|8)$/.test(blank.time) ? blank.time : '4/4';
    return {
      songs: [{ meta, chart: formChart(form, meta.key, time) }],
      kind: 'create',
      versionSummary: 'Created',
      activity: { kind: 'song.create', summary: `Added “${meta.title}”` },
    };
  }
  if (typeof body.ireal === 'string') {
    let parsed;
    try {
      parsed = parseIReal(body.ireal);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : 'Could not read that iReal link');
    }
    let songs = parsed.songs;
    if (Array.isArray(body.include)) {
      const keep = new Set(body.include.filter((n): n is number => typeof n === 'number'));
      songs = songs.filter((_, i) => keep.has(i));
    }
    if (!songs.length) throw new HttpError(400, 'No songs to import');
    if (songs.length > 2000) throw new HttpError(400, 'Too many songs in one import (2,000 at most)');
    return {
      songs,
      kind: 'import',
      versionSummary: 'Imported from iReal Pro',
      activity: { kind: 'song.import', summary: `Imported ${some(songs.length, `“${songs[0].meta.title}”`)} from iReal Pro` },
    };
  }
  if (Array.isArray(body.standards)) {
    const lib = loadStandards();
    const songs = body.standards
      .filter((n): n is number => typeof n === 'number' && lib[n] !== undefined)
      .slice(0, 500)
      .map((n) => structuredClone({ meta: lib[n].meta, chart: lib[n].chart }));
    if (!songs.length) throw new HttpError(400, 'No standards picked');
    return {
      songs,
      kind: 'import',
      versionSummary: 'Added from the standards',
      activity: { kind: 'song.import', summary: `Added ${some(songs.length, `“${songs[0].meta.title}”`)} from the standards` },
    };
  }
  return null;
}
