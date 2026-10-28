import {
  AdminBookingDetailWithAudit,
  AdminBookingPage,
  AdminBookingQuery,
  AdminDispatchDetail,
  AdminDispatchPage,
  AdminListQuery,
  Uuid,
} from '@clickco/contracts';
import { Controller, Get, Inject, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CityScoped, CurrentStaff, Roles } from '../access/decorators';
import { respond } from '../access/respond';
import { DESK_ROLES } from '../access/roles';
import { StaffGuard } from '../access/staff.guard';
import type { StaffCaller } from '../access/staff-context';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';
import { BookingBoardService } from './booking-board.service';
import { DispatchQueueService } from './dispatch-queue.service';
import { AdminQueryPipe, type BookingQuery, type ListQuery } from './paging';

/** The booking board and page, and the dispatch desk (ADR-0025 D5). Read-only in S9. */
@Controller('admin')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
export class AdminBookingsController {
  constructor(
    @Inject(BookingBoardService) private readonly board: BookingBoardService,
    @Inject(DispatchQueueService) private readonly dispatch: DispatchQueueService,
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
  async booking(
    @CurrentStaff() caller: StaffCaller,
    @Param('bookingId', new ZodValidationPipe(Uuid)) bookingId: string,
  ) {
    return respond(AdminBookingDetailWithAudit, await this.board.detail(caller, bookingId));
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
  async dispatchDetail(@Param('bookingId', new ZodValidationPipe(Uuid)) bookingId: string) {
    return respond(AdminDispatchDetail, await this.dispatch.detail(bookingId));
  }
}
