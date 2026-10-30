import { describe, expect, it } from 'vitest';
import { bookingDescription, bookingLabel, bookingSearchText } from './command-search';

describe('the ⌘K booking search (ADR-0026 D8)', () => {
  it('searches from two characters, trimmed, at most 80', () => {
    expect(bookingSearchText(' C ')).toBeNull();
    expect(bookingSearchText(' CL ')).toBe('CL');
    expect(bookingSearchText('x'.repeat(90))?.length).toBe(80);
  });

  it('labels a result in plain words, IST', () => {
    const row = {
      reference: 'CLK-4821',
      clientName: 'Rahul Mehta',
      cityName: 'Surat',
      scheduledStart: '2026-11-14T11:00:00.000Z',
      status: 'DISPATCHING' as const,
    };
    expect(bookingLabel(row)).toBe('CLK-4821 · Rahul Mehta');
    expect(bookingDescription(row)).toBe('Surat · 14 Nov, 4:30 pm · Dispatching');
  });
});
