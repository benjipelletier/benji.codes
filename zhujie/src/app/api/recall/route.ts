import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ensureTables } from '@/lib/db';
import { updateFamiliarity } from '@/lib/familiarity';

interface RecallRequest {
  yukuaiId: string;
  contentHash: string;
  result: 'success' | 'fail';
}

export async function POST(request: NextRequest) {
  try {
    await ensureTables();

    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Must be logged in' }, { status: 401 });
    }

    const body = (await request.json()) as RecallRequest;
    if (!body.yukuaiId || !body.contentHash || !body.result) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const action = body.result === 'success' ? 'recall_success' : 'recall_fail';
    const newFamiliarity = await updateFamiliarity(userId, body.yukuaiId, action, body.contentHash);

    return NextResponse.json({ familiarity: newFamiliarity });
  } catch (error) {
    console.error('Recall error:', error);
    return NextResponse.json({ error: 'Failed to record recall' }, { status: 500 });
  }
}
