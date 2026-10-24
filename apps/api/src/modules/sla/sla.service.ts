import type { BookingStatus, SlaKind } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEventOnce, type EventValue } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import { SYSTEM_ACTOR } from '../bookings/bookings.types';
import { SlaBreachesRepository } from './repositories/sla-breaches.repository';
import { SlaClocksRepository } from './repositories/sla-clocks.repository';
import {
  abandonDueAt,
  breachBand,
  breachRemedy,
  effectiveDueAt,
  milestonesMetAt,
  productionClocks,
  reminderDueAt,
  retentionClocks,
} from './rules/schedule';
import { SLA_CONFIG } from './sla.config';
import type { SlaClockRecord, SlaTimer, Tx } from './sla.types';
import { SlaTimerScheduler } from './sla-timers';

const PAUSED_AT_BALANCE: readonly SlaKind[] = ['DELIVERY_DUE', 'DELIVERY_RED_ALERT'];
const INTERNAL: readonly SlaKind[] = [
  'UPLOAD_START',
  'UPLOAD_COMPLETE',
  'PROCESSING_COMPLETE',
  'QA_COMPLETE',
];
const RETENTION: readonly SlaKind[] = ['RAW_PURGE', 'JPEG_PURGE', 'LINK_REVOKE'];
/** Held while a quality escalation is open: the files may be needed (ADR-0016 D10). */
const HELD_BY_ESCALATION: readonly SlaKind[] = ['JPEG_PURGE', 'LINK_REVOKE'];
const MIN = 60_000;

export type FireOutcome =
  | 'NOT_DUE'
  | 'SKIPPED'
  | 'BREACHED'
  | 'REMINDED'
  | 'ABANDONED'
  | 'RETENTION_DUE'
  | 'HELD';

/**
 * The SLA machine (DOMAIN §4, ADR-0016 D6–D10). Clocks are armed and resolved by booking status
 * events; a due clock fires as a BullMQ job. Lock order: booking → clock. Every effect it has on
 * the outside world is an outbox event (alerts, reminders, retention) or a booking transition
 * (abandonment), in the same transaction as the clock change.
 */
@Injectable()
export class SlaService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(SlaClocksRepository) private readonly clocks: SlaClocksRepository,
    @Inject(SlaBreachesRepository) private readonly breaches: SlaBreachesRepository,
    @Inject(SlaTimerScheduler) private readonly timers: SlaTimerScheduler,
  ) {}

  /** booking.checked_out / booking.unsafe_site: the production ladder from sla_t0 (D6, D11, D12). */
  async armProduction(bookingId: string, opts: { readonly clientAbsent: boolean }): Promise<void> {
    if (opts.clientAbsent) return;
    const facts = await this.bookings.deliveryFacts(this.sql, bookingId);
    const t0 = facts.slaT0;
    if (!t0) return;
    const armed = await this.sql.begin((tx) =>
      this.clocks.arm(tx, bookingId, t0, productionClocks(t0, facts.hasRushDelivery)),
    );
    await this.timers.schedule(armed.map(timerOf));
  }

  /** booking.uploading / processing / qa: the milestones that status satisfies. */
  async reached(bookingId: string, status: BookingStatus, at: Date): Promise<void> {
    await this.sql.begin((tx) => this.clocks.meet(tx, bookingId, milestonesMetAt(status), at));
  }

  /**
   * booking.balance_pending: QA done; the delivery clocks pause for the client (D7); the reminder
   * and abandonment clocks start (D8); a missed promise gets its breach row now its delay is final.
   */
  async balancePending(bookingId: string, at: Date): Promise<void> {
    const facts = await this.bookings.deliveryFacts(this.sql, bookingId);
    const armed = await this.sql.begin(async (tx) => {
      await this.clocks.meet(tx, bookingId, milestonesMetAt('BALANCE_PENDING'), at);
      await this.clocks.pause(tx, bookingId, PAUSED_AT_BALANCE, at);
      const reminder = reminderDueAt(at, 1);
      const planned = [
        ...(reminder ? [{ kind: 'BALANCE_REMINDER' as const, dueAt: reminder }] : []),
        { kind: 'BOOKING_ABANDON' as const, dueAt: abandonDueAt(at) },
      ];
      const created = await this.clocks.arm(tx, bookingId, at, planned);
      await this.recordBreachIfLate(tx, bookingId, facts.totalPaise, facts.amountPaidPaise, at);
      return created;
    });
    await this.timers.schedule(armed.map(timerOf));
  }

  /** booking.delivered: the promise is met (its pause ends), reminders stop, retention starts. */
  async delivered(bookingId: string, at: Date): Promise<void> {
    const armed = await this.sql.begin(async (tx) => {
      await this.clocks.meet(tx, bookingId, milestonesMetAt('DELIVERED'), at);
      return this.clocks.arm(tx, bookingId, at, retentionClocks(at));
    });
    await this.timers.schedule(armed.map(timerOf));
  }

  /** A terminal status: nothing is owed on this booking's clocks any more. */
  async terminal(bookingId: string): Promise<void> {
    await this.sql.begin((tx) => this.clocks.cancelArmed(tx, bookingId));
  }

  async clocksFor(bookingId: string): Promise<SlaClockRecord[]> {
    return this.clocks.forBooking(this.sql, bookingId);
  }

  /** The `sla.clock-due` job (and the sweep). Idempotent: a clock that is no longer due is skipped. */
  async fire(clockId: string): Promise<FireOutcome> {
    const ref = await this.clocks.find(this.sql, clockId);
    if (!ref) return 'SKIPPED';
    const now = this.clock();
    const result = await this.sql.begin(async (tx) => {
      const booking = await this.bookings.lock(tx, ref.bookingId);
      const c = await this.clocks.lock(tx, clockId);
      if (c?.state !== 'ARMED' || c.pausedAt) return { outcome: 'SKIPPED' as const };
      if (now < c.dueAt) return { outcome: 'NOT_DUE' as const, timers: [timerOf(c)] };
      return this.resolveDue(tx, c, booking.status, booking.balancePaise, now);
    });
    if ('timers' in result && result.timers) await this.timers.scheduleOrLog(result.timers);
    return result.outcome;
  }

  /** Overdue armed clocks whose job was lost (Redis outage after a commit). */
  async sweep(): Promise<number> {
    const due = await this.clocks.overdue(this.sql, this.clock(), SLA_CONFIG.sweepBatchSize);
    for (const c of due) await this.fire(c.id);
    return due.length;
  }

  private async resolveDue(
    tx: Tx,
    c: SlaClockRecord,
    status: BookingStatus,
    balancePaise: bigint,
    now: Date,
  ): Promise<{ outcome: FireOutcome; timers?: SlaTimer[] }> {
    if (INTERNAL.includes(c.kind) || c.kind === 'DELIVERY_RED_ALERT') {
      await this.clocks.markBreached(tx, c.id, now);
      const event = c.kind === 'DELIVERY_RED_ALERT' ? 'sla.red_alert' : 'sla.milestone_missed';
      await this.emit(tx, event, c, now, { kind: c.kind, due_at: c.dueAt.toISOString() });
      return { outcome: 'BREACHED' };
    }
    if (c.kind === 'DELIVERY_DUE') {
      await this.clocks.markBreached(tx, c.id, now);
      await this.emit(tx, 'sla.breached', c, now, {
        kind: c.kind,
        due_at: c.dueAt.toISOString(),
        booking_status: status,
      });
      return { outcome: 'BREACHED' };
    }
    if (c.kind === 'BALANCE_REMINDER') return this.remind(tx, c, status, balancePaise, now);
    if (c.kind === 'BOOKING_ABANDON') return this.abandon(tx, c, status, now);
    if (RETENTION.includes(c.kind)) {
      if (status === 'QUALITY_ESCALATION' && HELD_BY_ESCALATION.includes(c.kind)) {
        const until = new Date(now.getTime() + SLA_CONFIG.escalationHoldMs);
        await this.clocks.rearm(tx, c.id, until);
        return { outcome: 'HELD', timers: [{ clockId: c.id, at: until }] };
      }
      await this.clocks.markMet(tx, c.id, now);
      await this.emit(tx, 'sla.retention_due', c, now, { kind: c.kind });
      return { outcome: 'RETENTION_DUE' };
    }
    return { outcome: 'SKIPPED' };
  }

  /** D8: one row, re-armed through +24 h / +72 h / +7 d; S11 turns each into a message. */
  private async remind(
    tx: Tx,
    c: SlaClockRecord,
    status: BookingStatus,
    balancePaise: bigint,
    now: Date,
  ): Promise<{ outcome: FireOutcome; timers?: SlaTimer[] }> {
    if (status !== 'BALANCE_PENDING') {
      await this.clocks.markMet(tx, c.id, now);
      return { outcome: 'SKIPPED' };
    }
    const offset = c.dueAt.getTime() - c.anchorAt.getTime();
    const offsets: readonly number[] = SLA_CONFIG.balanceReminderOffsetsMs;
    const sequence = offsets.indexOf(offset) + 1;
    await this.emit(tx, 'booking.balance_reminder', c, now, {
      sequence,
      balance_paise: fromPaiseBigint(balancePaise),
    });
    const next = sequence > 0 ? reminderDueAt(c.anchorAt, sequence + 1) : null;
    if (!next) {
      await this.clocks.markMet(tx, c.id, now);
      return { outcome: 'REMINDED' };
    }
    await this.clocks.rearm(tx, c.id, next);
    return { outcome: 'REMINDED', timers: [{ clockId: c.id, at: next }] };
  }

  /** D8: 30 days unpaid → ABANDONED (the booking.abandoned subscriber purges every file). */
  private async abandon(
    tx: Tx,
    c: SlaClockRecord,
    status: BookingStatus,
    now: Date,
  ): Promise<{ outcome: FireOutcome }> {
    await this.clocks.markMet(tx, c.id, now);
    if (status !== 'BALANCE_PENDING') return { outcome: 'SKIPPED' };
    await this.bookings.transition(tx, {
      bookingId: c.bookingId,
      to: 'ABANDONED',
      actor: SYSTEM_ACTOR,
      occurredAt: now,
      reason: 'Balance unpaid for 30 days (T&C §2.3)',
      payload: { clock_id: c.id },
    });
    await this.clocks.cancelArmed(tx, c.bookingId);
    return { outcome: 'ABANDONED' };
  }

  /**
   * D9: the delivery promise was missed — once the effective delivery (QA passed) is known, the
   * breach row with its band and provisional remedy, for the S9 finance desk to apply.
   */
  private async recordBreachIfLate(
    tx: Tx,
    bookingId: string,
    totalPaise: bigint,
    paidPaise: bigint,
    at: Date,
  ): Promise<void> {
    const all = await this.clocks.forBooking(tx, bookingId);
    const due = all.find((c) => c.kind === 'DELIVERY_DUE');
    if (due?.state !== 'BREACHED') return;
    const delayMinutes = Math.max(
      1,
      Math.ceil((at.getTime() - effectiveDueAt(due.dueAt, due.pausedMs).getTime()) / MIN),
    );
    const band = breachBand(delayMinutes);
    const remedy = breachRemedy(band, totalPaise, paidPaise);
    const uploadLate = all.some((c) => c.kind === 'UPLOAD_COMPLETE' && c.state === 'BREACHED');
    const attributedTo = uploadLate ? 'PHOTOGRAPHER' : 'CLICKCO';
    const { id, created } = await this.breaches.record(tx, {
      bookingId,
      clockId: due.id,
      kind: 'DELIVERY_DUE',
      delayMinutes,
      band,
      remedyKind: remedy.kind,
      remedyPaise: remedy.paise,
      payoutDeductionBps: remedy.payoutDeductionBps,
      attributedTo,
    });
    if (!created) return;
    await appendDomainEventOnce(tx, {
      eventType: 'booking.needs_review',
      aggregateKind: 'booking',
      aggregateId: bookingId,
      occurredAt: at,
      dedupeKey: 'SLA_BREACH_REMEDY',
      payload: {
        booking_id: bookingId,
        reason: 'SLA_BREACH_REMEDY',
        breach_id: id,
        delay_minutes: delayMinutes,
        band,
        remedy_kind: remedy.kind,
        remedy_paise: fromPaiseBigint(remedy.paise),
        payout_deduction_bps: remedy.payoutDeductionBps,
        attributed_to: attributedTo,
        provisional: true,
      },
    });
  }

  private async emit(
    tx: Tx,
    eventType: string,
    c: SlaClockRecord,
    at: Date,
    payload: Readonly<Record<string, EventValue>>,
  ): Promise<void> {
    await appendDomainEventOnce(tx, {
      eventType,
      aggregateKind: 'booking',
      aggregateId: c.bookingId,
      occurredAt: at,
      dedupeKey: `${c.id}:${c.dueAt.getTime()}`,
      payload: { booking_id: c.bookingId, clock_id: c.id, ...payload },
    });
  }
}

const timerOf = (c: SlaClockRecord): SlaTimer => ({ clockId: c.id, at: c.dueAt });
