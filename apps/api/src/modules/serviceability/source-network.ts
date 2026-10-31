import { isIPv4, isIPv6 } from 'node:net';

/**
 * The network a waitlist request came from, as a CIDR string: the IPv4 /24 or the IPv6 /64
 * (security audit Web M3). Limits apply per network, not per address — one home or office, or one
 * IPv6 customer allocation, shares a budget. Only the prefix is stored, never the full address.
 * Returns null for anything that is not an IP (unknown client).
 */
export function sourceNetwork(ip: string | null | undefined): string | null {
  const address = ip?.trim().replace(/%.*$/, '') ?? '';
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mapped) return ipv4Net(mapped);
  if (isIPv4(address)) return ipv4Net(address);
  if (isIPv6(address)) return ipv6Net(address);
  return null;
}

function ipv4Net(address: string): string {
  const [a, b, c] = address.split('.');
  return `${a}.${b}.${c}.0/24`;
}

/** The first four 16-bit groups of a valid IPv6 address, normalised (no leading zeros). */
function ipv6Net(address: string): string {
  const [head = '', tail = ''] = address.toLowerCase().split('::');
  const groupsOf = (part: string): string[] => {
    if (part === '') return [];
    // An embedded IPv4 suffix counts as two groups; it only affects groups 7-8, past the /64.
    return part.split(':').flatMap((g) => (g.includes('.') ? ['0', '0'] : [g]));
  };
  const left = groupsOf(head);
  const right = address.includes('::') ? groupsOf(tail) : [];
  const zeros = Array.from({ length: 8 - left.length - right.length }, () => '0');
  const groups = address.includes('::') ? [...left, ...zeros, ...right] : left;
  const prefix = groups.slice(0, 4).map((g) => Number.parseInt(g, 16).toString(16));
  return `${prefix.join(':')}::/64`;
}
