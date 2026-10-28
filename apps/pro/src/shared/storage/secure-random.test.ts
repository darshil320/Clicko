import { describe, expect, it, vi } from 'vitest';
import { secureRandomBytes } from './secure-random';

describe('secureRandomBytes', () => {
  it('uses Web Crypto when the runtime has it', () => {
    const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
      new Uint8Array(array.buffer).fill(5);
      return array;
    };
    const uuidv4 = vi.fn(() => '00000000-0000-4000-8000-000000000000');
    const bytes = secureRandomBytes(32, { crypto: { getRandomValues }, expo: { uuidv4 } });
    expect(bytes).toEqual(new Uint8Array(32).fill(5));
    expect(uuidv4).not.toHaveBeenCalled();
  });

  it("falls back to Expo's native uuidv4, keeping only the random hex digits", () => {
    const uuidv4 = vi.fn(() => '00112233-4455-4677-8899-aabbccddeeff');
    const bytes = secureRandomBytes(15, { expo: { uuidv4 } });
    // Digit 12 ("4", the version) and digit 16 ("8", the variant) are dropped.
    expect(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')).toBe(
      '001122334455677899aabbccddeeff',
    );
    expect(uuidv4).toHaveBeenCalledTimes(1);
  });

  it('draws as many UUIDs as the length needs (15 bytes each)', () => {
    let n = 0;
    const uuidv4 = vi.fn(() => `0000000${n++}-0000-4000-8000-000000000000`);
    expect(secureRandomBytes(32, { expo: { uuidv4 } })).toHaveLength(32);
    expect(uuidv4).toHaveBeenCalledTimes(3);
  });

  it('rejects anything that is not a version 4 UUID', () => {
    const uuidv4 = () => '00112233-4455-1677-8899-aabbccddeeff';
    expect(() => secureRandomBytes(16, { expo: { uuidv4 } })).toThrow(/version 4/);
  });

  it('throws rather than fall back to Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    expect(() => secureRandomBytes(32, {})).toThrow(/No cryptographically secure/);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('reads globalThis by default', () => {
    const bytes = secureRandomBytes(32);
    expect(bytes).toHaveLength(32);
    expect(new Set(bytes).size).toBeGreaterThan(1);
  });
});
