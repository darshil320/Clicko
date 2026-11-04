import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENTS,
  ANALYTICS_SCREENS,
  type AnalyticsEventName,
  parseAnalyticsEvent,
  priceBand,
} from './analytics.js';

describe('analytics catalogue (ADR-0029 D4)', () => {
  it('accepts a well-formed funnel event', () => {
    expect(
      parseAnalyticsEvent('quote_viewed', {
        categoryCode: 'FOOD',
        tier: 'PROFESSIONAL',
        hours: 2,
        emergencyBand: 'NONE',
        priceBand: 'INR_5K_10K',
      }),
    ).toEqual({
      categoryCode: 'FOOD',
      tier: 'PROFESSIONAL',
      hours: 2,
      emergencyBand: 'NONE',
      priceBand: 'INR_5K_10K',
    });
  });

  it('refuses any property the catalogue does not name — a phone cannot slip in', () => {
    expect(
      parseAnalyticsEvent('booking_created', {
        categoryCode: 'FOOD',
        tier: 'BASIC',
        hours: 2,
        emergencyBand: 'NONE',
        phone: '+919876543210',
      }),
    ).toBeNull();
  });

  it('refuses unknown events and malformed values', () => {
    expect(parseAnalyticsEvent('made_up' as AnalyticsEventName, {})).toBeNull();
    expect(parseAnalyticsEvent('review_submitted', { rating: 9, hasComment: true })).toBeNull();
    expect(parseAnalyticsEvent('quote_viewed', { categoryCode: 'rohan@example.com' })).toBeNull();
  });

  it('carries no free text: every string property is an enum or a short code', () => {
    for (const [name, schema] of Object.entries(ANALYTICS_EVENTS)) {
      for (const [key, field] of Object.entries(schema.shape)) {
        const accepted = (field as { safeParse(v: unknown): { success: boolean } }).safeParse(
          'Rohan Shah, 4 Athwalines, Surat',
        ).success;
        expect(accepted, `${name}.${key} accepts free text`).toBe(false);
      }
    }
  });

  it('names only route patterns as screens, never concrete paths with ids', () => {
    for (const screen of ANALYTICS_SCREENS) expect(screen).not.toMatch(/[0-9a-f]{8}-/);
  });

  it('bands a price coarsely', () => {
    expect(priceBand(0)).toBe('INR_UNDER_5K');
    expect(priceBand(499_999)).toBe('INR_UNDER_5K');
    expect(priceBand(500_000)).toBe('INR_5K_10K');
    expect(priceBand(2_500_000)).toBe('INR_25K_50K');
    expect(priceBand(10_000_000)).toBe('INR_50K_PLUS');
  });
});
