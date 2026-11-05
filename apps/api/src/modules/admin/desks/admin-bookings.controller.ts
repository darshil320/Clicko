import {
  AdminBookingDetailWithAudit,
  AdminBookingPage,
  AdminBookingQuery,
  AdminConfirmDataLossBody,
  AdminConfirmPartialLossBody,
  AdminDataLossResponse,
  AdminDispatchDetail,
  AdminDispatchPage,
  AdminListQuery,
  AdminPartialLossResponse,
  DATA_LOSS_CONFIRM_ROLES,
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
import { BookingBoardService } from './booking-board.service';
import { DataLossDeskService } from './data-loss-desk.service';
import { DispatchQueueService } from './dispatch-queue.service';
import { AdminQueryPipe, type BookingQuery, type ListQuery } from './paging';

const uuid = new ZodValidationPipe(Uuid);

/**
 * The booking board and page, and the dispatch desk (ADR-0025 D5). The actions here are the
 * booking page's lost-files confirmations (ADR-0030 D2): the Quality Manager or the booking's city
 * manager, four-eyes in the request, @Audited, idempotent under the panel's Idempotency-Key.
 */
@Controller('admin')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
export class AdminBookingsController {
  constructor(
    @Inject(BookingBoardService) private readonly board: BookingBoardService,
    @Inject(DispatchQueueService) private readonly dispatch: DispatchQueueService,
    @Inject(DataLossDeskService) private readonly dataLoss: DataLossDeskService,
  ) {}

  @Get('bookings')
  @Roles(...DESK_ROLES.bookings)
  async bookings(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminBookingQuery, ['status'])) q: BookingQuery,
  ) {
    return respond(AdminBookingPage, await this.board.page(caller, q));
  }

  @Get('bookings/:bookingId')
  @Roles(...DESK_ROLES.bookings)
  @CityScoped('booking', 'bookingId')
  async booking(@CurrentStaff() caller: StaffCaller, @Param('bookingId', uuid) bookingId: string) {
    return respond(AdminBookingDetailWithAudit, await this.board.detail(caller, bookingId));
  }

  @Post('bookings/:bookingId/data-loss')
  @HttpCode(200)
  @Roles('SUPER_ADMIN', ...DATA_LOSS_CONFIRM_ROLES)
  @CityScoped('booking', 'bookingId')
  @Audited('booking.data_loss')
  @Idempotent()
  async confirmDataLoss(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('bookingId', uuid) bookingId: string,
    @Body(new ZodValidationPipe(AdminConfirmDataLossBody)) body: AdminConfirmDataLossBody,
  ) {
    return respond(
      AdminDataLossResponse,
      await this.dataLoss.confirmComplete(caller, ctx, bookingId, body),
    );
  }

  @Post('bookings/:bookingId/partial-loss')
  @HttpCode(200)
  @Roles('SUPER_ADMIN', ...DATA_LOSS_CONFIRM_ROLES)
  @CityScoped('booking', 'bookingId')
  @Audited('booking.partial_loss')
  @Idempotent()
  async confirmPartialLoss(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('bookingId', uuid) bookingId: string,
    @Body(new ZodValidationPipe(AdminConfirmPartialLossBody)) body: AdminConfirmPartialLossBody,
  ) {
    return respond(
      AdminPartialLossResponse,
      await this.dataLoss.confirmPartial(caller, ctx, bookingId, body),
    );
  }

  @Get('dispatch')
  @Roles(...DESK_ROLES.dispatch)
  async dispatchQueue(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminListQuery)) q: ListQuery,
  ) {
    return respond(AdminDispatchPage, await this.dispatch.list(caller, q));
  }

  @Get('dispatch/:bookingId')
  @Roles(...DESK_ROLES.dispatch)
  @CityScoped('booking', 'bookingId')
  async dispatchDetail(@Param('bookingId', uuid) bookingId: string) {
    return respond(AdminDispatchDetail, await this.dispatch.detail(bookingId));
  }
}
