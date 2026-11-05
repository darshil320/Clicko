import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { promoPhoneKey } from '../phone-key';

const PEPPER = 'p'.repeat(48);

describe('promoPhoneKey (ADR-0030: promo eligibility outlives a deleted account)', () => {
  it('is stable for one number and differs between numbers', () => {
    const a = promoPhoneKey(PEPPER, '+919999377001');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(promoPhoneKey(PEPPER, '+919999377001')).toBe(a);
    expect(promoPhoneKey(PEPPER, '+919999377002')).not.toBe(a);
  });

  it('is keyed: never the number, never a plain hash, and another secret gives another key', () => {
    const key = promoPhoneKey(PEPPER, '+919999377001');
    expect(key).not.toContain('9999377001');
    expect(key).not.toBe(createHash('sha256').update('+919999377001').digest('hex'));
    expect(promoPhoneKey('q'.repeat(48), '+919999377001')).not.toBe(key);
  });
});
