import {
  type AdminConfirmDataLossBody,
  type AdminConfirmPartialLossBody,
  type AdminDataLossResponse,
  type AdminPartialLossResponse,
  DATA_LOSS_CO_APPROVER_ROLES,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import { BookingsService } from '../../bookings/bookings.service';
import { DataLossService } from '../../delivery/data-loss.service';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { MoneyStepUp, withCoApprover } from '../money/money-step-up';

const WHY =
  "A lost shoot sends money back by rule, so it needs two people: your authenticator code, and a second Quality Manager, finance person or super admin entering theirs with you. Above the Quality Manager's limit the second person must be finance or a super admin.";

/**
 * The booking page's "Files lost" actions (ADR-0030 D2). Four-eyes in one request, as large
 * credits are (ADR-0027 D6a L8, MoneyStepUp): the confirmer's fresh code and a second person's
 * (QM, finance or super admin covering the city, never the confirmer). The audit row names both
 * and commits with the change; the refund itself is decided by rule, so nobody approves it later.
 */
@Injectable()
export class DataLossDeskService {
  constructor(
    @Inject(DataLossService) private readonly dataLoss: DataLossService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(MoneyStepUp) private readonly stepUp: MoneyStepUp,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async confirmComplete(
    caller: StaffCaller,
    ctx: AuditContext,
    bookingId: string,
    body: AdminConfirmDataLossBody,
  ): Promise<AdminDataLossResponse> {
    const co = await this.fourEyes(caller, ctx, bookingId, body, 'booking.data_loss');
    const r = await this.dataLoss.confirmComplete(
      bookingId,
      { staffId: caller.id, note: body.note, coApproverUnlimited: co.unlimited },
      withCoApprover(this.audit.hook(ctx, 'booking', bookingId), co.id),
    );
    return {
      bookingId: r.bookingId,
      status: r.status,
      refundPaise: fromPaiseBigint(r.refundPaise),
      refundIds: [...r.refundIds],
      supersededRefundIds: [...r.supersededRefundIds],
    };
  }

  async confirmPartial(
    caller: StaffCaller,
    ctx: AuditContext,
    bookingId: string,
    body: AdminConfirmPartialLossBody,
  ): Promise<AdminPartialLossResponse> {
    const co = await this.fourEyes(caller, ctx, bookingId, body, 'booking.partial_loss');
    const r = await this.dataLoss.confirmPartial(
      bookingId,
      body.affectedProportionBps,
      { staffId: caller.id, note: body.note, coApproverUnlimited: co.unlimited },
      withCoApprover(this.audit.hook(ctx, 'booking', bookingId), co.id),
    );
    return {
      bookingId: r.bookingId,
      status: r.status,
      affectedProportionBps: r.affectedProportionBps,
      owedPaise: fromPaiseBigint(r.owedPaise),
      refundPaise: fromPaiseBigint(r.refundPaise),
      dueAfterBalancePaise: fromPaiseBigint(r.dueAfterBalancePaise),
      refundIds: [...r.refundIds],
    };
  }

  /**
   * The confirmer's code, then the co-approver's: their staff id, and whether they hold finance or
   * super admin in the city (the service refuses a refund above the QM ceiling without it).
   */
  private async fourEyes(
    caller: StaffCaller,
    ctx: AuditContext,
    bookingId: string,
    body: AdminConfirmDataLossBody | AdminConfirmPartialLossBody,
    purpose: string,
  ): Promise<{ readonly id: string; readonly unlimited: boolean }> {
    const cityId = await this.bookings.cityOf(bookingId);
    await this.stepUp.requireCode(caller, body.code, ctx, purpose, WHY);
    return this.stepUp.coApprover(
      caller,
      body.coApprover,
      cityId,
      ctx,
      purpose,
      WHY,
      DATA_LOSS_CO_APPROVER_ROLES,
    );
  }
}
