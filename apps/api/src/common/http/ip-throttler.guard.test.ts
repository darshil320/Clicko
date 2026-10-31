import { describe, expect, it } from 'vitest';
import { IpThrottlerGuard } from './ip-throttler.guard';

/** Exposes the protected tracker for the test. */
class Probe extends IpThrottlerGuard {
  track(req: Record<string, unknown>) {
    return this.getTracker(req);
  }
}

describe('IpThrottlerGuard tracker (security audit H1)', () => {
  const probe = Object.create(Probe.prototype) as Probe;

  it('H1: two IPv4 clients behind ::ffff: get two throttle buckets', async () => {
    expect(await probe.track({ ip: '::ffff:1.2.3.4' })).toBe('1.2.3.4/32');
    expect(await probe.track({ ip: '::ffff:5.6.7.8' })).toBe('5.6.7.8/32');
  });

  it('H1: a missing or garbage address shares one bucket (cannot escape the limit)', async () => {
    expect(await probe.track({})).toBe('unknown');
    expect(await probe.track({ ip: 'garbage' })).toBe('unknown');
  });
});
