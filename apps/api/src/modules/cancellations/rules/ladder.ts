/**
 * The T&C §3 cancellation ladder as pure functions: which band applies now, and how the money
 * splits. No I/O. Bigint paise and integer basis points only (DOMAIN §5).
 */
import type {
  BookingStatus,
  CancellationBand,
  CancellationBlock,
  CancellationClause,
  EmergencyBand,
} from '@clickco/contracts';
import { roundHalfUp } from '@clickco/utils';
import {
  CANCELLATION_LADDER,
  CANCELLED,
  EMERGENCY_BANDS,
  PAID_PRE_SHOOT,
  PHOTOGRAPHER_ACCEPTED,
  UNPAID_CANCELLABLE,
} from '../cancellations.config';

const HOUR_MS = 3_600_000;
const BPS = 10_000;
/** Math.min does not take bigint. */
const minPaise = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export interface LadderInput {
  /** A paid pre-shoot status (PAID_PRE_SHOOT). */
  readonly status: BookingStatus;
  /** Resolved at quote time from the lead time (Invariant 19), never by the client. */
  readonly emergencyBand: EmergencyBand;
  readonly scheduledStart: Date;
  readonly now: Date;
  /** T&C §3.2 Peak Season for the shoot day, on the booking's own ruleset. */
  readonly peakSeason: boolean;
}

export interface LadderStep {
  readonly band: CancellationBand;
  /** Share of the advance that comes back. */
  readonly refundBps: number;
  readonly clause: CancellationClause;
  /** When the refund would next get smaller; null when it cannot (or only on an acceptance). */
  readonly changesAt: Date | null;
}

type Rung = Omit<LadderStep, 'changesAt'>;

function standardRung(noticeMs: number, peakSeason: boolean): Rung {
  const hours = noticeMs / HOUR_MS;
  const { peak } = CANCELLATION_LADDER;
  if (peakSeason && hours < peak.underNoticeHours) {
    return { band: 'PEAK_SEASON_UNDER_7_DAYS', refundBps: peak.refundBps, clause: '3.2' };
  }
  const rung = CANCELLATION_LADDER.standard.find((r) => hours >= r.minNoticeHours);
  if (!rung) throw new RangeError('ladder: the standard ladder has no bottom rung');
  return { band: rung.band, refundBps: rung.refundBps, clause: '3.1' };
}

/** The next ladder boundary at which the refund drops below `current` (time only moves forward). */
function nextDrop(scheduledStart: Date, now: Date, peakSeason: boolean, current: number) {
  const boundaries = [
    CANCELLATION_LADDER.peak.underNoticeHours,
    ...CANCELLATION_LADDER.standard.map((r) => r.minNoticeHours),
  ]
    .filter(Number.isFinite)
    .map((h) => new Date(scheduledStart.getTime() - h * HOUR_MS))
    .filter((at) => at.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  // A boundary is the first instant of the worse band: notice there is just under the threshold.
  const dropped = boundaries.find(
    (at) =>
      standardRung(scheduledStart.getTime() - at.getTime() - 1, peakSeason).refundBps < current,
  );
  return dropped ?? null;
}

/** T&C §3.1–§3.3 for a paid booking before the shoot. */
export function ladderStep(i: LadderInput): LadderStep {
  if (!PAID_PRE_SHOOT.includes(i.status)) {
    throw new RangeError(`ladder: a ${i.status} booking is not on the cancellation ladder`);
  }
  const noticeMs = i.scheduledStart.getTime() - i.now.getTime();
  if (!Number.isFinite(noticeMs)) throw new RangeError('ladder: invalid dates');
  if (EMERGENCY_BANDS.includes(i.emergencyBand)) {
    const accepted = PHOTOGRAPHER_ACCEPTED.includes(i.status);
    const { emergency } = CANCELLATION_LADDER;
    return {
      band: accepted ? 'EMERGENCY_AFTER_ACCEPTANCE' : 'EMERGENCY_BEFORE_ACCEPTANCE',
      refundBps: accepted ? emergency.afterAcceptanceBps : emergency.beforeAcceptanceBps,
      clause: '3.3',
      changesAt: null,
    };
  }
  const rung = standardRung(noticeMs, i.peakSeason);
  return { ...rung, changesAt: nextDrop(i.scheduledStart, i.now, i.peakSeason, rung.refundBps) };
}

export interface RefundSplitInput {
  /** The booking's advance: what the ladder's percentages apply to. */
  readonly advancePaise: bigint;
  readonly refundBps: number;
  /** Captured on the booking, less what was refunded or is already on its way back. */
  readonly paidPaise: bigint;
}

export interface RefundSplit {
  readonly refundPaise: bigint;
  readonly keptPaise: bigint;
}

/**
 * The ladder forfeits part of the advance, never more: anything paid beyond it comes back in full.
 * The share returned is rounded half-up once (in the client's favour); Clickco keeps the rest of
 * the advance, at most what it still holds. refund + kept = paid, exactly.
 */
export function splitRefund(i: RefundSplitInput): RefundSplit {
  if (i.advancePaise < 0n || i.paidPaise < 0n) throw new RangeError('splitRefund: negative paise');
  if (!Number.isInteger(i.refundBps) || i.refundBps < 0 || i.refundBps > BPS) {
    throw new RangeError(`splitRefund: refundBps ${i.refundBps} is outside 0–10000`);
  }
  const returned = roundHalfUp(i.advancePaise * BigInt(i.refundBps), BigInt(BPS));
  const forfeit = i.advancePaise - returned;
  const keptPaise = minPaise(forfeit, i.paidPaise);
  return { refundPaise: i.paidPaise - keptPaise, keptPaise };
}

const REASONS: Readonly<Record<CancellationBand, string>> = {
  BEFORE_PAYMENT: 'Nothing has been paid yet, so there is nothing to refund.',
  MORE_THAN_7_DAYS:
    'You are cancelling more than 7 days before the shoot, so your full advance comes back.',
  DAYS_3_TO_7: 'You are cancelling 3 to 7 days before the shoot, so your full advance comes back.',
  HOURS_24_TO_72:
    'You are cancelling 24 to 72 hours before the shoot, so half of your advance comes back.',
  UNDER_24_HOURS:
    'You are cancelling less than 24 hours before the shoot, so no refund is due on the advance.',
  PEAK_SEASON_UNDER_7_DAYS:
    'Your shoot is in peak season and you are cancelling less than 7 days before it, so half of your advance comes back.',
  EMERGENCY_BEFORE_ACCEPTANCE:
    'No photographer has accepted your same-day booking yet, so you can cancel free of charge.',
  EMERGENCY_AFTER_ACCEPTANCE:
    'A photographer has accepted your same-day booking and is on their way to it, so no refund is due.',
};

/** The band in plain words, without amounts (the app adds them from the quote). */
export const bandReason = (band: CancellationBand): string => REASONS[band];

/**
 * Why the client cannot cancel now, or null. DOMAIN §2 allows a client cancellation from any
 * pre-shoot state; once the start time has passed, a photographer who has not arrived is a no-show
 * (T&C §3.6: full refund plus a credit), which a cancellation would forfeit — so it goes to support.
 */
export function cancellationBlock(
  status: BookingStatus,
  scheduledStart: Date,
  now: Date,
): CancellationBlock | null {
  if (UNPAID_CANCELLABLE.includes(status)) return null;
  if (CANCELLED.includes(status)) return 'ALREADY_CANCELLED';
  if (PAID_PRE_SHOOT.includes(status)) {
    return now.getTime() >= scheduledStart.getTime() ? 'SHOOT_TIME_PASSED' : null;
  }
  return status === 'DRAFT' ? 'NOT_CANCELLABLE' : 'SHOOT_STARTED';
}

const BLOCK_REASONS: Readonly<Record<CancellationBlock, string>> = {
  ALREADY_CANCELLED: 'This booking is already cancelled.',
  SHOOT_STARTED:
    'The shoot has started, so this booking can no longer be cancelled. Contact support if something is wrong.',
  SHOOT_TIME_PASSED:
    'The shoot time has passed, so this booking can no longer be cancelled in the app. If your photographer has not arrived, contact support: a no-show is refunded in full.',
  PAYMENT_SETTLING:
    'A photographer has just accepted and your payment is being confirmed. Try again in a minute.',
  NOT_CANCELLABLE: 'This booking cannot be cancelled.',
};

/** Why the booking cannot be cancelled now, in plain words. */
export const blockReason = (block: CancellationBlock): string => BLOCK_REASONS[block];
