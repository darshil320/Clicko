import type {
  AdminCreditItem,
  AdminCreditPage,
  AdminCreditQuery,
  AdminIssueCreditBody,
  AdminReviewItem,
  AdminReviewPage,
  AdminReviewQuery,
  AdminSettleReviewBody,
  CreditCoApprover,
} from '@clickco/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { BookingsService } from '../../bookings/bookings.service';
import type { AlertRecord } from '../../ops/ops-alerts.reader';
import { CreditsService } from '../../refunds/credits.service';
import { creditNeedsFourEyes, rupees } from '../../refunds/refund-rules';
import { MONEY_DESK_CONFIG } from '../../refunds/refunds.config';
import type { SettleDecision } from '../../refunds/reviews.service';
import { ReviewsService } from '../../refunds/reviews.service';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
import type { CityScope } from '../access/roles';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { decodeCursor, pageOf, TimeCursor, TimeSeqCursor } from '../desks/paging';
import { OverviewRegistry } from '../overview/overview.registry';
import { isAre, plural } from '../overview/overview-source';
import { assertInScope, rolesIn } from './money-access';
import { MoneyStepUp, withCoApprover } from './money-step-up';
import { toCreditItem, toReviewItem } from './money-views';
import { StaffNames } from './staff-names';

export type ReviewQuery = z.output<typeof AdminReviewQuery>;
export type CreditQuery = z.output<typeof AdminCreditQuery>;

const NOT_FOUND = { code: 'REVIEW_NOT_FOUND', message: 'This item was not found' };

function decisionOf(body: AdminSettleReviewBody): SettleDecision {
  switch (body.outcome) {
    case 'REFUND_REQUESTED':
      return {
        outcome: body.outcome,
        amountPaise: BigInt(body.amountPaise),
        refundReason: body.refundReason,
        creditPaise: BigInt(body.creditPaise ?? 0),
        note: body.note,
      };
    case 'CREDIT_ISSUED':
      return {
        outcome: body.outcome,
        amountPaise: BigInt(body.amountPaise),
        creditReason: body.creditReason,
        note: body.note,
      };
    case 'CHARGE_RAISED':
      return { outcome: body.outcome, amountPaise: BigInt(body.amountPaise), note: body.note };
    case 'NO_ACTION':
      return { outcome: body.outcome, note: body.note };
  }
}

/**
 * "To settle" (ADR-0026 D2, D8): the review items in the caller's cities with booking context
 * and a suggested outcome; settled exactly once. Also issuing a client credit from a booking.
 */
@Injectable()
export class ReviewDeskService {
  constructor(
    @Inject(ReviewsService) private readonly reviews: ReviewsService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(StaffNames) private readonly staffNames: StaffNames,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MoneyStepUp) private readonly stepUp: MoneyStepUp,
    @Inject(OverviewRegistry) overview: OverviewRegistry,
  ) {
    overview.register({
      key: 'reviews.open',
      desk: 'reviews',
      count: ({ scope }) => this.overviewCount(scope),
      tile: {
        label: 'To settle',
        hint: 'Refunds, credits and charges waiting for a decision',
        order: 70,
      },
      needsYou: {
        tone: 'attention',
        title: 'Money to settle',
        line: (n) =>
          `${plural(n, 'item')} ${isAre(n)} waiting for a refund, credit or charge decision.`,
        action: 'Settle items',
      },
    });
  }

  /** Open review items in `scope` — Today and the nav count (ADR-0026 D8). */
  overviewCount(scope: CityScope): Promise<number> {
    return this.reviews.countOpen(scope === 'ALL' ? null : this.bookings.idsInScope(scope));
  }

  async list(caller: StaffCaller, q: ReviewQuery): Promise<AdminReviewPage> {
    const cursor = decodeCursor(TimeSeqCursor, q.cursor);
    const rows = await this.reviews.page({
      bookings: caller.scope === 'ALL' ? null : this.bookings.idsInScope(caller.scope),
      status: q.status,
      ...(cursor ? { after: { occurredAt: new Date(cursor.t), seq: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (a) => ({ t: a.occurredAt.toISOString(), i: a.seq }));
    return { items: await this.items(page.items), nextCursor: page.nextCursor };
  }

  async settle(
    caller: StaffCaller,
    ctx: AuditContext,
    eventId: string,
    body: AdminSettleReviewBody,
  ): Promise<AdminReviewItem> {
    const review = await this.reviews.find(eventId);
    if (!review) throw new NotFoundException(NOT_FOUND);
    const cityId = review.bookingId ? await this.bookings.cityOf(review.bookingId) : null;
    assertInScope(caller, cityId, NOT_FOUND);
    // An item with no booking: only all-city grants count (fail closed, security review L1).
    const roles = cityId
      ? rolesIn(caller, cityId)
      : caller.grants
          .filter((g) => g.role === 'SUPER_ADMIN' || g.cityId === null)
          .map((g) => g.role);
    const creditPaise =
      body.outcome === 'CREDIT_ISSUED'
        ? BigInt(body.amountPaise)
        : body.outcome === 'REFUND_REQUESTED'
          ? BigInt(body.creditPaise ?? 0)
          : 0n;
    const co =
      body.outcome === 'CREDIT_ISSUED' || body.outcome === 'REFUND_REQUESTED'
        ? await this.fourEyes(caller, ctx, creditPaise, cityId, body, 'review.settle')
        : null;
    await this.reviews.settle(
      eventId,
      decisionOf(body),
      { staffId: caller.id, roles },
      withCoApprover(this.audit.hook(ctx, 'review', eventId), co),
    );
    const [item] = await this.items([review]);
    if (!item) throw new NotFoundException(NOT_FOUND);
    return item;
  }

  async issueCredit(
    caller: StaffCaller,
    ctx: AuditContext,
    bookingId: string,
    body: AdminIssueCreditBody,
  ): Promise<AdminCreditItem> {
    const cityId = await this.bookings.cityOf(bookingId);
    const co = await this.fourEyes(
      caller,
      ctx,
      BigInt(body.amountPaise),
      cityId,
      body,
      'credit.issue',
    );
    const credit = await this.credits.issue(
      {
        bookingId,
        amountPaise: BigInt(body.amountPaise),
        reasonCode: body.reason,
        note: body.note,
        actor: { staffId: caller.id, roles: cityId ? rolesIn(caller, cityId) : [] },
      },
      withCoApprover(this.audit.hook(ctx, 'booking', bookingId), co),
    );
    const [booking] = await this.bookings.adminFacts([bookingId]);
    return toCreditItem(credit, booking, await this.staffNames.of([credit.issuedBy]));
  }

  /**
   * Audit L8: a credit above ₹5,000 is four-eyes — the issuer's fresh authenticator code and a
   * second finance person's, both in this request. Resolves to the co-approver (null below).
   */
  private async fourEyes(
    caller: StaffCaller,
    ctx: AuditContext,
    creditPaise: bigint,
    cityId: string | null,
    approval: {
      readonly code?: string | undefined;
      readonly coApprover?: CreditCoApprover | undefined;
    },
    purpose: string,
  ): Promise<string | null> {
    if (!creditNeedsFourEyes(creditPaise)) return null;
    const why = `Credits above ${rupees(MONEY_DESK_CONFIG.creditFourEyesPaise)} need your authenticator code and a second finance person's approval with their own code.`;
    await this.stepUp.requireCode(caller, approval.code, ctx, purpose, why);
    return this.stepUp.requireCoApprover(caller, approval.coApprover, cityId, ctx, purpose, why);
  }

  async creditList(caller: StaffCaller, q: CreditQuery): Promise<AdminCreditPage> {
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const rows = await this.credits.page({
      bookings: caller.scope === 'ALL' ? null : this.bookings.idsInScope(caller.scope),
      ...(q.bookingId ? { bookingId: q.bookingId } : {}),
      ...(cursor ? { after: { createdAt: new Date(cursor.t), id: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (c) => ({ t: c.createdAt.toISOString(), i: c.id }));
    const facts = await this.bookings.adminFacts(
      page.items.flatMap((c) => (c.sourceBookingId ? [c.sourceBookingId] : [])),
    );
    const byId = new Map(facts.map((b) => [b.id, b]));
    const names = await this.staffNames.of(page.items.map((c) => c.issuedBy));
    return {
      items: page.items.map((c) =>
        toCreditItem(c, c.sourceBookingId ? byId.get(c.sourceBookingId) : undefined, names),
      ),
      nextCursor: page.nextCursor,
    };
  }

  private async items(rows: readonly AlertRecord[]): Promise<AdminReviewItem[]> {
    const contexts = await this.reviews.describe(rows);
    const cities = await this.serviceability.cityNames(
      contexts.flatMap((c) => (c.booking ? [c.booking.cityId] : [])),
    );
    const names = await this.staffNames.of(contexts.map((c) => c.resolution?.resolvedBy ?? null));
    return contexts.map((c) =>
      toReviewItem(c, c.booking ? (cities.get(c.booking.cityId) ?? null) : null, names),
    );
  }
}
