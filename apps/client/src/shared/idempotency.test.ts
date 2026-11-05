import { describe, expect, it } from 'vitest';
import { claimKey, fingerprint, releaseKey } from './idempotency';

const minter = () => {
  let n = 0;
  return () => {
    n += 1;
    return `key-000${n}`;
  };
};

describe('claimKey', () => {
  it('reuses the key for a retry of the same request', () => {
    const mint = minter();
    const first = claimKey({}, 'create', 'body-a', mint);
    const retry = claimKey(first.ring, 'create', 'body-a', mint);
    expect(retry.key).toBe(first.key);
    expect(retry.ring).toBe(first.ring);
  });

  it('mints a fresh key when the request changed', () => {
    const mint = minter();
    const first = claimKey({}, 'create', 'body-a', mint);
    const changed = claimKey(first.ring, 'create', 'body-b', mint);
    expect(changed.key).not.toBe(first.key);
    expect(changed.ring.create).toEqual({ key: changed.key, fingerprint: 'body-b' });
  });

  it('keeps scopes independent and never mutates the ring', () => {
    const mint = minter();
    const ring = Object.freeze({});
    const create = claimKey(ring, 'create', 'x', mint);
    const pay = claimKey(create.ring, 'pay:booking-1', 'x', mint);
    expect(ring).toEqual({});
    expect(Object.keys(pay.ring).sort()).toEqual(['create', 'pay:booking-1']);
    expect(pay.key).not.toBe(create.key);
  });
});

describe('fingerprint', () => {
  it('ignores property order', () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(
      fingerprint({ b: { d: [1, 2], c: 2 }, a: 1 }),
    );
  });

  it('changes when a value changes', () => {
    expect(fingerprint({ modelReleaseConsent: false })).not.toBe(
      fingerprint({ modelReleaseConsent: true }),
    );
  });
});

describe('releaseKey', () => {
  it('drops one scope so the next request there is a new intent, without mutating', () => {
    const ring = {
      ticket: { key: 'k1', fingerprint: 'a' },
      create: { key: 'k2', fingerprint: 'b' },
    };
    const released = releaseKey(ring, 'ticket');
    expect(released).toEqual({ create: { key: 'k2', fingerprint: 'b' } });
    expect(ring.ticket.key).toBe('k1');
    expect(releaseKey(released, 'ticket')).toBe(released);
  });
});
