import type { BookingStatus } from '@clickco/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { SYSTEM_ACTOR } from '../bookings/bookings.types';
import { ACCEPTED_STATUSES } from '../bookings/state-machine';
import { AuthHoldsService } from '../payments/auth-holds.service';
import { PaymentsService } from '../payments/payments.service';
import type { PaymentRecord } from '../payments/payments.types';
import type { Tx } from './dispatch.types';
import { AssignmentsRepository } from './repositories/assignments.repository';
import { AttemptsRepository } from './repositories/attempts.repository';
import { RoundsRepository } from './repositories/rounds.repository';

const CAPTURE_FAILED = 'CAPTURE_FAILED';
/** Where a declined capture can still cancel the booking (pre-shoot, CANCELLED_CLIENT is legal). */
const CANCELLABLE: readonly BookingStatus[] = ['ASSIGNED', 'EN_ROUTE'];

/** The gateway could not say what happened: throw so the outbox delivery retries (ADR-0012 D4). */
export class CaptureUnknownError extends Error {
  constructor(paymentId: string) {
    super(`Capture of payment ${paymentId} is unconfirmed`);
    this.name = 'CaptureUnknownError';
  }
}

/**
 * ADR-0010 accept step 3, driven by `booking.assigned` (after the accept commits, crash-safe via
 * the outbox). A held (<3h) payment is captured whenever an accepted, un-released assignment exists
 * and the booking is not cancelled — the invoice and ledger postings happen now (ADR-0011).
 * Under the payment's Redis lease (AuthHoldsService):
 *  - CAPTURED → booked (idempotent with the webhook path);
 *  - DECLINED (the authorisation is gone) → assignment RELEASED, booking ASSIGNED/EN_ROUTE →
 *    CANCELLED_CLIENT (CAPTURE_FAILED, ADR-0012 D3); payments releases the hold on that event;
 *  - UNKNOWN → throws; the outbox retries with backoff, then dead-letters to ops.
 */
@Injectable()
export class AcceptanceCaptureService {
  private readonly logger = new Logger(AcceptanceCaptureService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AuthHoldsService) private readonly holds: AuthHoldsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(AssignmentsRepository) private readonly assignments: AssignmentsRepository,
    @Inject(AttemptsRepository) private readonly attempts: AttemptsRepository,
    @Inject(RoundsRepository) private readonly rounds: RoundsRepository,
  ) {}

  async onAssigned(bookingId: string): Promise<void> {
    const hold = await this.holds.held(this.sql, bookingId);
    if (!hold || !(await this.captureExpected(bookingId))) return;
    await this.holds.withLock(hold.id, async () => {
      const current = await this.holds.held(this.sql, bookingId);
      if (current?.id !== hold.id) return;
      const result = await this.holds.capture(current);
      if (result === 'UNKNOWN') throw new CaptureUnknownError(hold.id);
      if (result === 'DECLINED') {
        this.logger.warn(`Capture on acceptance declined for booking ${bookingId}`);
        await this.sql.begin((tx) => this.cancelDeclined(tx, bookingId, current, this.clock()));
        return;
      }
      await this.sql.begin((tx) => this.record(tx, bookingId, current, this.clock()));
    });
  }

  private async captureExpected(bookingId: string): Promise<boolean> {
    const facts = await this.bookings.dispatchFacts(this.sql, bookingId);
    if (!ACCEPTED_STATUSES.includes(facts.status)) return false;
    return (await this.assignments.engagedForBooking(this.sql, bookingId)) !== null;
  }

  /** Lock order booking → payment (ADR-0012 D4). */
  private async record(tx: Tx, bookingId: string, hold: PaymentRecord, now: Date): Promise<void> {
    await this.bookings.lock(tx, bookingId);
    const basis = await this.bookings.quoteSnapshotTotals(tx, bookingId);
    const rec = await this.holds.recordCapture(tx, hold.id, now, basis);
    if (rec.kind !== 'ALREADY_RECORDED') {
      await this.bookings.addAmountPaid(tx, bookingId, rec.amountPaise);
    }
  }

  private async cancelDeclined(
    tx: Tx,
    bookingId: string,
    hold: PaymentRecord,
    now: Date,
  ): Promise<void> {
    const booking = await this.bookings.lock(tx, bookingId);
    if (!CANCELLABLE.includes(booking.status)) {
      // Already shooting: cancelling is no longer legal — a human decides.
      await this.payments.flagForReviewOnce(
        tx,
        hold,
        'CAPTURE_DECLINED_AFTER_START',
        hold.amountPaise,
      );
      return;
    }
    const active = await this.assignments.activeForBooking(tx, bookingId);
    if (active) await this.assignments.end(tx, active.id, 'RELEASED', CAPTURE_FAILED, now);
    await this.attempts.cancelPending(tx, bookingId);
    await this.rounds.endOpen(tx, bookingId, 'CANCELLED', now);
    await this.bookings.transition(tx, {
      bookingId,
      to: 'CANCELLED_CLIENT',
      actor: SYSTEM_ACTOR,
      occurredAt: now,
      reason: 'The client payment could not be captured',
      cancellationReason: CAPTURE_FAILED,
      payload: { reason: CAPTURE_FAILED },
    });
  }
}
