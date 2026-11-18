import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getCurrentUser } from '@/lib/session';
import { executeRpc } from '@/lib/db/rpc';
import type { DbContext } from '@/lib/db/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
    const db = await getDb();
    const profile = await db.collection('profiles').findOne({ _id: user.id });
    const business = profile?.business_id ? await db.collection('businesses').findOne({ _id: profile.business_id }) : null;
    const context: DbContext = { user, profile, business, owner: Boolean(await db.collection('owner_accounts').findOne({ _id: user.id })) };
    const body = await request.json();
    const result = await executeRpc(db, context, String(body.name || ''), body.args || {});
    return NextResponse.json(result, { status: result.error ? 400 : 200 });
  } catch (error) {
    return NextResponse.json({ data: null, error: { message: error instanceof Error ? error.message : 'Database request failed.' } }, { status: 500 });
  }
}
