import type {
  CancelBookingBody,
  CancelBookingResponse,
  CancellationOutcome,
  CancellationQuote,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import type { BookingRow, BookingView, Db, Tx } from '../bookings/bookings.types';
import { DispatchReleaseService } from '../dispatch/cancellation-release.service';
import { AuthHoldsService } from '../payments/auth-holds.service';
import { PricingService } from '../pricing/pricing.service';
import { BookingMoneyReader } from '../refunds/booking-money.reader';
import { RefundsService } from '../refunds/refunds.service';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import {
  ASSIGNMENT_RELEASE_REASON,
  CLIENT_CANCELLED_BEFORE_PAYMENT,
  CLIENT_CANCELLED_REASON,
  PHOTOGRAPHER_ACCEPTED,
  UNPAID_CANCELLABLE,
} from './cancellations.config';
import type { Assessment, PaidAssessment } from './cancellations.types';
import {
  bookingNotFound,
  cancellationBlocked,
  confirmationRequired,
  termsChanged,
} from './http-errors';
import { cancellationBlock, ladderStep, splitRefund } from './rules/ladder';
import { toCancelResponse, toQuote } from './views';

const paise = fromPaiseBigint;
/** The decision note on a refund the client's cancellation replaced. */
const SUPERSEDED_NOTE = 'Replaced by the refund of the client’s cancellation (T&C §3)';
const errorName = (e: unknown): string => (e instanceof Error ? e.name : 'error');

interface Cancelled {
  readonly view: BookingView;
  readonly outcome: CancellationOutcome;
}

/**
 * A client cancels their own booking (DOMAIN §2: any pre-shoot state → CANCELLED_CLIENT). The
 * T&C §3 ladder decides what comes back (rules/ladder.ts). Owns no tables: bookings (status and
 * event), dispatch (the assignment and offers), refunds (to the gateway), payments (holds) and
 * pricing (Peak Season) are each reached through their own service, in one transaction under the
 * booking lock. Money that follows from the event — releasing a hold, the photographer's share,
 * closing calls, disarming SLA clocks, messages — is done by each module's own subscriber.
 */
@Injectable()
export class CancellationsService {
  private readonly logger = new Logger(CancellationsService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(DispatchReleaseService) private readonly dispatch: DispatchReleaseService,
    @Inject(RefundsService) private readonly refunds: RefundsService,
    @Inject(BookingMoneyReader) private readonly money: BookingMoneyReader,
    @Inject(AuthHoldsService) private readonly holds: AuthHoldsService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
  ) {}

  /** GET /bookings/:id/cancellation — what cancelling now would return. Read-only. */
  async quote(userId: string, bookingId: string): Promise<CancellationQuote> {
    const now = this.clock();
    const booking = await this.bookings.findForUser(userId, bookingId);
    if (!booking) throw bookingNotFound();
    return toQuote(bookingId, await this.assess(this.sql, booking, now), now);
  }

  /**
   * POST /bookings/:id/cancel. Re-assesses under the booking lock: a paid booking is cancelled
   * only for the refund the client confirmed (else 409 CANCELLATION_TERMS_CHANGED, nothing done).
   * The refund goes to the gateway after the commit; nothing after the commit throws, so the
   * client (and an idempotent replay) always gets the committed outcome (security review L5).
   */
  async cancel(
    userId: string,
    bookingId: string,
    body: CancelBookingBody,
  ): Promise<CancelBookingResponse> {
    // Someone else's booking is never locked, only answered 404 (security review L4).
    if (!(await this.bookings.findForUser(userId, bookingId))) throw bookingNotFound();
    const done = await this.sql.begin(async (tx) => {
      const booking = await this.bookings.lock(tx, bookingId);
      if (booking.userId !== userId) throw bookingNotFound();
      const now = this.clock(); // after the lock: the band is judged when we hold the booking
      const a = await this.assess(tx, booking, now);
      if (a.kind === 'BLOCKED') throw cancellationBlocked(a.block);
      const expected = body.expectedRefundPaise;
      if (a.kind === 'UNPAID') {
        // Everything paid comes back: no confirmation needed, but a stale figure is refused.
        if (expected !== undefined && BigInt(expected) !== a.paidPaise) {
          throw termsChanged(a.paidPaise);
        }
        return this.cancelUnpaid(tx, userId, bookingId, a, now);
      }
      if (expected === undefined) throw confirmationRequired();
      if (BigInt(expected) !== a.split.refundPaise) throw termsChanged(a.split.refundPaise);
      return this.cancelPaid(tx, userId, booking, a, now);
    });
    await this.refunds.sendIssued(done.outcome.refundIds);
    let cityName = '';
    try {
      cityName =
        (await this.serviceability.cityNames([done.view.cityId])).get(done.view.cityId) ?? '';
    } catch (error) {
      this.logger.warn(`City name for booking ${bookingId} unavailable (${errorName(error)})`);
    }
    return toCancelResponse(done.view, cityName, done.outcome);
  }

  /** The same facts for the quote (plain reads) and the POST (under the booking lock). */
  private async assess(db: Db, booking: BookingRow, now: Date): Promise<Assessment> {
    const facts = await this.bookings.dispatchFacts(db, booking.id);
    const peakSeason = await this.pricing.isPeakSeason(
      facts.rulesetId,
      facts.cityId,
      booking.scheduledStart,
    );
    // Refunds still open (REQUESTED, FAILED) are superseded by the cancellation's own refund, so
    // the money they would hold counts as paid (domain review; supersedeOpenByRuleIn).
    const paidPaise = await this.money.heldIfOpenSuperseded(db, booking.id);
    if (UNPAID_CANCELLABLE.includes(booking.status))
      return { kind: 'UNPAID', peakSeason, paidPaise };
    const block = cancellationBlock(booking.status, booking.scheduledStart, now);
    if (block) return { kind: 'BLOCKED', block, peakSeason, paidPaise };
    const hold = await this.holds.held(db, booking.id);
    // A held (<3 h) payment that a photographer's acceptance is capturing, or whose capture or
    // release is at the gateway right now (its lease is taken): wait for it to settle rather
    // than race it (ADR-0012 D4; security review M1).
    if (
      hold &&
      (PHOTOGRAPHER_ACCEPTED.includes(booking.status) || (await this.holds.inFlight(hold.id)))
    ) {
      return { kind: 'BLOCKED', block: 'PAYMENT_SETTLING', peakSeason, paidPaise };
    }
    const step = ladderStep({
      status: booking.status,
      emergencyBand: booking.emergencyBand,
      scheduledStart: booking.scheduledStart,
      now,
      peakSeason,
    });
    const split = splitRefund({
      advancePaise: booking.advancePaise,
      refundBps: step.refundBps,
      paidPaise,
    });
    return { kind: 'PAID', step, split, peakSeason, paidPaise, heldPaise: hold?.amountPaise ?? 0n };
  }

  /**
   * QUOTED / ADVANCE_PENDING: nothing was confirmed, so nothing is kept. Money that arrived anyway
   * (captured after the payment window, security review L3) comes back in full, by rule.
   */
  private async cancelUnpaid(
    tx: Tx,
    userId: string,
    bookingId: string,
    a: Extract<Assessment, { kind: 'UNPAID' }>,
    now: Date,
  ): Promise<Cancelled> {
    await this.refunds.supersedeOpenByRuleIn(tx, bookingId, SUPERSEDED_NOTE);
    const refunds =
      a.paidPaise > 0n
        ? await this.refunds.issueByRuleIn(tx, {
            bookingId,
            amountPaise: a.paidPaise,
            reasonCode: 'CLIENT_CANCEL',
            note: 'Client cancelled before the booking was confirmed: everything paid comes back',
            requestedBy: { kind: 'USER', id: userId },
            rule: 'Cancelled before confirmation',
          })
        : [];
    const refundIds = refunds.map((r) => r.id);
    await this.bookings.transition(tx, {
      bookingId,
      to: 'CANCELLED_CLIENT',
      actor: { kind: 'USER', id: userId },
      occurredAt: now,
      reason: 'Cancelled by the client before payment',
      cancellationReason: CLIENT_CANCELLED_BEFORE_PAYMENT,
      metadata: { band: 'BEFORE_PAYMENT', refund_paise: paise(a.paidPaise), kept_paise: 0 },
      payload: {
        reason: CLIENT_CANCELLED_BEFORE_PAYMENT,
        band: 'BEFORE_PAYMENT',
        refund_paise: paise(a.paidPaise),
        kept_paise: 0,
        refund_ids: refundIds,
      },
    });
    return {
      view: await this.bookings.view(tx, bookingId),
      outcome: {
        band: 'BEFORE_PAYMENT',
        clause: null,
        refundPaise: paise(a.paidPaise),
        keptPaise: 0,
        heldPaise: 0,
        refundBps: 10_000,
        peakSeason: a.peakSeason,
        refundIds,
        cancelledAt: now.toISOString(),
      },
    };
  }

  private async cancelPaid(
    tx: Tx,
    userId: string,
    booking: BookingRow,
    a: PaidAssessment,
    now: Date,
  ): Promise<Cancelled> {
    const { step, split } = a;
    const rule = `T&C §${step.clause}`;
    const released = await this.dispatch.releaseForCancellationIn(
      tx,
      booking.id,
      ASSIGNMENT_RELEASE_REASON,
      now,
    );
    await this.refunds.supersedeOpenByRuleIn(tx, booking.id, SUPERSEDED_NOTE);
    const refunds =
      split.refundPaise > 0n
        ? await this.refunds.issueByRuleIn(tx, {
            bookingId: booking.id,
            amountPaise: split.refundPaise,
            reasonCode: 'CLIENT_CANCEL',
            note: `Client cancelled (${rule}, ${step.band})`,
            requestedBy: { kind: 'USER', id: userId },
            rule,
          })
        : [];
    const refundIds = refunds.map((r) => r.id);
    // Recorded on the status event (the evidence the payouts module reads, security review L2)
    // and repeated on the outbox event.
    const facts = {
      reason: CLIENT_CANCELLED_REASON,
      band: step.band,
      clause: step.clause,
      refund_bps: step.refundBps,
      paid_paise: paise(a.paidPaise),
      refund_paise: paise(split.refundPaise),
      kept_paise: paise(split.keptPaise),
      held_paise: paise(a.heldPaise),
      peak_season: a.peakSeason,
      assignment_id: released?.assignmentId ?? null,
      photographer_id: released?.photographerId ?? null,
    };
    await this.bookings.transition(tx, {
      bookingId: booking.id,
      to: 'CANCELLED_CLIENT',
      actor: { kind: 'USER', id: userId },
      occurredAt: now,
      reason: `Cancelled by the client (${rule})`,
      cancellationReason: CLIENT_CANCELLED_REASON,
      metadata: facts,
      payload: { ...facts, booking_total_paise: paise(booking.totalPaise), refund_ids: refundIds },
    });
    return {
      view: await this.bookings.view(tx, booking.id),
      outcome: {
        band: step.band,
        clause: step.clause,
        refundPaise: paise(split.refundPaise),
        keptPaise: paise(split.keptPaise),
        heldPaise: paise(a.heldPaise),
        refundBps: step.refundBps,
        peakSeason: a.peakSeason,
        refundIds,
        cancelledAt: now.toISOString(),
      },
    };
  }
}
