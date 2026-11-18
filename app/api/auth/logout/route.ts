import { NextResponse } from 'next/server';
import { clearSessionCookieOnResponse } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST() {
  const response = NextResponse.json({ data: null, error: null });
  clearSessionCookieOnResponse(response);
  return response;
}
