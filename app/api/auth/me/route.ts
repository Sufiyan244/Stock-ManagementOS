import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ data: { user: user ? { id: user.id, email: user.email, user_metadata: { display_name: user.display_name } } : null }, error: null });
}
