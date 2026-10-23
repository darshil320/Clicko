import type { PriceQuote } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  addonPrices,
  fromPricePaise,
  hourlyRatePaise,
  multiplierFromBps,
  percentFromBps,
  quoteView,
  rupees,
} from './quote-view';

/** Professional · Food · Surat · 2 h + drone, standard band (doc 05 / SA-08 corrected numbers). */
const quote = (overrides: Partial<PriceQuote> = {}): PriceQuote => ({
  kind: 'QUOTE',
  currency: 'INR',
  pricesIncludeGst: false,
  tier: 'PROFESSIONAL',
  cityTier: 'TIER_1',
  categoryCode: 'FOOD',
  hours: 2,
  emergencyBand: 'NONE',
  isGuaranteed: true,
  captureOnAcceptOnly: false,
  isPeakSeason: false,
  travelZone: 1,
  airspaceCheckRequired: true,
  lines: [
    {
      code: 'BASE',
      label: 'Professional · Food · 2 hours',
      detail: '₹4,250/hr × 2 hrs',
      amountPaise: 977500,
    },
    { code: 'CATEGORY', label: 'Food category', isFactor: true, factorBps: 11500 },
    { code: 'ADDON_DRONE', label: 'Drone coverage', amountPaise: 450000 },
    { code: 'TRAVEL', label: 'Travel (18 km)', detail: 'Zone 1', amountPaise: 25400 },
  ],
  subtotalPaise: 1452900,
  discountPaise: 0,
  gst: {
    rateBps: 1800,
    sac: '998383',
    placeOfSupply: '24',
    cgstPaise: 130761,
    sgstPaise: 130761,
    igstPaise: 0,
  },
  totalPaise: 1714422,
  advancePaise: 857211,
  balancePaise: 857211,
  factorsApplied: {
    categoryUpliftBps: 11500,
    emergencyBps: 10000,
    surgeBps: 10000,
    nightBps: 10000,
    weekendBps: 10000,
  },
  rulesetVersion: '2026.10.01',
  computedAt: '2026-11-10T10:00:00+05:30',
  quoteExpiresAt: '2026-11-10T10:15:00+05:30',
  ...overrides,
});

describe('formatting helpers', () => {
  it('formats rupees with Indian grouping, paise only when present', () => {
    expect(rupees(850000)).toBe('₹8,500');
    expect(rupees(12000000)).toBe('₹1,20,000');
    expect(rupees(488750)).toBe('₹4,887.50');
    expect(rupees(857211n)).toBe('₹8,572.11');
  });

  it('renders basis points as percentages and multipliers', () => {
    expect(percentFromBps(1800)).toBe('18%');
    expect(percentFromBps(1250)).toBe('12.5%');
    expect(multiplierFromBps(11500)).toBe('1.15×');
    expect(multiplierFromBps(12000)).toBe('1.2×');
    expect(multiplierFromBps(22000)).toBe('2.2×');
    expect(multiplierFromBps(10000)).toBe('1×');
  });
});

describe('quoteView', () => {
  it('itemises the API lines, folds factors into notes, and adds the GST line', () => {
    const view = quoteView(quote());
    expect(view.lines).toEqual([
      {
        key: 'BASE',
        label: 'Professional · Food · 2 hours',
        detail: '₹4,250/hr × 2 hrs',
        amount: '₹9,775',
      },
      { key: 'ADDON_DRONE', label: 'Drone coverage', amount: '₹4,500' },
      { key: 'TRAVEL', label: 'Travel (18 km)', detail: 'Zone 1', amount: '₹254' },
    ]);
    expect(view.factors).toEqual(['Food category 1.15×']);
    expect(view.subtotal).toBe('₹14,529');
    expect(view.gst).toEqual({ label: 'GST 18%', amount: '₹2,615.22' });
    expect(view.total).toBe('₹17,144.22');
  });

  it('labels a 50/50 advance and shows the balance due after the shoot', () => {
    const view = quoteView(quote());
    expect(view.payNow).toEqual({ label: 'Pay now (50%)', amount: '₹8,572.11', note: null });
    expect(view.balance).toBe('₹8,572.11');
  });

  it('labels a same-day booking as paid in full with no balance', () => {
    const view = quoteView(
      quote({ emergencyBand: 'SAME_DAY', advancePaise: 1714422, balancePaise: 0 }),
    );
    expect(view.payNow.label).toBe('Pay now (full amount)');
    expect(view.balance).toBeNull();
  });

  it('explains an authorise-only emergency booking', () => {
    const view = quoteView(
      quote({
        emergencyBand: 'HOURS_UNDER_3',
        captureOnAcceptOnly: true,
        advancePaise: 1714422,
        balancePaise: 0,
      }),
    );
    expect(view.payNow.label).toBe('Authorise now');
    expect(view.payNow.note).toContain('only when a photographer accepts');
  });

  it('shows a promo discount as its own negative line and sums IGST', () => {
    const view = quoteView(
      quote({
        discountPaise: 50000,
        lines: [...quote().lines, { code: 'DISCOUNT', label: 'FIRST500', amountPaise: -50000 }],
        gst: {
          rateBps: 1800,
          sac: '998383',
          placeOfSupply: '27',
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 252522,
        },
      }),
    );
    expect(view.discount).toBe('-₹500');
    expect(view.lines.some((l) => l.key === 'DISCOUNT')).toBe(false);
    expect(view.gst.amount).toBe('₹2,525.22');
  });
});

describe('reading prices off quotes', () => {
  it('reads each add-on price from a probe quote', () => {
    expect(addonPrices(quote())).toEqual({ DRONE: 450000 });
    expect(
      addonPrices({ kind: 'QUOTE_ONLY', tier: 'SIGNATURE', rulesetVersion: '2026.10.01' }),
    ).toEqual({});
    expect(addonPrices(undefined)).toEqual({});
  });

  it('uses the pre-GST subtotal for "from" prices; Signature has none', () => {
    expect(fromPricePaise(quote())).toBe(1452900);
    expect(
      fromPricePaise({ kind: 'QUOTE_ONLY', tier: 'SIGNATURE', rulesetVersion: '2026.10.01' }),
    ).toBeNull();
  });

  it('derives the hourly rate from the base line', () => {
    expect(hourlyRatePaise(quote())).toBe(488750n);
    const portrait = quote({
      hours: 2.5,
      lines: [{ code: 'BASE', label: 'Professional · Portrait · 2.5 hours', amountPaise: 1062500 }],
    });
    expect(hourlyRatePaise(portrait)).toBe(425000n);
  });
});
