import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../db';
import { getViewer, ownerEmail } from '@voicebox/lib/session';
import { applySync } from '../sync';

export const dynamic = 'force-dynamic';

// The device's answers, schedules, runs and library edits (see ../sync.ts). Owner only.
export async function POST(request: NextRequest) {
  const { isOwner } = await getViewer();
  if (!isOwner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Bad body' }, { status: 400 });
  const received = await applySync(getDb(), ownerEmail()!, body);
  return NextResponse.json({ ok: true, received });
}
