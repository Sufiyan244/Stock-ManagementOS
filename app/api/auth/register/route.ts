import { randomUUID } from 'node:crypto';
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
    const displayName = String(body.display_name || '').trim();
    if (!email || !email.includes('@')) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: 'Password must contain at least 8 characters.' }, { status: 400 });
    if (!displayName) return NextResponse.json({ error: 'Full name is required.' }, { status: 400 });
    const db = await getDb();
    if (await db.collection('users').findOne({ email })) return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
    const userId = randomUUID();
    const user = { _id: userId, email, display_name: displayName, password_hash: await bcrypt.hash(password, 12), created_at: new Date(), updated_at: new Date() };
    await db.collection('users').insertOne(user);
    const token = createSessionToken({ id: userId, email, display_name: displayName });
    const response = NextResponse.json({ data: { user: { id: userId, email }, session: { authenticated: true } }, error: null });
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create account.' }, { status: 500 });
  }
}
