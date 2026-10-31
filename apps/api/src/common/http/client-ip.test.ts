import { describe, expect, it } from 'vitest';
import { clientIp, ipBucket, ipBucketPrefix } from './client-ip';

describe('clientIp (security audit H1)', () => {
  it('H1: strips the IPv4-mapped prefix so IPv4 clients are IPv4', () => {
    expect(clientIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(clientIp('::FFFF:5.6.7.8')).toBe('5.6.7.8');
  });

  it('keeps plain IPv4 and IPv6 addresses (IPv6 lower-cased)', () => {
    expect(clientIp('10.0.0.1')).toBe('10.0.0.1');
    expect(clientIp('2001:DB8::1')).toBe('2001:db8::1');
  });

  it('H1: a garbage or missing address is null, never passed on to an inet cast', () => {
    for (const bad of [
      undefined,
      null,
      '',
      'garbage',
      '1.2.3.4, 5.6.7.8',
      "1.2.3.4'--",
      '::ffff:x',
    ]) {
      expect(clientIp(bad)).toBeNull();
    }
  });
});

describe('ipBucket (security audit H1)', () => {
  it('H1: two IPv4 clients behind ::ffff: are two buckets, not one ::/64', () => {
    const a = ipBucket(clientIp('::ffff:1.2.3.4'));
    const b = ipBucket(clientIp('::ffff:5.6.7.8'));
    expect(a).toBe('1.2.3.4/32');
    expect(b).toBe('5.6.7.8/32');
    expect(a).not.toBe(b);
  });

  it('even an un-normalised mapped address is bucketed as its IPv4 /32', () => {
    expect(ipBucket('::ffff:1.2.3.4')).toBe('1.2.3.4/32');
  });

  it('counts IPv6 per /64', () => {
    expect(ipBucket('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:db8:1:2:bbbb::9')).toBe('2001:db8:1:2::/64');
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });

  it('puts every unknown address in one shared bucket (no bypass by sending garbage)', () => {
    expect(ipBucket(null)).toBe('unknown');
    expect(ipBucket('garbage')).toBe('unknown');
  });

  it('gives the CIDR prefix length to count with: /32 for IPv4, /64 for IPv6', () => {
    expect(ipBucketPrefix('1.2.3.4')).toBe(32);
    expect(ipBucketPrefix('2001:db8::1')).toBe(64);
  });
});
