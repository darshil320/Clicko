/**
 * Pricing engine — doc 05 §10 test matrix, part 2 of 4:
 *   Night boundaries · Weekend · Surge.
 *
 * Night, weekend and festival surge are all judged on scheduledStart converted to Asia/Kolkata
 * (UTC+05:30, no DST). Baseline: Professional · Portrait · Surat · 2 h → 850000 paise at 1.00×.
 */
import { describe, expect, it } from 'vitest';
import { computeQuote } from '../index';
import {
  CITY,
  launch,
  MUMBAI,
  NEUTRAL_START,
  quoteOf,
  quoteRequest,
  SURAT,
  startingAt,
  weekAhead,
} from './fixtures';

describe('Night boundaries', () => {
  it('does not treat a 21:59 IST start as night', () => {
    const request = quoteRequest(startingAt('2027-03-16T21:59'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.nightBps).toBe(10000);
  });

  it('treats a 22:00 IST start as night', () => {
    const request = quoteRequest(startingAt('2027-03-16T22:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.nightBps).toBe(12500);
  });

  it('treats a 05:59 IST start as night', () => {
    const request = quoteRequest(startingAt('2027-03-16T05:59'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.nightBps).toBe(12500);
  });

  it('does not treat a 06:00 IST start as night', () => {
    const request = quoteRequest(startingAt('2027-03-16T06:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.nightBps).toBe(10000);
  });

  it('multiplies the night factor into the base: a 22:00 start costs 1062500 paise', () => {
    const request = quoteRequest(startingAt('2027-03-16T22:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    // 850000 × 1.25
    expect(quote.baseAmountPaise).toBe(1_062_500n);
  });

  it('charges a 4-hour shoot starting 23:00 and running past midnight as one night shoot', () => {
    const request = quoteRequest({ ...startingAt('2027-03-16T23:00'), hours: 4 });

    const quote = quoteOf(computeQuote(request, launch()));

    // 425000 × 8 half-hours × 12500 / (2 × 10000) = 2125000 — night applied once, not 1.25² (2656250)
    expect(quote.baseAmountPaise).toBe(2_125_000n);
  });

  it('does not treat a 21:00 start running until 23:00 as night, because only the start counts', () => {
    const request = quoteRequest({ ...startingAt('2027-03-16T21:00'), hours: 2 });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.nightBps).toBe(10000);
  });

  it('converts to IST before judging night: 19:00 UTC is 00:30 IST and is night', () => {
    const request = quoteRequest(weekAhead(new Date('2027-03-16T19:00:00.000Z')));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.nightBps).toBe(12500);
  });

  it('converts to IST before judging night: 00:30 UTC is 06:00 IST and is not night', () => {
    const request = quoteRequest(weekAhead(new Date('2027-03-17T00:30:00.000Z')));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.nightBps).toBe(10000);
  });

  it("uses the ruleset's night window and multiplier instead of a hardcoded 22:00–06:00", () => {
    const ruleset = {
      ...launch(),
      night: { windowStartMinute: 20 * 60, windowEndMinute: 5 * 60, multiplierBps: 15000 },
    };
    const request = quoteRequest(startingAt('2027-03-16T21:00'));

    const quote = quoteOf(computeQuote(request, ruleset));

    expect(quote.factors.nightBps).toBe(15000);
  });

  it('applies no night factor when the ruleset has no night rule', () => {
    const ruleset = { ...launch(), night: null };
    const request = quoteRequest(startingAt('2027-03-16T23:00'));

    const quote = quoteOf(computeQuote(request, ruleset));

    expect(quote.factors.nightBps).toBe(10000);
  });
});

describe('Weekend', () => {
  it('applies the weekend factor to a Saturday start', () => {
    const request = quoteRequest(startingAt('2027-03-20T11:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.weekendBps).toBe(11000);
  });

  it('applies the weekend factor to a Sunday start', () => {
    const request = quoteRequest(startingAt('2027-03-21T11:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.weekendBps).toBe(11000);
  });

  it('does not apply the weekend factor to a Friday start', () => {
    const request = quoteRequest(startingAt('2027-03-19T11:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.weekendBps).toBe(10000);
  });

  it('judges the weekend on the IST date: Friday 19:00 UTC is Saturday 00:30 IST', () => {
    const request = quoteRequest(weekAhead(new Date('2027-03-19T19:00:00.000Z')));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.weekendBps).toBe(11000);
  });

  it('judges the weekend on the IST date: Sunday 18:30 UTC is Monday 00:00 IST', () => {
    const request = quoteRequest(weekAhead(new Date('2027-03-21T18:30:00.000Z')));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.weekendBps).toBe(10000);
  });

  it('composes night and weekend in the base: Saturday 23:00 costs 1168750 paise', () => {
    const request = quoteRequest(startingAt('2027-03-20T23:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    // 425000 × 4 × 12500 × 11000 / (2 × 10000²) = 850000 × 1.375 = 1168750
    expect(quote.baseAmountPaise).toBe(1_168_750n);
  });

  it("uses the ruleset's weekend days instead of hardcoding Saturday and Sunday", () => {
    const ruleset = { ...launch(), weekend: { isoDays: [5], multiplierBps: 10500 } };
    const request = quoteRequest(startingAt('2027-03-19T11:00'));

    const quote = quoteOf(computeQuote(request, ruleset));

    expect(quote.factors.weekendBps).toBe(10500);
  });
});

describe('Surge', () => {
  it('applies a single festival: wedding season on a November weekday is 1.15×', () => {
    const request = quoteRequest(startingAt('2026-11-17T11:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    // 850000 × 1.15 = 977500
    expect(quote).toMatchObject({ factors: { surgeBps: 11500 }, baseAmountPaise: 977_500n });
  });

  it('takes the MAX of Diwali inside wedding season (1.25×), never the product (1.4375×)', () => {
    const request = quoteRequest(startingAt('2026-11-09T11:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    // MAX: 850000 × 1.25 = 1062500.   Product would be 850000 × 1.4375 = 1221875.
    expect(quote).toMatchObject({ factors: { surgeBps: 12500 }, baseAmountPaise: 1_062_500n });
  });

  it('takes the MAX whatever order the overlapping festival rows appear in', () => {
    const base = launch();
    const ruleset = { ...base, festivals: base.festivals.toReversed() };
    const request = quoteRequest(startingAt('2026-11-09T11:00'));

    const quote = quoteOf(computeQuote(request, ruleset));

    expect(quote.factors.surgeBps).toBe(12500);
  });

  it('does not apply Navratri (Surat and Vadodara only) to a Mumbai venue', () => {
    const request = quoteRequest({ ...startingAt('2027-10-04T11:00'), venue: MUMBAI });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.surgeBps).toBe(10000);
  });

  it('applies Navratri to a venue in Surat, one of its listed cities', () => {
    const request = quoteRequest({ ...startingAt('2027-10-04T11:00'), venue: SURAT });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.surgeBps).toBe(12000);
  });

  it('does not apply Ganesh Chaturthi (Mumbai only) to a Surat venue', () => {
    const request = quoteRequest({ ...startingAt('2027-09-07T11:00'), venue: SURAT });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.surgeBps).toBe(10000);
  });

  it('matches a city-scoped festival on venue.cityId, not on city tier', () => {
    const vadodara = { ...SURAT, cityId: CITY.vadodara, pincode: '390001' };
    const request = quoteRequest({ ...startingAt('2027-10-04T11:00'), venue: vadodara });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.surgeBps).toBe(12000);
  });

  it('propagates is_peak_season from wedding season into the quote', () => {
    const request = quoteRequest(startingAt('2026-11-17T11:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.isPeakSeason).toBe(true);
  });

  it('leaves isPeakSeason false outside every festival', () => {
    const quote = quoteOf(computeQuote(quoteRequest(), launch()));

    expect(quote.isPeakSeason).toBe(false);
  });

  it("applies a non-peak festival's surge without setting peak season", () => {
    const request = quoteRequest({ ...startingAt('2027-09-07T11:00'), venue: MUMBAI });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote).toMatchObject({ factors: { surgeBps: 11500 }, isPeakSeason: false });
  });

  it('sets peak season when any matching row is peak, even if a non-peak row wins the MAX', () => {
    const ruleset = {
      ...launch(),
      festivals: [
        {
          label: 'Big non-peak',
          dateFrom: '2027-03-16',
          dateTo: '2027-03-16',
          cityId: null,
          multiplierBps: 12000,
          isPeakSeason: false,
        },
        {
          label: 'Small peak',
          dateFrom: '2027-03-10',
          dateTo: '2027-03-20',
          cityId: null,
          multiplierBps: 11000,
          isPeakSeason: true,
        },
      ],
    };
    const request = quoteRequest({ scheduledStart: NEUTRAL_START });

    const quote = quoteOf(computeQuote(request, ruleset));

    expect(quote).toMatchObject({ factors: { surgeBps: 12000 }, isPeakSeason: true });
  });

  it('applies no surge outside every festival', () => {
    const quote = quoteOf(computeQuote(quoteRequest(), launch()));

    expect(quote.factors.surgeBps).toBe(10000);
  });

  it('includes the first day of a festival window (Diwali 2026 starts 6 Nov)', () => {
    const request = quoteRequest(startingAt('2026-11-06T11:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.surgeBps).toBe(12500);
  });

  it('includes the last day of a festival window (Diwali 2026 ends 11 Nov)', () => {
    const request = quoteRequest(startingAt('2026-11-11T11:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.surgeBps).toBe(12500);
  });

  it('excludes the day before a festival window (5 Nov is wedding season only)', () => {
    const request = quoteRequest(startingAt('2026-11-05T11:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.surgeBps).toBe(11500);
  });

  it('excludes the day after a festival window (12 Nov is wedding season only)', () => {
    const request = quoteRequest(startingAt('2026-11-12T11:00'));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.surgeBps).toBe(11500);
  });

  it('starts wedding season at 00:00 IST on 1 Nov, which is 18:30 UTC on 31 Oct', () => {
    const request = quoteRequest(weekAhead(new Date('2026-10-31T18:30:00.000Z')));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.surgeBps).toBe(11500);
  });

  it('does not apply wedding season at 23:59 IST on 31 Oct, which is 18:29 UTC', () => {
    const request = quoteRequest(weekAhead(new Date('2026-10-31T18:29:00.000Z')));

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.factors.surgeBps).toBe(10000);
  });
});
