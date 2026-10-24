import type { SlaKind } from '@clickco/contracts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type BreachBand = 'H0_6' | 'H6_24' | 'H24_72' | 'H72_PLUS';
export type RemedyKind = 'CREDIT' | 'PARTIAL_REFUND' | 'FULL_REFUND';

/**
 * ADR-0016 v1 numbers in one place. Offsets are from T0 (`sla_t0` = the check-out) unless named
 * otherwise. The remedy table is PROVISIONAL (SA-21): recorded on every breach, never applied
 * automatically, until Darshil confirms it.
 */
export const SLA_CONFIG = {
  /** DOMAIN §4 standard ladder; RUSH_24H halves every offset (ADR-0016 D6). */
  production: [
    { kind: 'UPLOAD_START', offsetMs: 2 * HOUR },
    { kind: 'UPLOAD_COMPLETE', offsetMs: 12 * HOUR },
    { kind: 'PROCESSING_COMPLETE', offsetMs: 18 * HOUR },
    { kind: 'QA_COMPLETE', offsetMs: 24 * HOUR },
    { kind: 'DELIVERY_RED_ALERT', offsetMs: 44 * HOUR },
    { kind: 'DELIVERY_DUE', offsetMs: 48 * HOUR },
  ] as const satisfies ReadonlyArray<{ kind: SlaKind; offsetMs: number }>,
  rushFactor: 0.5,
  /** The red alert stays this far before the (rush) due. */
  redAlertLeadMs: 4 * HOUR,
  /** From BALANCE_PENDING entry: +24 h, +72 h, +7 d. */
  balanceReminderOffsetsMs: [DAY, 3 * DAY, 7 * DAY] as const,
  abandonAfterMs: 30 * DAY,
  rawRetentionMs: 7 * DAY,
  jpegRetentionMs: 30 * DAY,
  /** QUALITY_ESCALATION holds the JPEG purge and close back this long at a time. */
  escalationHoldMs: 7 * DAY,
  /** Overdue armed clocks re-fired per sweep (a lost job). */
  sweepBatchSize: 100,
  bands: [
    { band: 'H0_6', belowMinutes: 6 * 60 },
    { band: 'H6_24', belowMinutes: 24 * 60 },
    { band: 'H24_72', belowMinutes: 72 * 60 },
  ] as const satisfies ReadonlyArray<{ band: BreachBand; belowMinutes: number }>,
  remedies: {
    H0_6: { kind: 'CREDIT', bps: 1_000, payoutDeductionBps: 1_000 },
    H6_24: { kind: 'CREDIT', bps: 2_500, payoutDeductionBps: 2_500 },
    H24_72: { kind: 'PARTIAL_REFUND', bps: 2_500, payoutDeductionBps: 5_000 },
    H72_PLUS: { kind: 'PARTIAL_REFUND', bps: 5_000, payoutDeductionBps: 7_500 },
  } as const satisfies Record<
    BreachBand,
    { kind: RemedyKind; bps: number; payoutDeductionBps: number }
  >,
} as const;
