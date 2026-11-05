import { randomUUID } from 'node:crypto';
import { Uuid } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import type { IdSubquery } from '../../infra/db/id-subquery';
import { appendDomainEvent, appendDomainEventOnce } from '../../infra/outbox/outbox';
import { RedisLocks } from '../../infra/queues/redis-lock';
import { BookingsService } from '../bookings/bookings.service';
import type { RefundResult } from '../payments/gateways/payment-gateway.port';
import { PaymentRefundsService } from '../payments/payment-refunds.service';
import { isOwed } from '../sla/sla.public';
import { SlaDeskService } from '../sla/sla-desk.service';
import { BookingMoneyReader } from './booking-money.reader';
import { allocateRefund, approvalCheck, isSupersedable, rupees } from './refund-rules';
import { MONEY_DESK_CONFIG, type RefundReasonCode, RULE_REFUND_REASONS } from './refunds.config';
import type { MoneyActor, RefundRecord, Tx } from './refunds.types';
import { CreditsRepository } from './repositories/credits.repository';
import { type RefundPageQuery, RefundsRepository } from './repositories/refunds.repository';
import { ResolutionsRepository } from './repositories/resolutions.repository';

const NOT_FOUND = { code: 'REFUND_NOT_FOUND', message: 'Refund not found' };

const APPROVER_ROLES = ['SUPER_ADMIN', 'FINANCE', 'QUALITY_MANAGER'];

/** Defence in depth behind the route's @Roles (security review L2). */
function assertApprover(actor: MoneyActor): void {
  if (!actor.roles.some((r) => APPROVER_ROLES.includes(r))) {
    throw new ForbiddenException({
      code: 'NOT_AN_APPROVER',
      message: 'Only the Quality Manager or finance can do this',
    });
  }
}

export interface RefundRequest {
  readonly bookingId: string;
  readonly amountPaise: bigint;
  readonly reasonCode: RefundReasonCode;
  readonly note: string;
  readonly paymentId?: string;
  readonly staffId: string;
  readonly reviewResolutionId?: string;
}

/**
 * A refund a published rule decides, so no person approves it: the client's cancellation under
 * the T&C §3 ladder (DOMAIN §2). The amount comes from the pure ladder, never from a request body.
 */
export interface RuleRefund {
  readonly bookingId: string;
  readonly amountPaise: bigint;
  readonly reasonCode: RefundReasonCode;
  readonly note: string;
  readonly requestedBy: { readonly kind: 'USER' | 'SYSTEM'; readonly id: string | null };
  /** The rule that decided it, e.g. "T&C §3.1". */
  readonly rule: string;
}

/** The gateway receipt of a refund's current attempt: `<id>`, then `<id>.<n>` on a retry. */
export const receiptOf = (r: Pick<RefundRecord, 'id' | 'attempts'>): string =>
  r.attempts <= 1 ? r.id : `${r.id}.${r.attempts}`;

export interface GatewaySettlement {
  readonly status: 'PROCESSED' | 'FAILED';
  /** Our payments.id the webhook's payment maps to (null when unknown). */
  readonly paymentId: string | null;
  readonly providerRefundId: string;
  readonly amountPaise: bigint;
  readonly receipt: string | null;
}

/**
 * Refunds, maker–checker (ADR-0026 D1). REQUESTED → (approve) PROCESSING → COMPLETED or FAILED,
 * or REJECTED. The approver is never the requester; the QM approves within the ceiling, finance
 * any amount; a refund never takes a payment past what it captured (in-flight refunds included).
 * The gateway is called outside any transaction under a per-refund lease; the ledger posts
 * REFUND_ISSUED (with the GST credit note) only when the gateway confirms. Lock order: booking →
 * payment → refund. Every change emits an outbox event in its own transaction.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RefundsRepository) private readonly refunds: RefundsRepository,
    @Inject(CreditsRepository) private readonly credits: CreditsRepository,
    @Inject(PaymentRefundsService) private readonly payments: PaymentRefundsService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(BookingMoneyReader) private readonly money: BookingMoneyReader,
    @Inject(RedisLocks) private readonly locks: RedisLocks,
    @Inject(ResolutionsRepository) private readonly resolutions: ResolutionsRepository,
    @Inject(SlaDeskService) private readonly sla: SlaDeskService,
  ) {}

  find(refundId: string): Promise<RefundRecord | null> {
    return this.refunds.find(this.sql, refundId);
  }

  page(q: RefundPageQuery): Promise<RefundRecord[]> {
    return this.refunds.page(this.sql, q);
  }

  /** Refunds waiting for an approver, in scope — the Today page (ADR-0026 D8). */
  countAwaitingApproval(bookings: IdSubquery | null): Promise<number> {
    return this.refunds.count(this.sql, ['REQUESTED'], bookings);
  }

  /** Refunds approved or done on a booking plus credits issued from it (the QM ceiling counts both). */
  async committedOnBooking(bookingId: string, db: postgres.ISql = this.sql): Promise<bigint> {
    const [refunded, credited] = await Promise.all([
      this.refunds.committedForBooking(db, bookingId),
      this.credits.totalForBooking(db, bookingId),
    ]);
    return refunded + credited;
  }

  /** Asks for a refund: one row per payment it goes back to. Someone else approves it. */
  async request(r: RefundRequest, hook?: TxHook): Promise<RefundRecord[]> {
    return this.sql.begin((tx) => this.requestIn(tx, r, hook));
  }

  /** `request`, inside the caller's transaction (settling a review item). */
  async requestIn(tx: Tx, r: RefundRequest, hook?: TxHook): Promise<RefundRecord[]> {
    await this.bookings.lock(tx, r.bookingId);
    const targets = await this.money.refundTargets(tx, r.bookingId);
    const allocation = allocateRefund(
      r.amountPaise,
      targets.map((t) => ({
        paymentId: t.id,
        refundablePaise: t.refundablePaise,
        at: t.capturedAt ?? new Date(0),
      })),
      r.paymentId,
    );
    if (!allocation.ok) {
      throw new ConflictException({
        code: 'REFUND_TOO_LARGE',
        message:
          allocation.maxPaise > 0n
            ? `The most that can go back now is ${rupees(allocation.maxPaise)}`
            : 'Nothing on this booking can be refunded now',
      });
    }
    const now = this.clock();
    const rows: RefundRecord[] = [];
    for (const part of allocation.parts) {
      const row = await this.refunds.insert(tx, {
        paymentId: part.paymentId,
        bookingId: r.bookingId,
        amountPaise: part.amountPaise,
        reasonCode: r.reasonCode,
        reasonNote: r.note,
        requestedById: r.staffId,
        reviewResolutionId: r.reviewResolutionId ?? null,
        createdAt: now,
      });
      await this.event(tx, 'refund.requested', row, now, { staff_id: r.staffId });
      rows.push(row);
    }
    await hook?.(tx, {
      before: null,
      after: {
        refund_ids: rows.map((x) => x.id),
        amount_paise: fromPaiseBigint(r.amountPaise),
        reason: r.reasonCode,
        note: r.note,
      },
    });
    return rows;
  }

  /**
   * A refund the rule decides (RuleRefund), in the caller's transaction (which holds the booking
   * lock: lock order booking → payment → refund). One row per payment it goes back to, newest
   * payment first, each straight to PROCESSING with no approver — maker–checker exists for staff
   * judgement, and here there is none to check. Never more than each payment has left: a larger
   * amount throws (REFUND_TOO_LARGE) and rolls the caller back. Send with `sendIssued` after
   * commit; until then nothing has left Clickco.
   */
  async issueByRuleIn(tx: Tx, r: RuleRefund): Promise<RefundRecord[]> {
    // Security review L1: only the reasons a published rule decides, and a client only on their own
    // booking (checked under the lock). The database CHECK refund_approved_or_by_rule agrees.
    // Mirrors addendum 0019 refund_approved_or_by_rule: the client's own cancellation, or the
    // system's rule (a cancellation or a complete data loss).
    const allowed: readonly string[] =
      r.requestedBy.kind === 'USER' ? ['CLIENT_CANCEL'] : RULE_REFUND_REASONS;
    if (!allowed.includes(r.reasonCode)) {
      throw new Error(
        `issueByRuleIn: a ${r.reasonCode} refund for a ${r.requestedBy.kind} is not decided by a rule`,
      );
    }
    const booking = await this.bookings.lock(tx, r.bookingId);
    if (r.requestedBy.kind === 'USER' && booking.userId !== r.requestedBy.id) {
      throw new Error(`issueByRuleIn: the requesting client does not own booking ${r.bookingId}`);
    }
    for (const t of await this.payments.targetsForBooking(r.bookingId, tx)) {
      await this.payments.lockTarget(tx, t.id);
    }
    const targets = await this.money.refundTargets(tx, r.bookingId);
    const allocation = allocateRefund(
      r.amountPaise,
      targets.map((t) => ({
        paymentId: t.id,
        refundablePaise: t.refundablePaise,
        at: t.capturedAt ?? new Date(0),
      })),
    );
    if (!allocation.ok) {
      throw new ConflictException({
        code: 'REFUND_TOO_LARGE',
        message: 'This booking no longer has that much left to refund',
      });
    }
    const now = this.clock();
    const rows: RefundRecord[] = [];
    for (const part of allocation.parts) {
      const row = await this.refunds.insertByRule(tx, {
        paymentId: part.paymentId,
        bookingId: r.bookingId,
        amountPaise: part.amountPaise,
        reasonCode: r.reasonCode,
        reasonNote: r.note,
        requestedByKind: r.requestedBy.kind,
        requestedById: r.requestedBy.id,
        rule: r.rule,
        createdAt: now,
      });
      const by = { requested_by_kind: r.requestedBy.kind, rule: r.rule };
      await this.event(tx, 'refund.requested', row, now, { ...by, staff_id: null });
      await this.event(tx, 'refund.approved', row, now, { ...by, staff_id: null });
      rows.push(row);
    }
    return rows;
  }

  /**
   * The client is cancelling and the ladder's refund replaces every refund still open on the
   * booking (REQUESTED, or FAILED at the gateway) that no review settlement raised — the selection
   * `supersedeOpenIn` makes for a data loss, but with no staff rejecter: each becomes REJECTED
   * `rejected_by_rule` with `note` and emits `refund.rejected`. In the caller's transaction, which
   * holds the booking lock (lock order booking → refund).
   */
  async supersedeOpenByRuleIn(tx: Tx, bookingId: string, note: string): Promise<RefundRecord[]> {
    await this.bookings.lock(tx, bookingId);
    const open = (await this.refunds.forBooking(tx, bookingId)).filter(isSupersedable);
    const now = this.clock();
    const closed: RefundRecord[] = [];
    for (const r of open) {
      const locked = await this.refunds.lock(tx, r.id);
      if (!locked || !isSupersedable(locked)) continue;
      if (!(await this.refunds.supersedeByRule(tx, r.id, note, now))) continue;
      await this.event(tx, 'refund.rejected', locked, now, {
        staff_id: null,
        note,
        superseded_by: 'CLIENT_CANCELLATION',
      });
      closed.push({ ...locked, status: 'REJECTED', rejectedAt: now, decisionNote: note });
    }
    return closed;
  }

  /**
   * Sends refunds issued by rule to the gateway, after their transaction committed. Never throws:
   * the cancellation already happened. A failure raises a HIGH ops alert on the booking; the
   * refund stays PROCESSING and `sweepUnsent` picks it up (security review M2).
   */
  async sendIssued(refundIds: readonly string[]): Promise<RefundRecord[]> {
    const out: RefundRecord[] = [];
    for (const id of refundIds) {
      try {
        out.push(await this.execute(id, 'SEND'));
      } catch (error) {
        const name = error instanceof Error ? error.name : 'error';
        this.logger.error(`Refund ${id}: sending to the gateway failed (${name}); swept later`);
        await this.alertSendFailed(id, name);
      }
    }
    return out;
  }

  /**
   * The `refunds.send-sweep` job (security review M2): PROCESSING refunds with no gateway id,
   * older than `sweepAfterMs`, are looked up at the gateway by receipt (CHECK) — booked if it has
   * them, re-sent only once `resendAfterMs` has passed since they were sent, never blindly.
   * Every refund in the batch is tried; one failure does not stop the rest.
   */
  async sweepUnsent(): Promise<number> {
    const before = new Date(this.clock().getTime() - MONEY_DESK_CONFIG.sweepAfterMs);
    const ids = await this.refunds.unsent(this.sql, before, MONEY_DESK_CONFIG.sweepBatchSize);
    for (const id of ids) {
      try {
        await this.execute(id, 'CHECK');
      } catch (error) {
        const name = error instanceof Error ? error.name : 'error';
        this.logger.error(`Refund ${id}: the send sweep failed (${name})`);
      }
    }
    return ids.length;
  }

  /** Once per refund: ops sees the booking (the sweep retries on its own). Never throws. */
  private async alertSendFailed(refundId: string, errorName: string): Promise<void> {
    try {
      const r = await this.mustFind(refundId);
      await this.sql.begin((tx) =>
        appendDomainEventOnce(tx, {
          eventType: 'ops.alert',
          aggregateKind: 'booking',
          aggregateId: r.bookingId,
          occurredAt: this.clock(),
          dedupeKey: `refund.send_failed:${r.id}`,
          payload: {
            booking_id: r.bookingId,
            severity: 'HIGH',
            source_event_id: null,
            source_event_type: 'refund.send_failed',
            details: {
              refund_id: r.id,
              amount_paise: fromPaiseBigint(r.amountPaise),
              error: errorName,
            },
          },
        }),
      );
    } catch (error) {
      const name = error instanceof Error ? error.name : 'error';
      this.logger.error(`Refund ${refundId}: could not raise the ops alert (${name})`);
    }
  }

  /**
   * ADR-0030: closes every refund on the booking still waiting for approval (REQUESTED) or left
   * FAILED, because a larger refund decided by rule replaces them (a complete data loss refunds
   * everything paid). Each becomes REJECTED by `staffId` with `note` and emits `refund.rejected`.
   * A refund raised by settling a review item is left alone: its settlement (an SLA-breach remedy)
   * is applied only when it completes, so closing it would leave that breach owed for ever.
   * In the caller's transaction, which holds the booking lock (lock order booking → refund).
   */
  async supersedeOpenIn(
    tx: Tx,
    bookingId: string,
    staffId: string,
    note: string,
  ): Promise<RefundRecord[]> {
    await this.bookings.lock(tx, bookingId);
    const open = (await this.refunds.forBooking(tx, bookingId)).filter(
      (r) => (r.status === 'REQUESTED' || r.status === 'FAILED') && r.reviewResolutionId === null,
    );
    const now = this.clock();
    const closed: RefundRecord[] = [];
    for (const r of open) {
      const locked = await this.refunds.lock(tx, r.id);
      if (locked?.status !== 'REQUESTED' && locked?.status !== 'FAILED') continue;
      if (!(await this.refunds.supersede(tx, r.id, staffId, note, now))) continue;
      await this.event(tx, 'refund.rejected', locked, now, { staff_id: staffId, note });
      closed.push({
        ...locked,
        status: 'REJECTED',
        rejectedBy: staffId,
        rejectedAt: now,
        decisionNote: note,
      });
    }
    return closed;
  }

  /** Approves (four-eyes, ceiling, refundable) and sends it to the gateway at once. */
  async approve(
    refundId: string,
    actor: MoneyActor,
    note: string | null,
    hook?: TxHook,
  ): Promise<RefundRecord> {
    const known = await this.mustFind(refundId);
    await this.sql.begin(async (tx) => {
      const booking = await this.bookings.lock(tx, known.bookingId);
      const payment = await this.payments.lockTarget(tx, known.paymentId);
      const refund = await this.lockStatus(tx, refundId, 'REQUESTED');
      const check = approvalCheck({
        approverId: actor.staffId,
        requesterId: refund.requestedById,
        roles: actor.roles,
        amountPaise: refund.amountPaise,
        bookingTotalPaise: booking.totalPaise,
        committedPaise: await this.committedOnBooking(refund.bookingId, tx),
      });
      if (!check.ok) {
        const body = { code: check.code, message: check.message };
        throw check.code === 'NOT_AN_APPROVER'
          ? new ForbiddenException(body)
          : new ConflictException(body);
      }
      const inFlight = (await this.refunds.inFlightByPayment(tx, [refund.paymentId])).get(
        refund.paymentId,
      );
      const others = (inFlight ?? 0n) - refund.amountPaise;
      if (!payment || payment.capturedPaise - payment.refundedPaise - others < refund.amountPaise) {
        throw new ConflictException({
          code: 'REFUND_TOO_LARGE',
          message: 'This payment no longer has that much left to refund',
        });
      }
      const now = this.clock();
      await this.refunds.approve(tx, refundId, actor.staffId, note, now);
      await this.event(tx, 'refund.approved', refund, now, { staff_id: actor.staffId });
      await hook?.(tx, {
        before: { status: 'REQUESTED' },
        after: { status: 'PROCESSING', approved_by: actor.staffId, note },
      });
    });
    return this.execute(refundId, 'SEND');
  }

  async reject(
    refundId: string,
    actor: MoneyActor,
    note: string,
    hook?: TxHook,
  ): Promise<RefundRecord> {
    assertApprover(actor);
    const known = await this.mustFind(refundId);
    return this.sql.begin(async (tx) => {
      await this.bookings.lock(tx, known.bookingId);
      const refund = await this.lockStatus(tx, refundId, 'REQUESTED');
      const now = this.clock();
      await this.refunds.reject(tx, refundId, actor.staffId, note, now);
      await this.event(tx, 'refund.rejected', refund, now, { staff_id: actor.staffId, note });
      await hook?.(tx, { before: { status: 'REQUESTED' }, after: { status: 'REJECTED', note } });
      return {
        ...refund,
        status: 'REJECTED',
        rejectedBy: actor.staffId,
        rejectedAt: now,
        decisionNote: note,
      };
    });
  }

  /**
   * FAILED: a new gateway attempt (new receipt), only while the payment still has that much left.
   * PROCESSING: ask the gateway again — look only, never create (security review H1/H2).
   */
  async retry(refundId: string, actor: MoneyActor, hook?: TxHook): Promise<RefundRecord> {
    assertApprover(actor);
    const known = await this.mustFind(refundId);
    let mode: 'SEND' | 'CHECK' = 'CHECK';
    await this.sql.begin(async (tx) => {
      await this.bookings.lock(tx, known.bookingId);
      const payment = await this.payments.lockTarget(tx, known.paymentId);
      const refund = await this.refunds.lock(tx, refundId);
      if (refund?.status !== 'FAILED' && refund?.status !== 'PROCESSING') {
        throw new ConflictException({
          code: 'REFUND_NOT_RETRYABLE',
          message: 'Only a failed or unconfirmed refund can be tried again',
        });
      }
      const now = this.clock();
      if (refund.status === 'FAILED') {
        const inFlight =
          (await this.refunds.inFlightByPayment(tx, [refund.paymentId])).get(refund.paymentId) ??
          0n;
        if (
          !payment ||
          payment.capturedPaise - payment.refundedPaise - inFlight < refund.amountPaise
        ) {
          throw new ConflictException({
            code: 'REFUND_TOO_LARGE',
            message: 'This payment no longer has that much left to refund',
          });
        }
        await this.refunds.retry(tx, refundId, now);
        await this.event(tx, 'refund.retried', refund, now, { staff_id: actor.staffId });
        mode = 'SEND';
      }
      await hook?.(tx, {
        before: { status: refund.status, attempts: refund.attempts },
        after: { status: 'PROCESSING', staff_id: actor.staffId, mode },
      });
    });
    return this.execute(refundId, mode);
  }

  /**
   * A refund webhook (via `payment.refund_settled`). Idempotent. Anything that does not match a
   * PROCESSING refund's current attempt, payment and amount is never booked: a PROCESSED one is
   * flagged for review (security review M1, domain review M3).
   */
  async settleFromGateway(s: GatewaySettlement): Promise<void> {
    const refundId = s.receipt?.split('.')[0];
    const refund =
      refundId && Uuid.safeParse(refundId).success
        ? await this.refunds.find(this.sql, refundId)
        : null;
    const flag = (reason: string) =>
      s.status === 'PROCESSED' && (refund?.paymentId ?? s.paymentId)
        ? this.payments.flagRefundReview({
            reason,
            paymentId: (refund?.paymentId ?? s.paymentId) as string,
            bookingId: refund?.bookingId ?? null,
            refundId: refund?.id ?? null,
            providerRefundId: s.providerRefundId,
            expectedPaise: refund?.amountPaise ?? null,
            gatewayPaise: s.amountPaise,
            at: this.clock(),
          })
        : Promise.resolve();
    if (!refund) return flag('REFUND_WEBHOOK_UNMATCHED');
    if (refund.status === 'COMPLETED' && refund.providerRefundId === s.providerRefundId) return;
    if (refund.status !== 'PROCESSING' || receiptOf(refund) !== s.receipt) {
      return flag('REFUND_WEBHOOK_UNMATCHED');
    }
    if (s.paymentId !== refund.paymentId) return flag('REFUND_WEBHOOK_UNMATCHED');
    if (refund.providerRefundId && refund.providerRefundId !== s.providerRefundId) {
      return flag('REFUND_WEBHOOK_UNMATCHED');
    }
    if (s.amountPaise !== refund.amountPaise) {
      this.logger.error(
        `Refund ${refund.id}: gateway amount ${s.amountPaise} ≠ ${refund.amountPaise}`,
      );
      return flag('REFUND_AMOUNT_MISMATCH');
    }
    await this.applyResult(
      refund.id,
      s.status === 'PROCESSED'
        ? { status: 'PROCESSED', providerRefundId: s.providerRefundId }
        : {
            status: 'FAILED',
            providerRefundId: s.providerRefundId,
            reason: 'The gateway failed the refund',
          },
    );
  }

  /** Gateway call under the refund's lease, outside any transaction; then record the answer. */
  private async execute(refundId: string, mode: 'SEND' | 'CHECK'): Promise<RefundRecord> {
    const token = randomUUID();
    const key = `refund:${refundId}`;
    if ((await this.locks.acquire(key, token, MONEY_DESK_CONFIG.executionLeaseMs)) !== 'ACQUIRED') {
      return this.mustFind(refundId);
    }
    try {
      const refund = await this.mustFind(refundId);
      if (refund.status !== 'PROCESSING') return refund;
      const [payment] = await this.payments.targetsByIds([refund.paymentId]);
      if (!payment?.providerPaymentId) {
        return this.applyResult(refundId, {
          status: 'FAILED',
          providerRefundId: null,
          reason: 'This payment has no gateway payment to refund',
        });
      }
      const receipt = receiptOf(refund);
      const found =
        mode === 'CHECK' ? await this.payments.find(payment.providerPaymentId, receipt) : null;
      if (found) return await this.applyResult(refundId, found);
      // Measured from the LAST send, not the first: a re-send the gateway has not listed yet is
      // not re-sent again by the next sweep (security review, addendum 0019 last_sent_at).
      const sentAt = (refund.lastSentAt ?? refund.processingAt)?.getTime() ?? 0;
      if (mode === 'CHECK' && this.clock().getTime() - sentAt < MONEY_DESK_CONFIG.resendAfterMs) {
        return refund; // possibly sent and not listed yet: never create a second one
      }
      await this.refunds.markSent(this.sql, refundId, this.clock());
      const result = await this.payments.execute({
        providerPaymentId: payment.providerPaymentId,
        amountPaise: refund.amountPaise,
        receipt,
        notes: { refund_id: refund.id, booking_id: refund.bookingId },
      });
      return await this.applyResult(refundId, result);
    } finally {
      await this.locks.release(key, token);
    }
  }

  private async applyResult(refundId: string, result: RefundResult): Promise<RefundRecord> {
    if (result.status === 'UNKNOWN') {
      this.logger.warn(`Refund ${refundId}: the gateway gave no answer; still processing`);
      return this.mustFind(refundId);
    }
    const known = await this.mustFind(refundId);
    await this.sql.begin(async (tx) => {
      await this.bookings.lock(tx, known.bookingId);
      await this.payments.lockTarget(tx, known.paymentId);
      const refund = await this.refunds.lock(tx, refundId);
      if (refund?.status !== 'PROCESSING') return;
      const now = this.clock();
      if (result.status === 'PENDING') {
        await this.refunds.setProviderRefund(tx, refundId, result.providerRefundId);
        return;
      }
      if (result.status === 'FAILED') {
        await this.refunds.fail(tx, refundId, result.providerRefundId, result.reason, now);
        await this.event(tx, 'refund.failed', refund, now, { reason: result.reason });
        return;
      }
      const notes = await this.payments.recordRefund(tx, {
        paymentId: refund.paymentId,
        refundId,
        amountPaise: refund.amountPaise,
        reasonCode: refund.reasonCode,
        at: now,
      });
      await this.refunds.complete(tx, refundId, result.providerRefundId, now);
      await this.event(tx, 'refund.processed', refund, now, {
        provider_refund_id: result.providerRefundId,
        credit_notes: notes.map((n) => n.number),
      });
      await this.applyBreachIfPaid(tx, refund, now);
    });
    return this.mustFind(refundId);
  }

  /**
   * A refund-type breach remedy (ADR-0026 D2) counts as applied — and its payout deduction as
   * recorded — only once every refund its settlement raised has completed (domain review M1).
   */
  private async applyBreachIfPaid(tx: Tx, refund: RefundRecord, now: Date): Promise<void> {
    if (!refund.reviewResolutionId) return;
    const resolution = await this.resolutions.find(tx, refund.reviewResolutionId);
    if (!resolution?.breachId) return;
    const siblings = await this.refunds.forResolutions(tx, [resolution.id]);
    if (siblings.some((r) => r.id !== refund.id && r.status !== 'COMPLETED')) return;
    const breach = await this.sla.lockForRemedy(tx, resolution.breachId);
    if (!isOwed(breach)) return;
    await this.sla.markRemedyApplied(tx, breach, refund.approvedBy ?? resolution.resolvedBy, now);
  }

  private async mustFind(refundId: string): Promise<RefundRecord> {
    const refund = await this.refunds.find(this.sql, refundId);
    if (!refund) throw new NotFoundException(NOT_FOUND);
    return refund;
  }

  private async lockStatus(tx: Tx, refundId: string, status: 'REQUESTED'): Promise<RefundRecord> {
    const refund = await this.refunds.lock(tx, refundId);
    if (!refund) throw new NotFoundException(NOT_FOUND);
    if (refund.status !== status) {
      throw new ConflictException({
        code: 'REFUND_ALREADY_DECIDED',
        message: 'This refund was already decided',
      });
    }
    return refund;
  }

  private event(
    tx: Tx,
    eventType: string,
    r: RefundRecord,
    at: Date,
    extra: Readonly<Record<string, string | number | null | readonly string[]>>,
  ): Promise<void> {
    return appendDomainEvent(tx, {
      eventType,
      aggregateKind: 'refund',
      aggregateId: r.id,
      occurredAt: at,
      payload: {
        refund_id: r.id,
        booking_id: r.bookingId,
        payment_id: r.paymentId,
        amount_paise: fromPaiseBigint(r.amountPaise),
        reason: r.reasonCode,
        ...extra,
      },
    });
  }
}
