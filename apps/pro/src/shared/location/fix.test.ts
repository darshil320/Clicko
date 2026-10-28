import { describe, expect, it } from 'vitest';
import { accuracyLevel, formatAccuracy, MAX_ACCURACY_M, toDeviceFix } from './fix';

const raw = (accuracy: number | null, mocked?: boolean) => ({
  coords: { latitude: 21.1702, longitude: 72.8311, accuracy },
  timestamp: Date.parse('2026-11-14T10:50:00.000Z'),
  mocked,
});

describe('device fixes', () => {
  it('converts a platform fix into the API shape, keeping the mock flag', () => {
    expect(toDeviceFix(raw(12.34, true))).toEqual({
      lat: 21.1702,
      lng: 72.8311,
      accuracyM: 12.3,
      mocked: true,
      takenAt: '2026-11-14T10:50:00.000Z',
    });
    expect(toDeviceFix(raw(8))?.mocked).toBe(false);
  });

  it('never sends a fix whose accuracy is unknown', () => {
    expect(toDeviceFix(raw(null))).toBeNull();
    expect(toDeviceFix(raw(0))).toBeNull();
    expect(toDeviceFix(raw(Number.NaN))).toBeNull();
  });

  it('grades accuracy against the server limit', () => {
    expect(MAX_ACCURACY_M).toBe(100);
    expect([10, 30, 31, 100, 101].map(accuracyLevel)).toEqual([
      'GOOD',
      'GOOD',
      'FAIR',
      'FAIR',
      'POOR',
    ]);
    expect(formatAccuracy(12.6)).toBe('±13 m');
  });
});
