import { PRICING_EDITOR_LIMITS, pricingVersionFor } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  canCancelSchedule,
  DRAFT_EFFECTIVE_FROM,
  isDraftWindow,
  resolveEffectiveFrom,
  rulesetState,
  versionFor,
} from '../lifecycle';

const NOW = new Date('2026-10-05T04:30:00.000Z'); // 10:00 IST
const MIN = 60_000;
const DAY = 86_400_000;

const published = (from: Date, to: Date | null) => ({
  publishedAt: new Date(from.getTime() - DAY),
  discardedAt: null,
  effectiveFrom: from,
  effectiveTo: to,
});

describe('rulesetState (doc 05 §11)', () => {
  it('a row without published_at is a draft; with discarded_at it is discarded', () => {
    const draft = {
      publishedAt: null,
      discardedAt: null,
      effectiveFrom: DRAFT_EFFECTIVE_FROM,
      effectiveTo: new Date(1),
    };
    expect(rulesetState(draft, NOW)).toBe('DRAFT');
    expect(rulesetState({ ...draft, discardedAt: NOW }, NOW)).toBe('DISCARDED');
  });

  it('published: scheduled before its start, live inside its window, closed after it', () => {
    const later = new Date(NOW.getTime() + DAY);
    const earlier = new Date(NOW.getTime() - DAY);
    expect(rulesetState(published(later, null), NOW)).toBe('SCHEDULED');
    expect(rulesetState(published(earlier, null), NOW)).toBe('LIVE');
    expect(rulesetState(published(earlier, later), NOW)).toBe('LIVE');
    expect(rulesetState(published(earlier, NOW), NOW)).toBe('CLOSED');
    // Inclusive start, exclusive end — the engine's own resolution (doc 05 step 1).
    expect(rulesetState(published(NOW, null), NOW)).toBe('LIVE');
  });
});

describe('the draft window', () => {
  it('is the first microsecond of 1970, which no quote ever reaches', () => {
    expect(DRAFT_EFFECTIVE_FROM.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(isDraftWindow(DRAFT_EFFECTIVE_FROM)).toBe(true);
    expect(isDraftWindow(NOW)).toBe(false);
  });
});

describe('resolveEffectiveFrom', () => {
  it('null means now, not scheduled', () => {
    expect(resolveEffectiveFrom(null, NOW)).toEqual({ ok: true, at: NOW, scheduled: false });
  });

  it('a later instant schedules the change', () => {
    const at = new Date(NOW.getTime() + 2 * DAY);
    expect(resolveEffectiveFrom(at, NOW)).toEqual({ ok: true, at, scheduled: true });
  });

  it('refuses the past, and anything beyond the scheduling horizon', () => {
    expect(resolveEffectiveFrom(new Date(NOW.getTime() - MIN), NOW)).toMatchObject({
      ok: false,
      code: 'EFFECTIVE_FROM_PAST',
    });
    const horizon = PRICING_EDITOR_LIMITS.maxScheduleDays * DAY;
    expect(resolveEffectiveFrom(new Date(NOW.getTime() + horizon), NOW)).toMatchObject({
      ok: true,
    });
    expect(resolveEffectiveFrom(new Date(NOW.getTime() + horizon + 1), NOW)).toMatchObject({
      ok: false,
      code: 'EFFECTIVE_FROM_TOO_FAR',
    });
  });

  it('exactly now is a publish now', () => {
    expect(resolveEffectiveFrom(NOW, NOW)).toEqual({ ok: true, at: NOW, scheduled: false });
  });
});

describe('versions', () => {
  it('names a version after its IST start day, with a suffix when the day is taken', () => {
    // 23:30 UTC on 4 Oct is 5 Oct in India.
    expect(versionFor(new Date('2026-10-04T23:30:00.000Z'), [])).toBe('2026.10.05');
    expect(versionFor(NOW, ['2026.10.05'])).toBe('2026.10.05.2');
    expect(versionFor(NOW, ['2026.10.05', '2026.10.05.2'])).toBe('2026.10.05.3');
  });

  it('the shared helper agrees with the publish dialog', () => {
    expect(pricingVersionFor('2026-11-01', new Set(['2026.10.01']))).toBe('2026.11.01');
  });
});

describe('canCancelSchedule', () => {
  it('until a couple of minutes before the start', () => {
    const cutoff = PRICING_EDITOR_LIMITS.cancelCutoffMinutes * MIN;
    expect(canCancelSchedule(new Date(NOW.getTime() + cutoff + 1), NOW)).toBe(true);
    expect(canCancelSchedule(new Date(NOW.getTime() + cutoff), NOW)).toBe(false);
    expect(canCancelSchedule(new Date(NOW.getTime() - MIN), NOW)).toBe(false);
  });
});
