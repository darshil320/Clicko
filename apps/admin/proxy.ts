import { type NextRequest, NextResponse } from 'next/server';
import { contentSecurityPolicy, resolveApiUrl } from './src/shared/security-headers';

const API_ORIGIN = new URL(resolveApiUrl(process.env.NEXT_PUBLIC_API_URL, false)).origin;

/**
 * A fresh CSP nonce per page view (ADR-0025 D6, as the portal — ADR-0015 M7). Next applies it to
 * its own scripts and styles; the root layout passes it to the token stylesheet.
 */
export function proxy(request: NextRequest) {
  // The simulators exist for development only: outside it, /dev is a 404 before any page or
  // layout renders (security review L5; app/dev/layout.tsx is the second guard).
  const path = request.nextUrl.pathname;
  if (process.env.NODE_ENV !== 'development' && (path === '/dev' || path.startsWith('/dev/'))) {
    return new NextResponse(null, { status: 404 });
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy({
    nonce,
    apiOrigin: API_ORIGIN,
    dev: process.env.NODE_ENV === 'development',
  });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      // Only Next's own data prefetches skip the proxy; a full-page prefetch still gets its CSP
      // (security review L6).
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
