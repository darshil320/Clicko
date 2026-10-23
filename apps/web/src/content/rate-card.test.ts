import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rupeesToPaise } from '../lib/money';
import {
  BOOKABLE_TIERS,
  type BookableTier,
  CATEGORY_UPLIFT_BPS,
  type CategoryCode,
  LEAD_TIME_BANDS,
  RATE_PER_HOUR_PAISE,
} from './rate-card';

const DOC_05 = readFileSync(
  fileURLToPath(new URL('../../../../docs/clickco-05-pricing-engine.md', import.meta.url)),
  'utf8',
);

/** "₹1,750" → 1750 */
const rupees = (cell: string): number => Number.parseInt(cell.replace(/[₹,\s]/g, ''), 10);

/** `| BASIC | ₹2,000 | ₹1,750 | … |` rows of the base_rates table. */
function docBaseRates(): Map<string, { metro: number; tier1: number }> {
  const rows = [
    ...DOC_05.matchAll(/^\| (BASIC|SEMI_PRO|PROFESSIONAL|EXPERT) \| ([^|]+)\| ([^|]+)\|/gm),
  ];
  return new Map(
    rows.map((m) => [
      m[1] as string,
      { metro: rupees(m[2] as string), tier1: rupees(m[3] as string) },
    ]),
  );
}

/** `| FOOD | 1.15× | … |` rows of the category_uplifts table. */
function docUplifts(): Map<string, number> {
  const rows = [...DOC_05.matchAll(/^\| ([A-Z_]+) \| (\d)\.(\d{2})× \| [a-z]/gm)];
  return new Map(rows.map((m) => [m[1] as string, Number.parseInt(`${m[2]}${m[3]}`, 10) * 100]));
}

/** `| HOURS_UNDER_3 | < 3 h | 2.20× |` rows of the emergency_multipliers table. */
function docEmergency(): Map<string, number> {
  const rows = [
    ...DOC_05.matchAll(/^\| ([A-Z_0-9]+) \| [^|]+\| (\d)\.(\d{2})× \| (?:yes|\*\*no)/gm),
  ];
  return new Map(rows.map((m) => [m[1] as string, Number.parseInt(`${m[2]}${m[3]}`, 10) * 100]));
}

describe('rate card mirrors docs/clickco-05-pricing-engine.md §5', () => {
  const base = docBaseRates();

  it('finds all four bookable tiers in the doc', () => {
    expect([...base.keys()]).toEqual(BOOKABLE_TIERS);
  });

  it.each(BOOKABLE_TIERS)('%s hourly rates match for METRO and TIER_1', (tier: BookableTier) => {
    const row = base.get(tier);
    expect(row).toBeDefined();
    expect(RATE_PER_HOUR_PAISE[tier].METRO).toBe(rupeesToPaise(row?.metro ?? -1));
    expect(RATE_PER_HOUR_PAISE[tier].TIER_1).toBe(rupeesToPaise(row?.tier1 ?? -1));
  });

  it('matches every category uplift', () => {
    const uplifts = docUplifts();
    const codes = Object.keys(CATEGORY_UPLIFT_BPS) as CategoryCode[];
    expect(uplifts.size).toBe(codes.length);
    for (const code of codes) expect(uplifts.get(code)).toBe(CATEGORY_UPLIFT_BPS[code]);
  });

  it('matches every emergency band multiplier', () => {
    const doc = docEmergency();
    expect(doc.size).toBe(LEAD_TIME_BANDS.length);
    for (const band of LEAD_TIME_BANDS) expect(doc.get(band.code)).toBe(band.multiplierBps);
  });

  it('never calls the under-8-hour bands guaranteed (T&C §3.7)', () => {
    const shortNotice = LEAD_TIME_BANDS.filter((b) =>
      ['HOURS_3_8', 'HOURS_UNDER_3'].includes(b.code),
    );
    for (const band of shortNotice) expect(band.promise).toMatch(/best effort/i);
  });
});
