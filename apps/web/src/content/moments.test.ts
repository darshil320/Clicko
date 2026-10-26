import { describe, expect, it } from 'vitest';
import { quoteFor } from '../lib/pricing';
import { HERO_PICKER } from './home';
import { MOMENTS } from './moments';
import { MIN_HOURS } from './rate-card';
import { CATEGORY_REEL, REEL_WALL, REELS } from './reels';

describe('moments (ADR-0023)', () => {
  it('have unique ids, usable as #shoot-<id> links', () => {
    const ids = MOMENTS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
  });

  it('each preset is a shoot the hero picker can price exactly', () => {
    for (const { preset } of MOMENTS) {
      expect(preset.hours).toBeGreaterThanOrEqual(MIN_HOURS);
      expect(preset.hours).toBeLessThanOrEqual(HERO_PICKER.maxHours);
      expect(quoteFor(preset.tier, 'TIER_1', preset.category, preset.hours).total).toMatch(/^₹/);
    }
  });

  it('prices the proposal as a 2-hour Professional portrait: ₹8,500 + GST in Surat', () => {
    const proposal = MOMENTS.find((m) => m.id === 'proposal');
    expect(proposal?.preset).toMatchObject({
      category: 'PORTRAIT',
      tier: 'PROFESSIONAL',
      hours: 2,
    });
    expect(quoteFor('PROFESSIONAL', 'TIER_1', 'PORTRAIT', 2).base).toBe('₹8,500');
  });

  it('only points at reels that exist', () => {
    for (const m of MOMENTS) expect(REELS[m.reel]).toBeDefined();
    for (const item of REEL_WALL) expect(REELS[item.reel]).toBeDefined();
    expect(REELS.hero).toBeDefined();
    for (const name of Object.values(CATEGORY_REEL)) expect(REELS[name ?? '']).toBeDefined();
  });
});
