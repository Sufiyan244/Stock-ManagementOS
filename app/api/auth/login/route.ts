import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { createSessionToken, setSessionCookie } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    const db = await getDb();
    const user = await db.collection('users').findOne({ email });
    if (!user || !await bcrypt.compare(password, String(user.password_hash || ''))) {
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }
    const token = createSessionToken({ id: String(user._id), email: user.email, display_name: user.display_name || '' });
    const response = NextResponse.json({ data: { user: { id: String(user._id), email: user.email } }, error: null });
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to sign in.' }, { status: 500 });
  }
}
