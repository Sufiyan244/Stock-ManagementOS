import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { processOwnerMessages } from '@/lib/db/rpc';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || supplied !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const delivered = await processOwnerMessages(await getDb());
    return NextResponse.json({ delivered });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Reminder processing failed.' }, { status: 500 });
  }
}
