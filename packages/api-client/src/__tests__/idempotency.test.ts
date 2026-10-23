import { describe, expect, it } from 'vitest';
import { isValidIdempotencyKey, newIdempotencyKey } from '../idempotency.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newIdempotencyKey', () => {
  it('uses crypto.randomUUID when the runtime has it', () => {
    expect(newIdempotencyKey({ randomUUID: () => 'from-random-uuid' })).toBe('from-random-uuid');
  });

  it('builds a v4 UUID from getRandomValues when randomUUID is missing (Hermes)', () => {
    const key = newIdempotencyKey({
      getRandomValues: <T extends ArrayBufferView>(array: T): T => {
        new Uint8Array(array.buffer).fill(0xab);
        return array;
      },
    });
    expect(key).toMatch(UUID_V4);
  });

  it('still produces a valid, unique key with no Web Crypto at all', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newIdempotencyKey(undefined)));
    expect(keys.size).toBe(50);
    for (const key of keys) {
      expect(key).toMatch(UUID_V4);
      expect(isValidIdempotencyKey(key)).toBe(true);
    }
  });

  it('defaults to the global crypto', () => {
    expect(isValidIdempotencyKey(newIdempotencyKey())).toBe(true);
  });
});

describe('isValidIdempotencyKey', () => {
  it('mirrors the API format', () => {
    expect(isValidIdempotencyKey('abcd1234')).toBe(true);
    expect(isValidIdempotencyKey('a.b_c:d-e1')).toBe(true);
    expect(isValidIdempotencyKey('short')).toBe(false);
    expect(isValidIdempotencyKey('has space 123')).toBe(false);
    expect(isValidIdempotencyKey('x'.repeat(129))).toBe(false);
  });
});
