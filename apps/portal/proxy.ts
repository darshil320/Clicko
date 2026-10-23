import { type NextRequest, NextResponse } from 'next/server';
import { API_URL } from './src/shared/api';
import { contentSecurityPolicy } from './src/shared/security-headers';

/**
 * A fresh CSP nonce per page view (security review M7). Next applies it to its own scripts and
 * styles; the root layout passes it to the token stylesheet.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy({
    nonce,
    apiOrigin: new URL(API_URL).origin,
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
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
