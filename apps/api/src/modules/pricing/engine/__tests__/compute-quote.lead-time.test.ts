/**
 * ADR-0012 D2: a quote must leave time to fill the booking before its auto-cancel point. Lead time
 * below `auto_refund_minutes_before + 30 min` (the band's rule; 90 when unset) is refused with
 * LEAD_TIME_TOO_SHORT, after the start-in-past check and before anything is priced.
 */
import { describe, expect, it } from 'vitest';
import { computeQuote } from '../index';
import type { PricingResult, Ruleset } from '../types';
import { launch, MINUTE_MS, NEUTRAL_START, quoteRequest } from './fixtures';

const leadOf = (minutes: number) =>
  quoteRequest({ now: new Date(NEUTRAL_START.getTime() - minutes * MINUTE_MS) });
const codeOf = (r: PricingResult) => (r.kind === 'REJECTED' ? r.code : r.kind);

describe('minimum lead time (auto_refund_minutes_before + 30 min)', () => {
  it('refuses a lead one minute short of 120 minutes (90 + 30) with LEAD_TIME_TOO_SHORT', () => {
    const result = computeQuote(leadOf(119), launch());
    expect(result).toMatchObject({ kind: 'REJECTED', code: 'LEAD_TIME_TOO_SHORT' });
  });

  it('quotes exactly 120 minutes ahead', () => {
    expect(codeOf(computeQuote(leadOf(120), launch()))).toBe('QUOTE');
  });

  it('still reports a start in the past as START_IN_PAST', () => {
    expect(codeOf(computeQuote(leadOf(0), launch()))).toBe('START_IN_PAST');
  });

  it("uses the resolved band's own minutes, and 90 when the ruleset leaves it unset", () => {
    const base = launch();
    const custom = (minutes: number | null): Ruleset => ({
      ...base,
      emergency: base.emergency.map((e) =>
        e.band === 'HOURS_3_8' ? { ...e, autoRefundMinutesBefore: minutes } : e,
      ),
    });
    // 4 h lead resolves HOURS_3_8: 240 min ≥ 90 + 30, but < 240 + 30.
    expect(codeOf(computeQuote(leadOf(240), custom(240)))).toBe('LEAD_TIME_TOO_SHORT');
    expect(codeOf(computeQuote(leadOf(270), custom(240)))).toBe('QUOTE');
    expect(codeOf(computeQuote(leadOf(240), custom(null)))).toBe('QUOTE');
  });

  it('every launch band now auto-cancels 90 minutes before an unfilled shoot; only NONE/NEXT_DAY/SAME_DAY are guaranteed', () => {
    expect(
      launch().emergency.map((e) => [e.band, e.autoRefundMinutesBefore, e.isGuaranteed]),
    ).toEqual([
      ['NONE', 90, true],
      ['NEXT_DAY', 90, true],
      ['SAME_DAY', 90, true],
      ['HOURS_3_8', 90, false],
      ['HOURS_UNDER_3', 90, false],
    ]);
  });
});
