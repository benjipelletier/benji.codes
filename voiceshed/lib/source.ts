// Where a found voicing was heard (the owner: "log extra voicings I hear in the
// wild … linked to a certain time in a YouTube video or a Spotify song, so I
// always have that reference"): reading a link, a time, and making a link that
// opens at that time where the site allows it.

export type SourceKind = 'youtube' | 'spotify' | 'link';

/** "1:23", "83", "1:02:03" → seconds; null when it isn't a time. */
export function parseTime(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Seconds as "1:23" (or "1:02:03"). */
export function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** A link's site, and the time it already carries (YouTube's t=1m23s / t=83, Spotify's #1:23), if any. */
export function readSource(url: string): { kind: SourceKind; time: number | null } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    const t = u.searchParams.get('t') ?? u.searchParams.get('start');
    let time: number | null = null;
    if (t) {
      const hms = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
      if (hms) time = Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0);
    }
    return { kind: 'youtube', time };
  }
  if (host === 'open.spotify.com' || host === 'spotify.link') {
    const time = u.hash ? parseTime(u.hash.slice(1)) : null;
    return { kind: 'spotify', time };
  }
  return { kind: 'link', time: null };
}

/** The link to open: YouTube at the time (t=…s); others as given (Spotify can't be trusted to jump). */
export function sourceHref(url: string, time: number | null | undefined): string {
  const src = readSource(url);
  if (!src) return url;
  if (src.kind === 'youtube' && time != null) {
    const u = new URL(url.trim());
    u.searchParams.delete('start');
    u.searchParams.set('t', `${time}s`);
    return u.toString();
  }
  return url.trim();
}

export const SOURCE_NAME: Record<SourceKind, string> = { youtube: 'YouTube', spotify: 'Spotify', link: 'link' };
