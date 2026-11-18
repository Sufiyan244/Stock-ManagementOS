import { NextResponse, type NextRequest } from 'next/server';

// Sessions are signed, HTTP-only cookies and are verified by server-side guards.
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
