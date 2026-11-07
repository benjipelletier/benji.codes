import type { NeonQueryFunction } from '@neondatabase/serverless';
import { ensureTrainer } from './schema';
import { isQuality } from '@voiceshed/lib/theory';

const MODES = new Set(['play', 'spell', 'name']);
const CONTEXT_TYPES = new Set(['isolated', 'progression', 'tune']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE = /^[A-G](bb|##|b|#)?-?\d$/;
const MAX_ROWS = 5000;

const isId = (x: unknown): x is string => typeof x === 'string' && UUID.test(x);
const isTime = (x: unknown): x is string => typeof x === 'string' && !Number.isNaN(Date.parse(x));
const num = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const str = (x: unknown, max = 500) => (typeof x === 'string' ? x.slice(0, max) : null);
const list = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.slice(0, MAX_ROWS).filter(r => r && typeof r === 'object') : []);

// Applies what the device did while offline (or since its last sync), sent in one
// go: library edits first (a new voicing's answers need it there), then
// answers, schedules and runs. Every write is safe to send twice: answers
// and runs keep their device-made ids, and a schedule is replaced only by a
// newer one. Answers for a voicing deleted meanwhile are dropped.
export async function applySync(sql: NeonQueryFunction<false, false>, userId: string, body: Record<string, unknown>) {
  await ensureTrainer(sql);

  const upserts = list(body.voicingUpserts)
    .filter(
      v =>
        isId(v.id) &&
        typeof v.chord_label === 'string' &&
        num(v.root, 0, 11) &&
        typeof v.quality === 'string' &&
        isQuality(v.quality) &&
        Array.isArray(v.notes) &&
        v.notes.length > 0 &&
        v.notes.length <= 10 &&
        v.notes.every(n => typeof n === 'string' && NOTE.test(n)),
    )
    .map(v => ({
      id: v.id,
      chord_label: str(v.chord_label, 40),
      root: v.root,
      quality: v.quality,
      notes: v.notes,
      top_note: (v.notes as string[])[(v.notes as string[]).length - 1],
      family: str(v.family, 40) || 'custom',
      tags: Array.isArray(v.tags) ? (v.tags as unknown[]).filter(t => typeof t === 'string').map(t => (t as string).slice(0, 40)).slice(0, 30) : [],
      lowest_register: num(v.lowest_register, 0, 127) ? v.lowest_register : null,
      notes_text: str(v.notes_text, 2000),
      // Where it was heard: an http(s) link, seconds in, the song.
      source_url: typeof v.source_url === 'string' && /^https?:\/\/\S+$/.test(v.source_url) ? v.source_url.slice(0, 500) : null,
      source_time: num(v.source_time, 0, 36000) ? Math.round(v.source_time as number) : null,
      source_label: str(v.source_label, 200),
      source_tune_id: str(v.source_tune_id, 100),
      source_tune_title: str(v.source_tune_title, 200),
      sort_order: num(v.sort_order, -1e9, 1e9) ? Math.round(v.sort_order as number) : 0,
      updated_at: isTime(v.updated_at) ? v.updated_at : new Date().toISOString(),
    }));
  const deletes = (Array.isArray(body.voicingDeletes) ? body.voicingDeletes : []).filter(isId).slice(0, MAX_ROWS);

  // Cards taken out of the deck: their schedules go (answers stay).
  const srsDeletes = list(body.srsDeletes)
    .filter(d => isId(d.voicing_id) && MODES.has(d.mode as string))
    .map(d => ({ voicing_id: d.voicing_id, mode: d.mode }));

  const attempts = list(body.attempts)
    .filter(a => isId(a.id) && isId(a.voicing_id) && MODES.has(a.mode as string) && CONTEXT_TYPES.has(a.context_type as string) && typeof a.correct === 'boolean' && num(a.response_ms, 0, 3_600_000) && isTime(a.created_at))
    .map(a => ({
      id: a.id,
      voicing_id: a.voicing_id,
      mode: a.mode,
      context_type: a.context_type,
      context_id: isId(a.context_id) ? a.context_id : null,
      run_id: isId(a.run_id) ? a.run_id : null,
      correct: a.correct,
      slow: a.slow === true,
      response_ms: Math.round(a.response_ms as number),
      created_at: a.created_at,
    }));

  const srs = list(body.srs)
    .filter(s => isId(s.voicing_id) && MODES.has(s.mode as string) && num(s.ease, 0, 10) && num(s.interval_days, 0, 10000) && isTime(s.due_at) && isTime(s.created_at) && isTime(s.updated_at))
    .map(s => ({
      voicing_id: s.voicing_id,
      mode: s.mode,
      ease: s.ease,
      interval_days: s.interval_days,
      due_at: s.due_at,
      target_ms: num(s.target_ms, 200, 60_000) ? Math.round(s.target_ms as number) : null,
      learned: s.learned === true,
      reps: num(s.reps, 0, 1e7) ? Math.round(s.reps as number) : 0,
      lapses: num(s.lapses, 0, 1e7) ? Math.round(s.lapses as number) : 0,
      created_at: s.created_at,
      updated_at: s.updated_at,
    }));

  const runs = list(body.runs)
    .filter(r => isId(r.id) && typeof r.set_key === 'string' && MODES.has(r.mode as string) && CONTEXT_TYPES.has(r.context_type as string) && isTime(r.started_at) && isTime(r.finished_at))
    .map(r => ({
      id: r.id,
      set_key: str(r.set_key, 300),
      set_label: str(r.set_label, 300) ?? '',
      mode: r.mode,
      context_type: r.context_type,
      started_at: r.started_at,
      finished_at: r.finished_at,
      cards: num(r.cards, 0, 1e6) ? Math.round(r.cards as number) : 0,
      correct: num(r.correct, 0, 1e6) ? Math.round(r.correct as number) : 0,
      avg_ms: num(r.avg_ms, 0, 3_600_000) ? Math.round(r.avg_ms as number) : 0,
      slow: num(r.slow, 0, 1e6) ? Math.round(r.slow as number) : 0,
    }));

  if (upserts.length) {
    const json = JSON.stringify(upserts);
    // Edits to voicings already there (newer edits win)…
    await sql.query(
      `UPDATE voicings v SET chord_label = t.chord_label, root = t.root, quality = t.quality, notes = t.notes,
         top_note = t.top_note, family = t.family, tags = t.tags, lowest_register = t.lowest_register,
         notes_text = t.notes_text, sort_order = t.sort_order, updated_at = t.updated_at,
         source_url = t.source_url, source_time = t.source_time, source_label = t.source_label,
         source_tune_id = t.source_tune_id, source_tune_title = t.source_tune_title
       FROM jsonb_to_recordset($1::jsonb) AS t(id uuid, chord_label text, root int, quality text, notes text[], top_note text,
         family text, tags text[], lowest_register int, notes_text text, sort_order int, updated_at timestamptz,
         source_url text, source_time int, source_label text, source_tune_id text, source_tune_title text)
       WHERE v.id = t.id AND v.updated_at <= t.updated_at`,
      [json],
    );
    // …and new ones (one already in the library with the same notes is left as it is).
    await sql.query(
      `INSERT INTO voicings (id, chord_label, root, quality, notes, top_note, family, tags, lowest_register, notes_text, sort_order, updated_at,
         source_url, source_time, source_label, source_tune_id, source_tune_title)
       SELECT id, chord_label, root, quality, notes, top_note, family, tags, lowest_register, notes_text, sort_order, updated_at,
         source_url, source_time, source_label, source_tune_id, source_tune_title
       FROM jsonb_to_recordset($1::jsonb) AS t(id uuid, chord_label text, root int, quality text, notes text[], top_note text,
         family text, tags text[], lowest_register int, notes_text text, sort_order int, updated_at timestamptz,
         source_url text, source_time int, source_label text, source_tune_id text, source_tune_title text)
       ON CONFLICT DO NOTHING`,
      [json],
    );
  }
  if (deletes.length) {
    await sql.query(`DELETE FROM voicings WHERE id = ANY($1::uuid[])`, [deletes]);
  }
  // Before the schedules below: a card taken out then put back arrives as a schedule and wins.
  if (srsDeletes.length) {
    await sql.query(
      `DELETE FROM srs_state s USING jsonb_to_recordset($1::jsonb) AS t(voicing_id uuid, mode text)
       WHERE s.user_id = $2 AND s.voicing_id = t.voicing_id AND s.mode = t.mode`,
      [JSON.stringify(srsDeletes), userId],
    );
  }
  if (attempts.length) {
    await sql.query(
      `INSERT INTO attempts (id, user_id, voicing_id, mode, context_type, context_id, run_id, correct, slow, response_ms, created_at)
       SELECT t.id, $2, t.voicing_id, t.mode, t.context_type, t.context_id, t.run_id, t.correct, t.slow, t.response_ms, t.created_at
       FROM jsonb_to_recordset($1::jsonb) AS t(id uuid, voicing_id uuid, mode text, context_type text, context_id uuid,
         run_id uuid, correct boolean, slow boolean, response_ms int, created_at timestamptz)
       WHERE EXISTS (SELECT 1 FROM voicings v WHERE v.id = t.voicing_id)
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(attempts), userId],
    );
  }
  if (srs.length) {
    await sql.query(
      `INSERT INTO srs_state (user_id, voicing_id, mode, ease, interval_days, due_at, target_ms, learned, reps, lapses, created_at, updated_at)
       SELECT $2, t.voicing_id, t.mode, t.ease, t.interval_days, t.due_at, t.target_ms, t.learned, t.reps, t.lapses, t.created_at, t.updated_at
       FROM jsonb_to_recordset($1::jsonb) AS t(voicing_id uuid, mode text, ease real, interval_days real, due_at timestamptz,
         target_ms int, learned boolean, reps int, lapses int, created_at timestamptz, updated_at timestamptz)
       WHERE EXISTS (SELECT 1 FROM voicings v WHERE v.id = t.voicing_id)
       ON CONFLICT (user_id, voicing_id, mode) DO UPDATE SET
         ease = EXCLUDED.ease, interval_days = EXCLUDED.interval_days, due_at = EXCLUDED.due_at,
         target_ms = EXCLUDED.target_ms, learned = EXCLUDED.learned, reps = EXCLUDED.reps,
         lapses = EXCLUDED.lapses, updated_at = EXCLUDED.updated_at
       WHERE srs_state.updated_at <= EXCLUDED.updated_at`,
      [JSON.stringify(srs), userId],
    );
  }
  if (runs.length) {
    await sql.query(
      `INSERT INTO voicing_runs (id, user_id, set_key, set_label, mode, context_type, started_at, finished_at, cards, correct, avg_ms, slow)
       SELECT t.id, $2, t.set_key, t.set_label, t.mode, t.context_type, t.started_at, t.finished_at, t.cards, t.correct, t.avg_ms, t.slow
       FROM jsonb_to_recordset($1::jsonb) AS t(id uuid, set_key text, set_label text, mode text, context_type text,
         started_at timestamptz, finished_at timestamptz, cards int, correct int, avg_ms int, slow int)
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(runs), userId],
    );
  }

  return { voicings: upserts.length, deleted: deletes.length, unscheduled: srsDeletes.length, attempts: attempts.length, srs: srs.length, runs: runs.length };
}
