import { NextResponse } from 'next/server';
import { getViewer } from '@voiceshed/lib/session';

export const dynamic = 'force-dynamic';

/** Signed in as the owner (answers upload) or a spectator (kept on the device). */
export async function GET() {
  const v = await getViewer();
  return NextResponse.json({ signedIn: !!v.email, email: v.email, isOwner: v.isOwner, isSpectator: !v.isOwner });
}
