import { NextResponse } from 'next/server';
import { getDb } from '../db';
import { getViewer, ownerEmail } from '@voiceshed/lib/session';
import { ensureTrainer } from '../schema';

export const dynamic = 'force-dynamic';

/** How many past answers and runs a device keeps for its stats. */
const ATTEMPTS_KEPT = 20000;
const RUNS_KEPT = 500;

// Everything the trainer needs to run with no connection: the library, the
// progressions, and the viewed user's schedules, answers and runs (the
// owner's — a spectator sees it too). The device keeps it all in IndexedDB.
export async function GET() {
  const sql = getDb();
  try {
    await ensureTrainer(sql);
  } catch (err) {
    return NextResponse.json({ error: `Couldn't set up the trainer's tables: ${(err as Error).message}` }, { status: 500 });
  }
  const { isOwner } = await getViewer();
  const isSpectator = !isOwner;
  // Everyone sees the owner's progress.
  const uid = ownerEmail() ?? '';

  const [voicings, contexts, srs, attempts, runs] = await Promise.all([
    sql`
      SELECT id, chord_label, root, quality, notes, top_note, top_move, family, tags, lowest_register,
             notes_text, sort_order, updated_at, source_url, source_time, source_label,
             source_tune_id, source_tune_title
      FROM voicings ORDER BY sort_order, chord_label, family`,
    sql`
      SELECT id, type, name, key, tune_id, steps, sort_order
      FROM contexts ORDER BY type, sort_order, name`,
    sql`
      SELECT voicing_id, mode, ease, interval_days, due_at, target_ms, learned, reps, lapses, created_at, updated_at
      FROM srs_state WHERE user_id = ${uid}`,
    sql`
      SELECT id, voicing_id, mode, context_type, context_id, run_id, correct, slow, response_ms, created_at
      FROM attempts WHERE user_id = ${uid}
      ORDER BY created_at DESC LIMIT ${ATTEMPTS_KEPT}`,
    sql`
      SELECT id, set_key, set_label, mode, context_type, started_at, finished_at, cards, correct, avg_ms, slow
      FROM voicing_runs WHERE user_id = ${uid}
      ORDER BY finished_at DESC LIMIT ${RUNS_KEPT}`,
  ]);

  return NextResponse.json({
    at: new Date().toISOString(),
    viewer: { isOwner, isSpectator },
    voicings,
    contexts,
    srs,
    attempts,
    runs,
  });
}
