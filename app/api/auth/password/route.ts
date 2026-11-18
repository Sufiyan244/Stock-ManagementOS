import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 });
  try {
    const { password } = await request.json();
    if (typeof password !== 'string' || password.length < 8) return NextResponse.json({ error: 'Password must contain at least 8 characters.' }, { status: 400 });
    const db = await getDb();
    await db.collection('users').updateOne({ _id: user.id }, { $set: { password_hash: await bcrypt.hash(password, 12), updated_at: new Date() } });
    return NextResponse.json({ data: { user: { id: user.id, email: user.email } }, error: null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update password.' }, { status: 500 });
  }
}
