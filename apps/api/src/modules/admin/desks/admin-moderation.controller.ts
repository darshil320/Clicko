import {
  AdminModerationDecisionBody,
  AdminModerationDetail,
  AdminModerationPage,
  AdminModerationQuery,
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
import { ModerationDeskService, type ModerationQuery } from './moderation-desk.service';
import { AdminQueryPipe } from './paging';

const uuid = new ZodValidationPipe(Uuid);

/**
 * The moderation desk (ADR-0027 D4): QUALITY_MANAGER, SUPPORT and CITY_MANAGER (SUPER_ADMIN
 * always) work reports of reviews, clients and photographers in their cities. A report from
 * another city answers 404, like a missing one. Every decision is @Audited and idempotent under
 * the panel's Idempotency-Key; its audit row is written in the decision's transaction.
 */
@Controller('admin/moderation')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
export class AdminModerationController {
  constructor(@Inject(ModerationDeskService) private readonly desk: ModerationDeskService) {}

  @Get('reports')
  @Roles(...DESK_ROLES.moderation)
  async list(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminModerationQuery)) q: ModerationQuery,
  ) {
    return respond(AdminModerationPage, await this.desk.list(caller, q));
  }

  @Get('reports/:id')
  @Roles(...DESK_ROLES.moderation)
  @CityScoped('report', 'id')
  async report(@CurrentStaff() caller: StaffCaller, @Param('id', uuid) id: string) {
    return respond(AdminModerationDetail, await this.desk.detail(caller, id));
  }

  @Post('reports/:id/decide')
  @HttpCode(200)
  @Roles(...DESK_ROLES.moderation)
  @CityScoped('report', 'id')
  @Audited('moderation.decide')
  @Idempotent()
  async decide(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AdminModerationDecisionBody)) body: AdminModerationDecisionBody,
  ) {
    return respond(AdminModerationDetail, await this.desk.decide(caller, ctx, id, body));
  }
}
