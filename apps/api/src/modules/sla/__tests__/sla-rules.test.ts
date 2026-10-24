import { describe, expect, it } from 'vitest';
import {
  abandonDueAt,
  breachBand,
  breachRemedy,
  effectiveDueAt,
  milestonesMetAt,
  productionClocks,
  reminderDueAt,
  retentionClocks,
} from '../rules/schedule';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = new Date('2026-12-21T12:30:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('production clocks (DOMAIN §4, ADR-0016 D6)', () => {
  it('standard ladder from T0: 2 / 12 / 18 / 24 / 44 / 48 h', () => {
    expect(productionClocks(T0, false)).toEqual([
      { kind: 'UPLOAD_START', dueAt: at(2 * HOUR) },
      { kind: 'UPLOAD_COMPLETE', dueAt: at(12 * HOUR) },
      { kind: 'PROCESSING_COMPLETE', dueAt: at(18 * HOUR) },
      { kind: 'QA_COMPLETE', dueAt: at(24 * HOUR) },
      { kind: 'DELIVERY_RED_ALERT', dueAt: at(44 * HOUR) },
      { kind: 'DELIVERY_DUE', dueAt: at(48 * HOUR) },
    ]);
  });

  it('RUSH_24H halves the ladder, red alert still 4 h before due', () => {
    const rush = productionClocks(T0, true);
    expect(rush.find((c) => c.kind === 'DELIVERY_DUE')?.dueAt).toEqual(at(24 * HOUR));
    expect(rush.find((c) => c.kind === 'DELIVERY_RED_ALERT')?.dueAt).toEqual(at(20 * HOUR));
    expect(rush.find((c) => c.kind === 'UPLOAD_START')?.dueAt).toEqual(at(1 * HOUR));
    expect(rush.find((c) => c.kind === 'QA_COMPLETE')?.dueAt).toEqual(at(12 * HOUR));
  });
});

describe('milestones (which clocks a status meets)', () => {
  it('maps each production status to the clock it satisfies', () => {
    expect(milestonesMetAt('UPLOADING')).toEqual(['UPLOAD_START']);
    expect(milestonesMetAt('PROCESSING')).toEqual(['UPLOAD_START', 'UPLOAD_COMPLETE']);
    expect(milestonesMetAt('QA')).toEqual([
      'UPLOAD_START',
      'UPLOAD_COMPLETE',
      'PROCESSING_COMPLETE',
    ]);
    expect(milestonesMetAt('BALANCE_PENDING')).toEqual([
      'UPLOAD_START',
      'UPLOAD_COMPLETE',
      'PROCESSING_COMPLETE',
      'QA_COMPLETE',
    ]);
    expect(milestonesMetAt('DELIVERED')).toContain('DELIVERY_DUE');
    expect(milestonesMetAt('DELIVERED')).toContain('BALANCE_REMINDER');
    expect(milestonesMetAt('CHECKED_OUT')).toEqual([]);
  });
});

describe('the pause (T&C §5.1, ADR-0016 D7)', () => {
  it('effective due moves by the time spent waiting for the client', () => {
    expect(effectiveDueAt(at(48 * HOUR), 3 * DAY)).toEqual(at(48 * HOUR + 3 * DAY));
    expect(effectiveDueAt(at(48 * HOUR), 0)).toEqual(at(48 * HOUR));
  });
});

describe('balance reminders and abandonment (ADR-0016 D8)', () => {
  const ready = at(30 * HOUR);
  it('three reminders at +24 h, +72 h, +7 d after delivery is ready; then none', () => {
    expect(reminderDueAt(ready, 1)).toEqual(new Date(ready.getTime() + DAY));
    expect(reminderDueAt(ready, 2)).toEqual(new Date(ready.getTime() + 3 * DAY));
    expect(reminderDueAt(ready, 3)).toEqual(new Date(ready.getTime() + 7 * DAY));
    expect(reminderDueAt(ready, 4)).toBeNull();
  });

  it('abandons 30 days after the balance became due', () => {
    expect(abandonDueAt(ready)).toEqual(new Date(ready.getTime() + 30 * DAY));
  });
});

describe('retention (Invariant 7: from delivery, never from the shoot)', () => {
  it('RAW purge +7 d, JPEG purge and link revoke +30 d', () => {
    const delivered = at(40 * HOUR);
    expect(retentionClocks(delivered)).toEqual([
      { kind: 'RAW_PURGE', dueAt: new Date(delivered.getTime() + 7 * DAY) },
      { kind: 'JPEG_PURGE', dueAt: new Date(delivered.getTime() + 30 * DAY) },
      { kind: 'LINK_REVOKE', dueAt: new Date(delivered.getTime() + 30 * DAY) },
    ]);
  });
});

describe('breach ladder (DOMAIN §4 bands; ADR-0016 D9 provisional remedies)', () => {
  it('bands by delay: < 6 h, < 24 h, < 72 h, beyond', () => {
    expect(breachBand(1)).toBe('H0_6');
    expect(breachBand(359)).toBe('H0_6');
    expect(breachBand(360)).toBe('H6_24');
    expect(breachBand(1_439)).toBe('H6_24');
    expect(breachBand(1_440)).toBe('H24_72');
    expect(breachBand(4_320)).toBe('H72_PLUS');
  });

  it('prices the provisional remedy on the booking total, capped at what was paid', () => {
    expect(breachRemedy('H0_6', 1_000_000n, 1_000_000n)).toEqual({
      kind: 'CREDIT',
      paise: 100_000n,
      payoutDeductionBps: 1_000,
    });
    expect(breachRemedy('H6_24', 1_000_000n, 1_000_000n)).toMatchObject({
      kind: 'CREDIT',
      paise: 250_000n,
    });
    expect(breachRemedy('H24_72', 1_000_000n, 1_000_000n)).toMatchObject({
      kind: 'PARTIAL_REFUND',
      paise: 250_000n,
      payoutDeductionBps: 5_000,
    });
    expect(breachRemedy('H72_PLUS', 1_000_000n, 300_000n)).toEqual({
      kind: 'PARTIAL_REFUND',
      paise: 300_000n,
      payoutDeductionBps: 7_500,
    });
  });

  it('rounds half up in paise', () => {
    expect(breachRemedy('H0_6', 1_005n, 1_005n).paise).toBe(101n);
  });
});
