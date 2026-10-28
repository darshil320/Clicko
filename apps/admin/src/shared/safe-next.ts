import { deskOf } from './access';

const DEL = 0x7f;
const FIRST_PRINTABLE = 0x20;

/** Backslashes and control characters: URL parsers turn `/\evil` and `/\t/evil` into `//evil`. */
function hasUnsafeChar(path: string): boolean {
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (char === '\\' || code < FIRST_PRINTABLE || code === DEL) return true;
  }
  return false;
}

/**
 * Where to go after sign-in: only a path on this panel that opens a desk, without its query string
 * (a board search can hold a client's phone number — security review M1, L4). Anything else is
 * dropped, never followed: `/\evil.example`, `/%09/evil.example`, `//evil.example`, `/sign-in`.
 */
export function safeNext(next: string | null | undefined, origin: string): string | null {
  if (!next?.startsWith('/') || hasUnsafeChar(next)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return null;
  }
  if (hasUnsafeChar(decoded) || decoded.startsWith('//')) return null;
  const url = new URL(next, origin);
  if (url.origin !== origin || deskOf(url.pathname) === null) return null;
  return url.pathname;
}
