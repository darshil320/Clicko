import { isIP } from 'node:net';

/**
 * The one place a request's IP is made usable (security audit H1). Express hands IPv4 clients
 * to a dual-stack socket as `::ffff:a.b.c.d`; left as is, every IPv4 client fell into one IPv6
 * `::/64` rate-limit bucket. Used by the OTP controllers, the throttler tracker, staff sign-in
 * and the audit log.
 */
const MAPPED_V4 = /^::ffff:/i;

/** `::ffff:1.2.3.4` → `1.2.3.4`; IPv6 lower-cased; anything that is not an IP → null. */
export function clientIp(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const unmapped = MAPPED_V4.test(raw) ? raw.slice(7) : raw;
  if (unmapped !== raw && isIP(unmapped) !== 4) return null;
  const family = isIP(unmapped);
  if (family === 4) return unmapped;
  if (family === 6) return unmapped.toLowerCase();
  return null;
}

/** The CIDR prefix an address is counted under: /32 for IPv4, /64 for IPv6 (one subscriber). */
export function ipBucketPrefix(ip: string): 32 | 64 {
  return isIP(ip) === 6 ? 64 : 32;
}

/** Expands an IPv6 address to its eight hextets (already validated by isIP). */
function hextets(ip: string): string[] {
  const [head = '', tail] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  if (tail === undefined) return left;
  const right = tail ? tail.split(':') : [];
  return [
    ...left,
    ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'),
    ...right,
  ];
}

/**
 * A stable rate-limit key: `a.b.c.d/32`, `h:h:h:h::/64`, or `unknown` — every request without a
 * usable address shares one bucket, so garbage cannot be used to escape the limit.
 */
export function ipBucket(raw: string | null | undefined): string {
  const ip = clientIp(raw);
  if (ip === null) return 'unknown';
  if (isIP(ip) === 4) return `${ip}/32`;
  const groups = hextets(ip)
    .slice(0, 4)
    .map((g) => Number.parseInt(g || '0', 16).toString(16));
  return `${groups.join(':')}::/64`;
}
