import { describe, expect, it } from 'vitest';
import { sourceNetwork } from '../source-network';

describe('sourceNetwork (audit Web M3)', () => {
  it('groups IPv4 clients by /24', () => {
    expect(sourceNetwork('203.0.113.77')).toBe('203.0.113.0/24');
    expect(sourceNetwork('::ffff:198.51.100.9')).toBe('198.51.100.0/24');
  });

  it('groups IPv6 clients by /64', () => {
    expect(sourceNetwork('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12::/64');
    expect(sourceNetwork('2001:0db8:0000:0012::1')).toBe('2001:db8:0:12::/64');
    expect(sourceNetwork('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(sourceNetwork('::1')).toBe('0:0:0:0::/64');
    expect(sourceNetwork('fe80::1%en0')).toBe('fe80:0:0:0::/64');
    expect(sourceNetwork('64:ff9b::192.0.2.33')).toBe('64:ff9b:0:0::/64');
  });

  it('is null for a missing or non-IP client', () => {
    expect(sourceNetwork(null)).toBeNull();
    expect(sourceNetwork('')).toBeNull();
    expect(sourceNetwork('unknown')).toBeNull();
  });
});
