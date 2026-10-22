import { describe, expect, it } from 'vitest';
import { expandPincodes, LAUNCH_CITIES } from './launch-cities';

describe('launch cities seed', () => {
  it('launches Surat and Mumbai LIVE and Vadodara as PILOT (v0.2 §7)', () => {
    expect(LAUNCH_CITIES.map((c) => [c.name, c.status])).toEqual([
      ['Surat', 'LIVE'],
      ['Mumbai', 'LIVE'],
      ['Vadodara', 'PILOT'],
    ]);
  });

  it('uses the doc 05 city tiers (Mumbai METRO; Surat, Vadodara TIER_1)', () => {
    expect(LAUNCH_CITIES.map((c) => c.tier)).toEqual(['TIER_1', 'METRO', 'TIER_1']);
  });

  it('produces valid, unique pincodes', () => {
    const all = LAUNCH_CITIES.flatMap((c) => expandPincodes(c.pincodeRanges));
    expect(all.every((p) => /^[1-9]\d{5}$/.test(p))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it('expands inclusive ranges', () => {
    expect(expandPincodes([[395001, 395003]])).toEqual(['395001', '395002', '395003']);
  });
});
