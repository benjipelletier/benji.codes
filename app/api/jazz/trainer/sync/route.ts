import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../db';
import { requireSessionUser } from '@jazz/lib/session-user';
import { applySync } from '../sync';

export const dynamic = 'force-dynamic';

// The device's answers, schedules, runs and library edits (see ../sync.ts). Owner only.
export async function POST(request: NextRequest) {
  let user;
  try {
    user = await requireSessionUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Bad body' }, { status: 400 });
  const received = await applySync(getDb(), user.id, body);
  return NextResponse.json({ ok: true, received });
}
