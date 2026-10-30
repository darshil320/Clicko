import { AdminOverview } from '@clickco/contracts';
import { Controller, Get, Inject, UseGuards, UseInterceptors } from '@nestjs/common';
import { CurrentStaff, Roles } from '../access/decorators';
import { respond } from '../access/respond';
import { DESK_ROLES } from '../access/roles';
import { StaffGuard } from '../access/staff.guard';
import type { StaffCaller } from '../access/staff-context';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';
import { OverviewService } from './overview.service';

/** "Today" (ADR-0026 D8): live numbers, "Needs you" cards and the newest alerts, per caller. */
@Controller('admin')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
export class AdminOverviewController {
  constructor(@Inject(OverviewService) private readonly overview: OverviewService) {}

  /** Role- and city-scoped per source on the server; the panel polls it every minute. */
  @Get('overview')
  @Roles(...DESK_ROLES.overview)
  async get(@CurrentStaff() caller: StaffCaller) {
    return respond(AdminOverview, await this.overview.overview(caller));
  }
}
