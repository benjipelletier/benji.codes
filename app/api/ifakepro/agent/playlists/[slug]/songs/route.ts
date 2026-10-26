import { NextResponse } from 'next/server';
import { HttpError } from '@ifakepro/lib/session';
import { EMPTY_META, blankChart, meter, sanitizeMeta } from '@ifakepro/lib/chart';
import { parseKey } from '@ifakepro/lib/chords';
import { replaceEvents } from '@ifakepro/lib/edit';
import { FORMS, type FormId, formChart } from '@ifakepro/lib/forms';
import { parseProgression } from '@ifakepro/lib/progression';
import { chartText } from '@ifakepro/lib/script';
import { agentMark, agentMayEdit, agentUser, songUrl } from '../../../../agent';
import { findPlaylist, handle, insertSongs, readBody } from '../../../../store';

/**
 * A new song from the agent: { title, key?, time?, form?, bars?, text?,
 * composer?, style?, bpm?, note? }. text (the Type panel's syntax) gives the
 * chords, else a form (blues, AABA…), else `bars` empty bars.
 */
export const POST = handle<{ slug: string }>(async (req, { slug }) => {
  const user = await agentUser(req);
  const p = await findPlaylist(slug);
  await agentMayEdit(p.id, user);
  const body = await readBody(req);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) throw new HttpError(400, 'title is required');
  const key = body.key == null ? 'C' : typeof body.key === 'string' ? parseKey(body.key) : null;
  if (!key) throw new HttpError(400, `can’t read the key ${JSON.stringify(body.key)} (like "Eb", "F# minor", "Cm")`);
  const time = typeof body.time === 'string' ? body.time.trim() : '4/4';
  if (!/^\d{1,2}\/(2|4|8)$/.test(time)) throw new HttpError(400, 'time is like "4/4", "3/4" or "6/8"');
  const form = body.form == null ? 'empty' : String(body.form);
  if (!FORMS.some((f) => f.id === form)) throw new HttpError(400, `form is one of ${FORMS.map((f) => f.id).join(', ')}`);

  let chart;
  if (typeof body.text === 'string' && body.text.trim()) {
    const bars = parseProgression(body.text, () => meter(time));
    const flagged = bars.flatMap((b, k) => (b.flags.length ? [`bar ${k + 1} (“${b.source}”): ${b.flags.join('; ')}`] : []));
    if (flagged.length) return NextResponse.json({ error: 'refused', message: 'Nothing was made.', errors: flagged }, { status: 422 });
    if (bars.length > 400) throw new HttpError(400, 'at most 400 bars');
    chart = blankChart(bars.length, time);
    bars.forEach((b, k) => (chart = replaceEvents(chart!, k, b.events, b.simile)));
  } else if (form !== 'empty') chart = formChart(form as FormId, key, time);
  else {
    const n = body.bars == null ? 16 : Number(body.bars);
    if (!Number.isInteger(n) || n < 1 || n > 400) throw new HttpError(400, 'bars is 1 to 400');
    chart = blankChart(n, time);
  }
  const meta = sanitizeMeta({ ...EMPTY_META, title, key, composer: body.composer, style: body.style ?? EMPTY_META.style, bpm: body.bpm });
  const mark = agentMark(body);
  const [id] = await insertSongs(p.id, user, [{ meta, chart }], 'create', 'Created', { kind: 'song.create', summary: `Added “${meta.title}”` }, mark);
  return { id, revision: 1, url: songUrl(req, p.slug, id), text: chartText({ meta, chart }) };
});
