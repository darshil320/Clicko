import {
  AdminApproveRefundBody,
  AdminBookingMoney,
  AdminCreditPage,
  AdminCreditQuery,
  AdminIssueCreditBody,
  AdminIssueCreditResponse,
  AdminRefundDecisionResponse,
  AdminRefundPage,
  AdminRefundQuery,
  AdminRejectRefundBody,
  AdminRequestRefundBody,
  AdminRequestRefundResponse,
  AdminReviewPage,
  AdminReviewQuery,
  AdminSettleReviewBody,
  AdminSettleReviewResponse,
  MONEY_APPROVER_ROLES,
  Uuid,
} from '@clickco/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuditCtx, Audited, CityScoped, CurrentStaff, Roles } from '../access/decorators';
import { respond } from '../access/respond';
import { DESK_ROLES } from '../access/roles';
import { StaffGuard } from '../access/staff.guard';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';
import { AdminQueryPipe } from '../desks/paging';
import { RefundDeskService, type RefundQuery } from './refund-desk.service';
import { type CreditQuery, ReviewDeskService, type ReviewQuery } from './review-desk.service';

const uuid = new ZodValidationPipe(Uuid);
const APPROVERS = [...MONEY_APPROVER_ROLES];

/**
 * The money desks (ADR-0026 D1/D2). Requests: everyone on the refund desk. Approving, rejecting,
 * retrying, issuing credits and settling review items: the QM and finance (the server then checks
 * four-eyes and the QM's ceiling per action). Every POST is @Audited and idempotent under the
 * panel's Idempotency-Key, so a retried click never moves money twice.
 */
@Controller('admin')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
export class AdminMoneyController {
  constructor(
    @Inject(RefundDeskService) private readonly refunds: RefundDeskService,
    @Inject(ReviewDeskService) private readonly reviews: ReviewDeskService,
  ) {}

  @Get('refunds')
  @Roles(...DESK_ROLES.refunds)
  async refundList(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminRefundQuery)) q: RefundQuery,
  ) {
    return respond(AdminRefundPage, await this.refunds.list(caller, q));
  }

  @Get('bookings/:bookingId/money')
  @Roles(...DESK_ROLES.refunds)
  @CityScoped('booking', 'bookingId')
  async bookingMoney(
    @CurrentStaff() caller: StaffCaller,
    @Param('bookingId', uuid) bookingId: string,
  ) {
    return respond(AdminBookingMoney, await this.refunds.bookingMoney(caller, bookingId));
  }

  @Post('bookings/:bookingId/refunds')
  @HttpCode(201)
  @Roles(...DESK_ROLES.refunds)
  @CityScoped('booking', 'bookingId')
  @Audited('refund.request')
  @Idempotent()
  async requestRefund(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('bookingId', uuid) bookingId: string,
    @Body(new ZodValidationPipe(AdminRequestRefundBody)) body: AdminRequestRefundBody,
  ) {
    return respond(
      AdminRequestRefundResponse,
      await this.refunds.request(caller, ctx, bookingId, body),
    );
  }

  @Post('refunds/:refundId/approve')
  @HttpCode(200)
  @Roles(...APPROVERS)
  @Audited('refund.approve')
  @Idempotent()
  async approve(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('refundId', uuid) refundId: string,
    @Body(new ZodValidationPipe(AdminApproveRefundBody)) body: AdminApproveRefundBody,
  ) {
    return respond(
      AdminRefundDecisionResponse,
      await this.refunds.approve(caller, ctx, refundId, body),
    );
  }

  @Post('refunds/:refundId/reject')
  @HttpCode(200)
  @Roles(...APPROVERS)
  @Audited('refund.reject')
  @Idempotent()
  async reject(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('refundId', uuid) refundId: string,
    @Body(new ZodValidationPipe(AdminRejectRefundBody)) body: AdminRejectRefundBody,
  ) {
    return respond(
      AdminRefundDecisionResponse,
      await this.refunds.reject(caller, ctx, refundId, body),
    );
  }

  @Post('refunds/:refundId/retry')
  @HttpCode(200)
  @Roles(...APPROVERS)
  @Audited('refund.retry')
  @Idempotent()
  async retry(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('refundId', uuid) refundId: string,
  ) {
    return respond(AdminRefundDecisionResponse, await this.refunds.retry(caller, ctx, refundId));
  }

  @Get('credits')
  @Roles(...DESK_ROLES.refunds)
  async creditList(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminCreditQuery)) q: CreditQuery,
  ) {
    return respond(AdminCreditPage, await this.reviews.creditList(caller, q));
  }

  @Post('bookings/:bookingId/credits')
  @HttpCode(201)
  @Roles(...APPROVERS)
  @CityScoped('booking', 'bookingId')
  @Audited('credit.issue')
  @Idempotent()
  async issueCredit(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('bookingId', uuid) bookingId: string,
    @Body(new ZodValidationPipe(AdminIssueCreditBody)) body: AdminIssueCreditBody,
  ) {
    return respond(
      AdminIssueCreditResponse,
      await this.reviews.issueCredit(caller, ctx, bookingId, body),
    );
  }

  @Get('reviews')
  @Roles(...DESK_ROLES.reviews)
  async reviewList(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminReviewQuery)) q: ReviewQuery,
  ) {
    return respond(AdminReviewPage, await this.reviews.list(caller, q));
  }

  @Post('reviews/:eventId/settle')
  @HttpCode(200)
  @Roles(...APPROVERS)
  @Audited('review.settle')
  @Idempotent()
  async settle(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('eventId', uuid) eventId: string,
    @Body(new ZodValidationPipe(AdminSettleReviewBody)) body: AdminSettleReviewBody,
  ) {
    return respond(
      AdminSettleReviewResponse,
      await this.reviews.settle(caller, ctx, eventId, body),
    );
  }
}
