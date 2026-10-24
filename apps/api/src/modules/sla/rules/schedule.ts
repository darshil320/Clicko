/** ADR-0016 D6–D10 — the SLA timetable as pure functions. No I/O. */
import type { BookingStatus, SlaKind } from '@clickco/contracts';
import { roundHalfUp } from '@clickco/utils';
import { type BreachBand, type RemedyKind, SLA_CONFIG } from '../sla.config';

export interface PlannedClock {
  readonly kind: SlaKind;
  readonly dueAt: Date;
}

const plus = (d: Date, ms: number): Date => new Date(d.getTime() + ms);

/** The production ladder from T0; RUSH_24H halves it and keeps the red alert 4 h before due. */
export function productionClocks(t0: Date, rush: boolean): PlannedClock[] {
  const factor = rush ? SLA_CONFIG.rushFactor : 1;
  const due = SLA_CONFIG.production.find((c) => c.kind === 'DELIVERY_DUE')?.offsetMs ?? 0;
  return SLA_CONFIG.production.map(({ kind, offsetMs }) => ({
    kind,
    dueAt: plus(
      t0,
      kind === 'DELIVERY_RED_ALERT' ? due * factor - SLA_CONFIG.redAlertLeadMs : offsetMs * factor,
    ),
  }));
}

/** The clocks a booking reaching `status` has satisfied (DELIVERY_* are met at delivery only). */
const MILESTONES: ReadonlyArray<{ readonly status: BookingStatus; readonly met: SlaKind[] }> = [
  { status: 'UPLOADING', met: ['UPLOAD_START'] },
  { status: 'PROCESSING', met: ['UPLOAD_COMPLETE'] },
  { status: 'QA', met: ['PROCESSING_COMPLETE'] },
  { status: 'BALANCE_PENDING', met: ['QA_COMPLETE'] },
  {
    status: 'DELIVERED',
    met: ['DELIVERY_RED_ALERT', 'DELIVERY_DUE', 'BALANCE_REMINDER', 'BOOKING_ABANDON'],
  },
];

export function milestonesMetAt(status: BookingStatus): SlaKind[] {
  const reached = MILESTONES.findIndex((m) => m.status === status);
  if (reached < 0) return [];
  return MILESTONES.slice(0, reached + 1).flatMap((m) => m.met);
}

/** T&C §5.1 "whichever is later": the due time moved by the time spent in BALANCE_PENDING. */
export function effectiveDueAt(dueAt: Date, pausedMs: number): Date {
  return plus(dueAt, pausedMs);
}

/** Reminder `sequence` (1-based) after the balance became due; null once all three are sent. */
export function reminderDueAt(balancePendingAt: Date, sequence: number): Date | null {
  const offset = SLA_CONFIG.balanceReminderOffsetsMs[sequence - 1];
  return offset === undefined ? null : plus(balancePendingAt, offset);
}

export function abandonDueAt(balancePendingAt: Date): Date {
  return plus(balancePendingAt, SLA_CONFIG.abandonAfterMs);
}

/** Invariant 7: retention runs from delivery, never from the shoot. */
export function retentionClocks(deliveredAt: Date): PlannedClock[] {
  return [
    { kind: 'RAW_PURGE', dueAt: plus(deliveredAt, SLA_CONFIG.rawRetentionMs) },
    { kind: 'JPEG_PURGE', dueAt: plus(deliveredAt, SLA_CONFIG.jpegRetentionMs) },
    { kind: 'LINK_REVOKE', dueAt: plus(deliveredAt, SLA_CONFIG.jpegRetentionMs) },
  ];
}

export function breachBand(delayMinutes: number): BreachBand {
  return SLA_CONFIG.bands.find((b) => delayMinutes < b.belowMinutes)?.band ?? 'H72_PLUS';
}

export interface BreachRemedy {
  readonly kind: RemedyKind;
  readonly paise: bigint;
  readonly payoutDeductionBps: number;
}

/** The provisional remedy (SA-21): a share of the total, never more than was paid (T&C §10.1). */
export function breachRemedy(
  band: BreachBand,
  totalPaise: bigint,
  paidPaise: bigint,
): BreachRemedy {
  const r = SLA_CONFIG.remedies[band];
  const share = roundHalfUp(totalPaise * BigInt(r.bps), 10_000n);
  return {
    kind: r.kind,
    paise: share < paidPaise ? share : paidPaise,
    payoutDeductionBps: r.payoutDeductionBps,
  };
}
