import { describe, expect, it } from 'vitest';
import { DISPATCH_CONFIG } from '../dispatch.config';
import {
  currentRun,
  modeFor,
  nextWaveNumber,
  nextWaveSpec,
  type RoundSummary,
  terminalFor,
  waveSpec,
} from '../wave-plan';

const round = (wave: number, over: Partial<RoundSummary> = {}): RoundSummary => ({
  wave,
  isBroadcast: false,
  outcome: 'EXHAUSTED',
  ...over,
});

describe('wave plan (ADR-0010)', () => {
  it('cascades 8 km/3 → 15 km/5 → 25 km/10 → city-wide/all with 120/120/180/300 s windows', () => {
    const steps = [0, 1, 2, 3].map((s) => waveSpec('CASCADE', s));
    expect(steps).toEqual([
      { isBroadcast: false, waveRadiusKm: 8, radiusKm: 8, offers: 3, windowSeconds: 120 },
      { isBroadcast: false, waveRadiusKm: 15, radiusKm: 15, offers: 5, windowSeconds: 120 },
      { isBroadcast: false, waveRadiusKm: 25, radiusKm: 25, offers: 10, windowSeconds: 180 },
      {
        isBroadcast: false,
        waveRadiusKm: null,
        radiusKm: DISPATCH_CONFIG.cityWideRadiusKm,
        offers: null,
        windowSeconds: 300,
      },
    ]);
    expect(waveSpec('CASCADE', 4)).toBeNull();
  });

  it('broadcasts once, city-wide, to everyone, for 10 minutes', () => {
    expect(waveSpec('BROADCAST', 0)).toEqual({
      isBroadcast: true,
      waveRadiusKm: null,
      radiusKm: DISPATCH_CONFIG.cityWideRadiusKm,
      offers: null,
      windowSeconds: 600,
    });
    expect(waveSpec('BROADCAST', 1)).toBeNull();
  });

  it('broadcasts for emergency bands and for a no-show; cascades otherwise', () => {
    expect(modeFor('NONE', 'INITIAL')).toBe('CASCADE');
    expect(modeFor('NEXT_DAY', 'INITIAL')).toBe('CASCADE');
    expect(modeFor('SAME_DAY', 'INITIAL')).toBe('BROADCAST');
    expect(modeFor('HOURS_3_8', 'INITIAL')).toBe('BROADCAST');
    expect(modeFor('HOURS_UNDER_3', 'INITIAL')).toBe('BROADCAST');
    expect(modeFor('NONE', 'PRO_CANCELLED')).toBe('CASCADE');
    expect(modeFor('NONE', 'NO_SHOW')).toBe('BROADCAST');
  });

  it('the current run is every round after the last FILLED one', () => {
    const rounds = [
      round(1),
      round(2, { outcome: 'FILLED' }),
      round(3),
      round(4, { outcome: null }),
    ];
    expect(currentRun(rounds).map((r) => r.wave)).toEqual([3, 4]);
    expect(currentRun([round(1), round(2)]).map((r) => r.wave)).toEqual([1, 2]);
    expect(currentRun([round(1, { outcome: 'FILLED' })])).toEqual([]);
  });

  it('continues a cascade run from its length, and ends a broadcast run after one wave', () => {
    expect(nextWaveSpec([round(1), round(2)])?.radiusKm).toBe(25);
    expect(nextWaveSpec([round(1), round(2), round(3), round(4)])).toBeNull();
    expect(nextWaveSpec([round(5, { isBroadcast: true })])).toBeNull();
    expect(() => nextWaveSpec([])).toThrow(/empty run/);
  });

  it('numbers waves across the booking (dispatch_rounds is unique on booking + wave)', () => {
    expect(nextWaveNumber([])).toBe(1);
    expect(nextWaveNumber([round(1), round(2, { outcome: 'FILLED' }), round(3)])).toBe(4);
  });

  it('ends a failed search as CANCELLED_PRO, or PRO_NO_SHOW for a no-show replacement (ADR-0012)', () => {
    expect(terminalFor('INITIAL')).toEqual({ to: 'CANCELLED_PRO', reason: 'UNFILLED' });
    expect(terminalFor('PRO_CANCELLED')).toEqual({
      to: 'CANCELLED_PRO',
      reason: 'REDISPATCH_UNFILLED',
    });
    expect(terminalFor('NO_SHOW')).toEqual({ to: 'PRO_NO_SHOW', reason: 'NO_SHOW_UNFILLED' });
  });
});
