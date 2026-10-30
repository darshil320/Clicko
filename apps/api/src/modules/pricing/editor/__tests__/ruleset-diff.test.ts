import { describe, expect, it } from 'vitest';
import type { RulesetContent } from '../ruleset-content';
import { diffRulesets } from '../ruleset-diff';

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SURAT = UUID(900);

/** A small rate card: ids differ between two copies, contents are what count. */
function card(idBase: number): RulesetContent {
  let n = idBase;
  const id = () => UUID(++n);
  return {
    settings: { pricesIncludeGst: false, gstRateBps: 1800, sacCode: '998383' },
    baseRates: [
      {
        id: id(),
        tier: 'PROFESSIONAL',
        cityTier: 'TIER_1',
        ratePerHourPaise: 425000,
        payoutShareBps: 6000,
        isQuoteOnly: false,
      },
      {
        id: id(),
        tier: 'EXPERT',
        cityTier: 'METRO',
        ratePerHourPaise: 820000,
        payoutShareBps: 5800,
        isQuoteOnly: false,
      },
    ],
    categoryUplifts: [
      { id: id(), categoryCode: 'FOOD', categoryName: 'Food', tier: null, multiplierBps: 11500 },
    ],
    addonPrices: [
      {
        id: id(),
        addonCode: 'DRONE',
        addonName: 'Drone coverage',
        tier: null,
        cityTier: null,
        amountPaise: 450000,
        isPerHour: false,
        payoutShareBps: 6000,
      },
    ],
    extensionRates: [
      {
        id: id(),
        tier: 'PROFESSIONAL',
        cityTier: 'TIER_1',
        hourlyPaise: 425000,
        waitingHourlyPaise: 255000,
        waitingGraceMinutes: 15,
      },
    ],
    festivals: [
      {
        id: id(),
        label: 'Navratri 2027',
        dateFrom: '2027-09-30',
        dateTo: '2027-10-08',
        cityId: SURAT,
        cityName: 'Surat',
        multiplierBps: 12000,
        isPeakSeason: true,
      },
      {
        id: id(),
        label: 'Navratri 2027',
        dateFrom: '2027-09-30',
        dateTo: '2027-10-08',
        cityId: UUID(901),
        cityName: 'Vadodara',
        multiplierBps: 12000,
        isPeakSeason: true,
      },
    ],
    emergency: [
      {
        band: 'NEXT_DAY',
        multiplierBps: 12000,
        captureOnAcceptOnly: false,
        isGuaranteed: true,
        autoRefundMinutesBefore: 90,
      },
    ],
    timeMultipliers: [
      {
        kind: 'NIGHT',
        multiplierBps: 12500,
        windowStart: '22:00',
        windowEnd: '06:00',
        isoDays: null,
      },
      {
        kind: 'WEEKEND',
        multiplierBps: 11000,
        windowStart: null,
        windowEnd: null,
        isoDays: [6, 7],
      },
    ],
    travelSlabs: [
      {
        cityTier: 'TIER_1',
        zone: 1,
        fromKm: 15,
        toKm: 40,
        flatPaise: 20000,
        perKmPaise: 1800,
        overnightPaise: 0,
      },
    ],
    deliverables: [
      {
        tier: 'PROFESSIONAL',
        framesPerHour: 60,
        gearClass: 'Full-frame with lighting',
        dualCardRequired: true,
        secondShooterIncluded: false,
        rawIncluded: true,
        jpegIncluded: true,
        videoIncluded: false,
        editIncluded: false,
        deliveryHours: 48,
        minHours: 2,
        isInstantBookable: true,
      },
    ],
  };
}

describe('diffRulesets (doc 05 §11 diff view)', () => {
  it('two copies of the same card differ in nothing (row ids are not content)', () => {
    expect(diffRulesets(card(0), card(500))).toEqual([]);
  });

  it('a changed rate is one row with only the changed field, before and after in paise', () => {
    const live = card(0);
    const draft = card(500);
    const edited: RulesetContent = {
      ...draft,
      baseRates: draft.baseRates.map((r) =>
        r.tier === 'PROFESSIONAL' ? { ...r, ratePerHourPaise: 450000 } : r,
      ),
    };
    expect(diffRulesets(edited, live)).toEqual([
      {
        section: 'BASE_RATE',
        key: 'BASE_RATE:PROFESSIONAL:TIER_1',
        label: 'Professional · Tier 1 cities',
        change: 'CHANGED',
        fields: [
          {
            field: 'ratePerHourPaise',
            label: 'Hourly rate',
            value: { unit: 'PAISE', before: 425000, after: 450000 },
          },
        ],
      },
    ]);
  });

  it('factors are compared in basis points; several fields of one row stay together', () => {
    const live = card(0);
    const draft = card(500);
    const edited: RulesetContent = {
      ...draft,
      categoryUplifts: draft.categoryUplifts.map((u) => ({ ...u, multiplierBps: 12000 })),
      extensionRates: draft.extensionRates.map((x) => ({
        ...x,
        hourlyPaise: 450000,
        waitingHourlyPaise: 270000,
      })),
    };
    const rows = diffRulesets(edited, live);
    expect(rows.map((r) => r.key)).toEqual([
      'CATEGORY_UPLIFT:FOOD:ALL',
      'EXTENSION_RATE:PROFESSIONAL:TIER_1',
    ]);
    expect(rows[0]?.label).toBe('Food');
    expect(rows[0]?.fields[0]?.value).toEqual({ unit: 'BPS', before: 11500, after: 12000 });
    expect(rows[1]?.fields.map((f) => f.field)).toEqual(['hourlyPaise', 'waitingHourlyPaise']);
  });

  it('festivals: an added and a removed entry, matched on name, dates and city', () => {
    const live = card(0);
    const draft = card(500);
    const [surat, vadodara] = draft.festivals;
    if (!surat || !vadodara) throw new Error('fixture');
    const edited: RulesetContent = {
      ...draft,
      festivals: [
        { ...vadodara, multiplierBps: 12500 },
        {
          ...surat,
          id: UUID(999),
          label: 'Diwali 2027',
          dateFrom: '2027-10-26',
          dateTo: '2027-10-31',
        },
      ],
    };
    const rows = diffRulesets(edited, live);
    expect(rows.map((r) => [r.change, r.label])).toEqual([
      ['CHANGED', 'Navratri 2027 · Vadodara'],
      ['ADDED', 'Diwali 2027 · Surat'],
      ['REMOVED', 'Navratri 2027 · Surat'],
    ]);
    expect(rows[0]?.fields).toEqual([
      {
        field: 'multiplierBps',
        label: 'Festival price',
        value: { unit: 'BPS', before: 12000, after: 12500 },
      },
    ]);
    // An added row lists every field, with nothing before.
    expect(rows[1]?.fields.find((f) => f.field === 'dateFrom')?.value).toEqual({
      unit: 'TEXT',
      before: null,
      after: '2027-10-26',
    });
    expect(rows[2]?.fields.find((f) => f.field === 'multiplierBps')?.value).toEqual({
      unit: 'BPS',
      before: 12000,
      after: null,
    });
  });

  it('identical festival rows are paired one to one, so a duplicate shows as added', () => {
    const live = card(0);
    const draft = card(500);
    const [first] = draft.festivals;
    if (!first) throw new Error('fixture');
    const rows = diffRulesets(
      { ...draft, festivals: [...draft.festivals, { ...first, id: UUID(998) }] },
      live,
    );
    expect(rows.map((r) => r.change)).toEqual(['ADDED']);
  });

  it('settings, emergency, night/weekend, travel and deliverables are compared too', () => {
    const live = card(0);
    const draft = card(500);
    const edited: RulesetContent = {
      ...draft,
      settings: { ...draft.settings, gstRateBps: 1200 },
      emergency: draft.emergency.map((e) => ({ ...e, multiplierBps: 12500 })),
      timeMultipliers: draft.timeMultipliers.map((t) =>
        t.kind === 'WEEKEND' ? { ...t, isoDays: [7] } : t,
      ),
      travelSlabs: draft.travelSlabs.map((s) => ({ ...s, perKmPaise: 2000 })),
      deliverables: draft.deliverables.map((d) => ({ ...d, framesPerHour: 70 })),
    };
    const rows = diffRulesets(edited, live);
    expect(rows.map((r) => r.section)).toEqual([
      'SETTINGS',
      'EMERGENCY',
      'TIME',
      'TRAVEL',
      'DELIVERABLE',
    ]);
    expect(rows[2]?.fields[0]?.value).toEqual({ unit: 'TEXT', before: 'Sat, Sun', after: 'Sun' });
  });

  it('against nothing (no live card), every row is added', () => {
    const rows = diffRulesets(card(0), null);
    expect(rows.every((r) => r.change === 'ADDED')).toBe(true);
    expect(rows.length).toBeGreaterThan(5);
  });
});
