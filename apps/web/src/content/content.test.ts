import { describe, expect, it } from 'vitest';
import { formatRupees } from '../lib/money';
import { fromPrice } from '../lib/pricing';
import { CATEGORIES } from './categories';
import { LAUNCH_CITIES } from './cities';
import { HOME_FAQS, HOW_IT_WORKS, TRUST_POINTS } from './home';
import { LOCAL_ANGLES, localAngle } from './local-angles';
import { NOT_INCLUDED, TIERS } from './tiers';

const allCopy = (): string =>
  JSON.stringify([
    CATEGORIES,
    LAUNCH_CITIES,
    HOME_FAQS,
    HOW_IT_WORKS,
    TRUST_POINTS,
    LOCAL_ANGLES,
    TIERS,
    NOT_INCLUDED,
  ]);

describe('launch geography (v0.2 §7)', () => {
  it('is Surat LIVE, Mumbai LIVE, Vadodara PILOT', () => {
    expect(LAUNCH_CITIES.map((c) => [c.name, c.status, c.tier])).toEqual([
      ['Surat', 'LIVE', 'TIER_1'],
      ['Mumbai', 'LIVE', 'METRO'],
      ['Vadodara', 'PILOT', 'TIER_1'],
    ]);
  });

  it('lists the seven launch categories', () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual([
      'Food',
      'Wedding',
      'Portrait',
      'Product',
      'Event',
      'Real Estate',
      'Corporate',
    ]);
  });
});

describe('local copy for the 21 city × category pages', () => {
  it('exists for every combination and nothing else', () => {
    const keys = LAUNCH_CITIES.flatMap((city) => CATEGORIES.map((c) => `${city.slug}/${c.slug}`));
    expect(Object.keys(LOCAL_ANGLES).sort()).toEqual([...keys].sort());
    for (const city of LAUNCH_CITIES) {
      for (const category of CATEGORIES) {
        expect(localAngle(city.slug, category.slug)?.length).toBeGreaterThan(120);
      }
    }
  });

  it('is unique per page', () => {
    const angles = Object.values(LOCAL_ANGLES);
    expect(new Set(angles).size).toBe(angles.length);
  });
});

describe('content rules (DESIGN.md, SA-10)', () => {
  it('never uses lorem ipsum, dollar signs or "edited" frames', () => {
    const text = allCopy();
    expect(text).not.toMatch(/lorem|ipsum/i);
    expect(text).not.toContain('$');
    expect(text).not.toMatch(/edited[- ]quality|edited frames/i);
  });

  it('says "delivered frames per hour" for every bookable tier', () => {
    for (const tier of ['BASIC', 'SEMI_PRO', 'PROFESSIONAL', 'EXPERT'] as const) {
      expect(TIERS[tier].highlights[0]).toBe(
        `${TIERS[tier].framesPerHour} delivered frames per hour`,
      );
    }
  });

  it('only promises dual-card backup from Professional upwards', () => {
    expect(TIERS.BASIC.highlights.join()).not.toMatch(/dual-card/i);
    expect(TIERS.SEMI_PRO.highlights.join()).not.toMatch(/dual-card/i);
    expect(TIERS.PROFESSIONAL.highlights).toContain('Dual-card backup');
    expect(TIERS.EXPERT.highlights).toContain('Dual-card backup');
  });

  it('states the retention windows from T&C §5.4', () => {
    const answer = HOME_FAQS.find((f) => /download/i.test(f.question))?.answer ?? '';
    expect(answer).toContain('7 days');
    expect(answer).toContain('30 days');
  });
});

describe('prices quoted in prose match the rate card', () => {
  it('home GST example: ₹8,500 + ₹1,530 GST = ₹10,030', () => {
    const pro = fromPrice('PROFESSIONAL', 'TIER_1');
    const answer = HOME_FAQS.find((f) => /GST/.test(f.question))?.answer ?? '';
    expect(answer).toContain(
      `${formatRupees(pro.basePaise)} + ${formatRupees(pro.gstPaise)} GST = ${formatRupees(pro.totalPaise)}`,
    );
  });

  it('Mumbai vs Surat FAQ uses the live Basic prices', () => {
    const mumbai = LAUNCH_CITIES.find((c) => c.slug === 'mumbai');
    const answer = mumbai?.faqs.find((f) => /cost more/i.test(f.question))?.answer ?? '';
    expect(answer).toContain(`${formatRupees(fromPrice('BASIC', 'METRO').basePaise)} + GST`);
    expect(answer).toContain(`${formatRupees(fromPrice('BASIC', 'TIER_1').basePaise)} + GST`);
  });
});
