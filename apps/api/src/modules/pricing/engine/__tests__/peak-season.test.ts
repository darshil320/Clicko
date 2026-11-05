/**
 * T&C §3.2 keys the cancellation ladder off Peak Season (doc 05 §5: `is_peak_season` is
 * load-bearing). `peakSeasonOn` answers it later, for a booking, from the booking's own ruleset —
 * exactly what its quote computed (published rulesets never change, Invariant 17).
 */
import { describe, expect, it } from 'vitest';
import { computeQuote, peakSeasonOn } from '../index';
import { CITY, ist, launch, quoteOf, quoteRequest, startingAt } from './fixtures';

describe('peakSeasonOn (T&C §3.2)', () => {
  it('the wedding season is peak everywhere, judged on the IST shoot day', () => {
    expect(peakSeasonOn(launch(), CITY.surat, ist('2027-02-28T23:30'))).toBe(true);
    expect(peakSeasonOn(launch(), CITY.surat, ist('2027-03-01T00:30'))).toBe(false);
  });

  it('Navratri is peak in Surat, not in Mumbai', () => {
    expect(peakSeasonOn(launch(), CITY.surat, ist('2027-10-01T11:00'))).toBe(true);
    expect(peakSeasonOn(launch(), CITY.mumbai, ist('2027-10-01T11:00'))).toBe(false);
  });

  it('a surge that is not peak season (Ganesh Chaturthi in Mumbai) is not peak', () => {
    expect(peakSeasonOn(launch(), CITY.mumbai, ist('2027-09-05T11:00'))).toBe(false);
  });

  it('agrees with the quote the booking was priced with', () => {
    for (const local of ['2027-02-27T11:00', '2027-03-16T11:00', '2027-10-01T11:00']) {
      const quote = quoteOf(computeQuote(quoteRequest(startingAt(local)), launch()));
      expect(peakSeasonOn(launch(), CITY.surat, ist(local))).toBe(quote.isPeakSeason);
    }
  });
});
