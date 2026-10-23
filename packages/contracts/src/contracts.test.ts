import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AreaStatus,
  AssignmentStatus,
  BasisPoints,
  Booking,
  BookingStatus,
  City,
  CityTier,
  DispatchOutcome,
  EmergencyBand,
  Hours,
  MAX_MONEY_PAISE,
  MoneyPaise,
  MoneyPaiseString,
  PhoneE164,
  Photographer,
  PhotographerStatus,
  Pincode,
  PlanTier,
  PriceSnapshot,
  SignedMoneyPaise,
  SlaKind,
  StaffRole,
} from './index.js';

const SCHEMA_SQL = readFileSync(
  fileURLToPath(new URL('../../../docs/clickco-04-schema.sql', import.meta.url)),
  'utf8',
);

function sqlEnum(name: string): string[] {
  const match = SCHEMA_SQL.match(new RegExp(`CREATE TYPE ${name} AS ENUM \\(([^;]*)\\);`));
  if (!match?.[1]) throw new Error(`enum ${name} not found in schema`);
  return [...match[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1] as string);
}

describe('enums mirror docs/clickco-04-schema.sql exactly', () => {
  it.each([
    ['plan_tier', PlanTier],
    ['city_tier', CityTier],
    ['area_status', AreaStatus],
    ['booking_status', BookingStatus],
    ['emergency_band', EmergencyBand],
    ['photographer_status', PhotographerStatus],
    ['sla_kind', SlaKind],
    ['staff_role', StaffRole],
    ['assignment_status', AssignmentStatus],
    ['dispatch_outcome', DispatchOutcome],
  ] as const)('%s', (sqlName, schema) => {
    expect(schema.options).toEqual(sqlEnum(sqlName));
  });

  it('has all 24 booking statuses', () => {
    expect(BookingStatus.options).toHaveLength(24);
  });
});

describe('MoneyPaise', () => {
  it('accepts integer paise up to the ceiling', () => {
    expect(MoneyPaise.parse(850000)).toBe(850000);
    expect(MoneyPaise.parse(0)).toBe(0);
    expect(MoneyPaise.parse(MAX_MONEY_PAISE)).toBe(MAX_MONEY_PAISE);
  });

  it('rejects fractions, negatives, values above the ceiling and unsafe integers', () => {
    expect(MoneyPaise.safeParse(8500.5).success).toBe(false);
    expect(MoneyPaise.safeParse(-1).success).toBe(false);
    expect(MoneyPaise.safeParse(MAX_MONEY_PAISE + 1).success).toBe(false);
    expect(MoneyPaise.safeParse(2 ** 53).success).toBe(false);
  });

  it('keeps the ceiling far below 2^53', () => {
    expect(MAX_MONEY_PAISE * 1000).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('allows negative values only in the signed variant', () => {
    expect(SignedMoneyPaise.parse(-20000)).toBe(-20000);
    expect(SignedMoneyPaise.safeParse(-MAX_MONEY_PAISE - 1).success).toBe(false);
  });

  it('carries aggregates as integer strings parsed to bigint', () => {
    expect(MoneyPaiseString.parse('900719925474099300')).toBe(900719925474099300n);
    expect(MoneyPaiseString.parse('-42')).toBe(-42n);
    expect(MoneyPaiseString.safeParse('12.50').success).toBe(false);
    expect(MoneyPaiseString.safeParse('1e9').success).toBe(false);
  });
});

describe('BasisPoints and Hours', () => {
  it('requires integer basis points', () => {
    expect(BasisPoints.parse(11500)).toBe(11500);
    expect(BasisPoints.safeParse(1.15).success).toBe(false);
    expect(BasisPoints.safeParse(-1).success).toBe(false);
  });

  it('requires at least 2 hours in 30-minute increments', () => {
    expect(Hours.parse(2)).toBe(2);
    expect(Hours.parse(2.5)).toBe(2.5);
    expect(Hours.safeParse(1.9).success).toBe(false);
    expect(Hours.safeParse(2.25).success).toBe(false);
  });
});

describe('identifiers', () => {
  it('validates Indian pincodes and +91 mobile numbers', () => {
    expect(Pincode.safeParse('395007').success).toBe(true);
    expect(Pincode.safeParse('095007').success).toBe(false);
    expect(Pincode.safeParse('39500').success).toBe(false);
    expect(PhoneE164.safeParse('+919876543210').success).toBe(true);
    expect(PhoneE164.safeParse('9876543210').success).toBe(false);
    expect(PhoneE164.safeParse('+915876543210').success).toBe(false);
  });
});

// doc 05 §7 worked example (Professional · Food · Surat · wedding season)
const snapshot = {
  rulesetVersion: '2026.09.01',
  sequence: 1,
  tier: 'PROFESSIONAL',
  cityTier: 'TIER_1',
  categoryCode: 'FOOD',
  hours: 2,
  baseRatePerHourPaise: 425000,
  categoryUpliftBps: 11500,
  emergencyMultiplierBps: 10000,
  surgeMultiplierBps: 11500,
  nightMultiplierBps: 10000,
  weekendMultiplierBps: 10000,
  baseAmountPaise: 977500,
  addonsAmountPaise: 450000,
  travelAmountPaise: 25400,
  discountAmountPaise: 20000,
  taxableAmountPaise: 1432900,
  gstRateBps: 1800,
  gstAmountPaise: 257922,
  totalAmountPaise: 1690822,
  pricesIncludeGst: false,
  payoutShareBps: 6000,
  expectedPayoutPaise: 881900,
  promoCode: 'FIRST200',
  computedAt: '2026-09-04T11:22:31.442Z',
} as const;

describe('PriceSnapshot', () => {
  it('accepts the doc 05 §7 worked example', () => {
    expect(PriceSnapshot.parse(snapshot).totalAmountPaise).toBe(1690822);
  });

  it('rejects a snapshot whose lines do not sum to the taxable amount', () => {
    const bad = { ...snapshot, taxableAmountPaise: 1432901 };
    expect(PriceSnapshot.safeParse(bad).success).toBe(false);
  });

  it('rejects a snapshot whose total is not taxable + GST', () => {
    const bad = { ...snapshot, totalAmountPaise: 1690823 };
    expect(PriceSnapshot.safeParse(bad).success).toBe(false);
  });

  it('rejects a multiplier expressed as a float', () => {
    const bad = { ...snapshot, surgeMultiplierBps: 1.15 };
    expect(PriceSnapshot.safeParse(bad).success).toBe(false);
  });
});

const booking = {
  id: '7b0f0d3e-2f4e-4c8a-9d4b-0c6b8f6a1e21',
  reference: 'CLK-4821',
  status: 'CONFIRMED',
  userId: '0e9a4c55-3b8b-4f1e-8a56-0b1b2a6c9d10',
  cityId: '5c2d7a90-1e3f-4b6a-8c9d-2e4f6a8b0c12',
  categoryCode: 'FOOD',
  tier: 'PROFESSIONAL',
  scheduledStart: '2026-11-14T11:00:00.000Z',
  scheduledHours: 2,
  emergencyBand: 'NONE',
  venue: { pincode: '395007', address: 'Vesu, Surat', landmark: null },
  booker: { name: 'Priya Sharma', phone: '+919876543210' },
  subject: null,
  galleryRecipient: 'BOOKER',
  totalPaise: 1690822,
  advancePaise: 845411,
  balancePaise: 845411,
  amountPaidPaise: 845411,
  createdAt: '2026-11-01T09:00:00.000Z',
} as const;

describe('Booking', () => {
  it('accepts a confirmed booking', () => {
    expect(Booking.parse(booking).reference).toBe('CLK-4821');
  });

  it('rejects advance + balance that do not sum to the total', () => {
    expect(Booking.safeParse({ ...booking, balancePaise: 845410 }).success).toBe(false);
  });

  it('requires a subject phone when the gallery goes to the subject', () => {
    const toSubject = { ...booking, galleryRecipient: 'SUBJECT' };
    expect(Booking.safeParse(toSubject).success).toBe(false);
    expect(
      Booking.safeParse({
        ...toSubject,
        subject: { name: 'Rahul Mehta', phone: '+919812345678' },
      }).success,
    ).toBe(true);
  });

  it('rejects denormalised totals that disagree with the attached snapshot', () => {
    const withPrice = { ...booking, price: snapshot };
    expect(Booking.safeParse(withPrice).success).toBe(true);
    expect(
      Booking.safeParse({ ...withPrice, totalPaise: 1690820, balancePaise: 845409 }).success,
    ).toBe(false);
  });

  it('rejects a malformed reference', () => {
    expect(Booking.safeParse({ ...booking, reference: 'BK-4821' }).success).toBe(false);
  });
});

describe('City and Photographer', () => {
  it('accepts a city with a lat/lng centre', () => {
    const city = {
      id: '5c2d7a90-1e3f-4b6a-8c9d-2e4f6a8b0c12',
      name: 'Surat',
      state: 'Gujarat',
      tier: 'TIER_1',
      status: 'LIVE',
      centre: { lat: 21.1702, lng: 72.8311 },
    };
    expect(City.parse(city).name).toBe('Surat');
    expect(City.safeParse({ ...city, centre: { lat: 91, lng: 0 } }).success).toBe(false);
  });

  it('never exposes a phone number on the client-facing photographer profile', () => {
    const profile = Photographer.parse({
      id: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      displayName: 'Rahul M.',
      cityId: '5c2d7a90-1e3f-4b6a-8c9d-2e4f6a8b0c12',
      status: 'ACTIVE',
      maxTier: 'PROFESSIONAL',
      categoryCodes: ['FOOD'],
      ratingAverage: 4.9,
      completedShoots: 127,
      acceptsEmergency: true,
      phone: '+919876543210',
    });
    expect(profile).not.toHaveProperty('phone');
  });
});
