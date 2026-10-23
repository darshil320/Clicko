import { describe, expect, it } from 'vitest';
import { venueArea } from './venue';

describe('venueArea', () => {
  it('keeps the area and city from a full address', () => {
    expect(venueArea('14, Rajhans Platinum, Vesu, Surat', 'Surat')).toBe('Vesu, Surat');
    expect(venueArea('Flat 9, Sea Breeze, Bandra West, Mumbai', 'Mumbai')).toBe(
      'Bandra West, Mumbai',
    );
  });

  it('falls back to the city when the address has no separate area', () => {
    expect(venueArea('Alkapuri', 'Vadodara')).toBe('Vadodara');
    expect(venueArea('Near the station, Surat', 'Surat')).toBe('Near the station, Surat');
    expect(venueArea('Surat, Surat', 'Surat')).toBe('Surat');
  });
});
