import type {
  AdminApproveRefundBody,
  AdminBookingMoney,
  AdminRefundItem,
  AdminRefundPage,
  AdminRefundQuery,
  AdminRejectRefundBody,
  AdminRequestRefundBody,
  AdminRequestRefundResponse,
  RefundStatus,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../../common/clock';
import { BookingsService } from '../../bookings/bookings.service';
import type { AdminBookingFacts } from '../../bookings/bookings.types';
import { PaymentRefundsService } from '../../payments/payment-refunds.service';
import { paidWithLabel } from '../../payments/refunds.types';
import { BookingMoneyReader } from '../../refunds/booking-money.reader';
import {
  approvalCheck,
  qmCeilingPaise,
  refundNeedsStepUp,
  rupees,
} from '../../refunds/refund-rules';
import { RefundsService } from '../../refunds/refunds.service';
import type { RefundRecord } from '../../refunds/refunds.types';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
import type { CityScope } from '../access/roles';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { decodeCursor, pageOf, TimeCursor } from '../desks/paging';
import { OverviewRegistry } from '../overview/overview.registry';
import { isAre, plural } from '../overview/overview-source';
import { assertInScope, rolesIn } from './money-access';
import { MoneyStepUp } from './money-step-up';
import { toBookingPayment, toCreditItem, toRefundItem } from './money-views';
import { StaffNames } from './staff-names';

export type RefundQuery = z.output<typeof AdminRefundQuery>;

const NOT_FOUND = { code: 'REFUND_NOT_FOUND', message: 'Refund not found' };
const BOOKING_NOT_FOUND = { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' };

const TAB: Readonly<Record<RefundQuery['status'], readonly RefundStatus[] | null>> = {
  AWAITING_APPROVAL: ['REQUESTED'],
  IN_PROGRESS: ['APPROVED', 'PROCESSING', 'FAILED'],
  DONE: ['COMPLETED', 'REJECTED'],
  ALL: null,
};

const APPROVERS = ['SUPER_ADMIN', 'FINANCE', 'QUALITY_MANAGER'];

/**
 * The refund desk (ADR-0026 D1, D8): the approval queue (oldest first), in progress and done,
 * in the caller's cities; ask for a refund from a booking; approve (four-eyes, ceiling) or
 * reject; retry a failed one. Every decision is audited in its own transaction.
 */
@Injectable()
export class RefundDeskService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RefundsService) private readonly refunds: RefundsService,
    @Inject(BookingMoneyReader) private readonly money: BookingMoneyReader,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(PaymentRefundsService) private readonly payments: PaymentRefundsService,
    @Inject(StaffNames) private readonly staffNames: StaffNames,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MoneyStepUp) private readonly stepUp: MoneyStepUp,
    @Inject(OverviewRegistry) overview: OverviewRegistry,
  ) {
    overview.register({
      key: 'refunds.awaiting_approval',
      desk: 'refunds',
      count: ({ scope }) => this.overviewCount(scope),
      tile: {
        label: 'Refunds to approve',
        hint: 'Money waiting for a second person to approve',
        order: 60,
      },
      needsYou: {
        tone: 'attention',
        title: 'Refunds to approve',
        line: (n) => `${plural(n, 'refund')} ${isAre(n)} waiting for a second pair of eyes.`,
        action: 'Review refunds',
      },
    });
  }

  /** Refunds awaiting approval in `scope` — Today and the nav count (ADR-0026 D8). */
  overviewCount(scope: CityScope): Promise<number> {
    return this.refunds.countAwaitingApproval(
      scope === 'ALL' ? null : this.bookings.idsInScope(scope),
    );
  }

  async list(caller: StaffCaller, q: RefundQuery): Promise<AdminRefundPage> {
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const rows = await this.refunds.page({
      statuses: TAB[q.status],
      bookings: caller.scope === 'ALL' ? null : this.bookings.idsInScope(caller.scope),
      oldestFirst: q.status === 'AWAITING_APPROVAL',
      ...(cursor ? { after: { createdAt: new Date(cursor.t), id: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (r) => ({ t: r.createdAt.toISOString(), i: r.id }));
    return { items: await this.items(caller, page.items), nextCursor: page.nextCursor };
  }

  /** A booking's payments, refunds and credits, for the refund and credit sheets. */
  async bookingMoney(caller: StaffCaller, bookingId: string): Promise<AdminBookingMoney> {
    const [booking] = await this.bookings.adminFacts([bookingId]);
    if (!booking) throw new NotFoundException(BOOKING_NOT_FOUND);
    const facts = await this.money.facts(bookingId);
    const names = await this.staffNames.of(facts.credits.map((c) => c.issuedBy));
    return {
      bookingId,
      reference: booking.reference,
      clientName: booking.clientName,
      totalPaise: fromPaiseBigint(booking.totalPaise),
      paidPaise: fromPaiseBigint(facts.paidPaise),
      refundedPaise: fromPaiseBigint(facts.refundedPaise),
      inFlightPaise: fromPaiseBigint(facts.inFlightPaise),
      refundablePaise: fromPaiseBigint(facts.refundablePaise),
      creditedPaise: fromPaiseBigint(facts.creditedPaise),
      qmLimitPaise: fromPaiseBigint(qmCeilingPaise(booking.totalPaise)),
      payments: facts.targets.map(toBookingPayment),
      refunds: await this.items(caller, facts.refunds),
      credits: facts.credits.map((c) => toCreditItem(c, booking, names)),
    };
  }

  async request(
    caller: StaffCaller,
    ctx: AuditContext,
    bookingId: string,
    body: AdminRequestRefundBody,
  ): Promise<AdminRequestRefundResponse> {
    const rows = await this.refunds.request(
      {
        bookingId,
        amountPaise: BigInt(body.amountPaise),
        reasonCode: body.reason,
        note: body.note,
        ...(body.paymentId ? { paymentId: body.paymentId } : {}),
        staffId: caller.id,
      },
      this.audit.hook(ctx, 'booking', bookingId),
    );
    return { refunds: await this.items(caller, rows) };
  }

  async approve(
    caller: StaffCaller,
    ctx: AuditContext,
    refundId: string,
    body: AdminApproveRefundBody,
  ): Promise<AdminRefundItem> {
    const cityId = await this.cityOf(caller, refundId);
    await this.stepUpIfAboveCeiling(caller, ctx, refundId, body.code);
    const after = await this.refunds.approve(
      refundId,
      { staffId: caller.id, roles: rolesIn(caller, cityId) },
      body.note ?? null,
      this.audit.hook(ctx, 'refund', refundId),
    );
    return this.item(caller, after);
  }

  async reject(
    caller: StaffCaller,
    ctx: AuditContext,
    refundId: string,
    body: AdminRejectRefundBody,
  ): Promise<AdminRefundItem> {
    const cityId = await this.cityOf(caller, refundId);
    const after = await this.refunds.reject(
      refundId,
      { staffId: caller.id, roles: rolesIn(caller, cityId) },
      body.note,
      this.audit.hook(ctx, 'refund', refundId),
    );
    return this.item(caller, after);
  }

  async retry(caller: StaffCaller, ctx: AuditContext, refundId: string): Promise<AdminRefundItem> {
    const cityId = await this.cityOf(caller, refundId);
    const after = await this.refunds.retry(
      refundId,
      { staffId: caller.id, roles: rolesIn(caller, cityId) },
      this.audit.hook(ctx, 'refund', refundId),
    );
    return this.item(caller, after);
  }

  /**
   * Audit: an approval above the Quality Manager's ceiling (finance territory) needs a fresh
   * authenticator code. Skipped for the requester (four-eyes refuses them anyway, without
   * spending a code), for a QM (refused as above their limit) and for anything no longer
   * awaiting approval (the service answers that).
   */
  private async stepUpIfAboveCeiling(
    caller: StaffCaller,
    ctx: AuditContext,
    refundId: string,
    code: string | undefined,
  ): Promise<void> {
    const refund = await this.refunds.find(refundId);
    if (refund?.status !== 'REQUESTED' || refund.requestedById === caller.id) return;
    const [booking] = await this.bookings.adminFacts([refund.bookingId]);
    if (!booking) return;
    // Only finance can approve above the ceiling; anyone else gets the service's own refusal.
    const roles = rolesIn(caller, booking.cityId);
    if (!roles.some((r) => r === 'FINANCE' || r === 'SUPER_ADMIN')) return;
    const committedPaise = await this.refunds.committedOnBooking(refund.bookingId);
    const facts = {
      amountPaise: refund.amountPaise,
      bookingTotalPaise: booking.totalPaise,
      committedPaise,
    };
    if (!refundNeedsStepUp(facts)) return;
    await this.stepUp.requireCode(
      caller,
      code,
      ctx,
      'refund.approve',
      `This refund takes the booking above the Quality Manager's limit of ${rupees(qmCeilingPaise(booking.totalPaise))}. Enter a fresh code from your authenticator app to approve it.`,
    );
  }

  /** The refund's booking city, in the caller's scope (else 404, like a missing refund). */
  private async cityOf(caller: StaffCaller, refundId: string): Promise<string> {
    const refund = await this.refunds.find(refundId);
    const cityId = refund ? await this.bookings.cityOf(refund.bookingId) : null;
    assertInScope(caller, cityId, NOT_FOUND);
    return cityId as string;
  }

  private async item(caller: StaffCaller, refund: RefundRecord): Promise<AdminRefundItem> {
    const [item] = await this.items(caller, [refund]);
    if (!item) throw new NotFoundException(NOT_FOUND);
    return item;
  }

  async items(caller: StaffCaller, rows: readonly RefundRecord[]): Promise<AdminRefundItem[]> {
    if (rows.length === 0) return [];
    const bookingIds = [...new Set(rows.map((r) => r.bookingId))];
    const [facts, payments, notes, names] = await Promise.all([
      this.bookings.adminFacts(bookingIds),
      this.payments.targetsByIds(rows.map((r) => r.paymentId)),
      this.payments.creditNotesForRefunds(rows.map((r) => r.id)),
      this.staffNames.of(rows.flatMap((r) => [r.requestedById, r.approvedBy, r.rejectedBy])),
    ]);
    const byBooking = new Map(facts.map((b) => [b.id, b]));
    const byPayment = new Map(payments.map((p) => [p.id, p]));
    const cities = await this.serviceability.cityNames(facts.map((b) => b.cityId));
    const pending = bookingIds.filter((id) =>
      rows.some((r) => r.bookingId === id && r.status === 'REQUESTED'),
    );
    const committed = new Map(
      await Promise.all(
        pending.map(async (id) => [id, await this.refunds.committedOnBooking(id)] as const),
      ),
    );
    const now = this.clock();
    return Promise.all(
      rows.flatMap((r) => {
        const booking = byBooking.get(r.bookingId);
        if (!booking) return [];
        const payment = byPayment.get(r.paymentId);
        return [
          (async () => {
            const committedPaise = committed.get(r.bookingId) ?? 0n;
            const decision = this.decision(caller, r, booking, committedPaise);
            return toRefundItem(r, {
              booking,
              cityName: cities.get(booking.cityId) ?? '',
              paidWith: paidWithLabel(payment?.method ?? null, payment?.vpaOrLast4 ?? null),
              names,
              notes: notes.filter((n) => n.refundId === r.id),
              ...decision,
              needsAuthenticatorCode:
                r.status === 'REQUESTED' &&
                refundNeedsStepUp({
                  amountPaise: r.amountPaise,
                  bookingTotalPaise: booking.totalPaise,
                  committedPaise,
                }),
              creditNoteLate:
                r.status === 'REQUESTED'
                  ? await this.payments.creditNoteLate(payment?.invoiceId ?? null, now)
                  : false,
            });
          })(),
        ];
      }),
    );
  }

  /** May the caller act on it now (approve/reject a request, retry a stuck one), and if not, why. */
  private decision(
    caller: StaffCaller,
    r: RefundRecord,
    booking: AdminBookingFacts,
    committedPaise: bigint,
  ): { canDecide: boolean; blockedReason: string | null } {
    const roles = rolesIn(caller, booking.cityId);
    if (r.status === 'REQUESTED') {
      const check = approvalCheck({
        approverId: caller.id,
        requesterId: r.requestedById,
        roles,
        amountPaise: r.amountPaise,
        bookingTotalPaise: booking.totalPaise,
        committedPaise,
      });
      return check.ok
        ? { canDecide: true, blockedReason: null }
        : { canDecide: false, blockedReason: check.message };
    }
    const retryable = r.status === 'FAILED' || r.status === 'PROCESSING';
    return {
      canDecide: retryable && roles.some((x) => APPROVERS.includes(x)),
      blockedReason: null,
    };
  }
}
