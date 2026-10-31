import {
  AdminCityList,
  AdminCreateStaffBody,
  AdminCreateStaffResponse,
  AdminGrantBody,
  AdminListQuery,
  AdminResetPasswordResponse,
  AdminStaffChangeResponse,
  AdminStaffPage,
  AdminStaffStepUpBody,
  StaffProfile,
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
import { z } from 'zod';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuditCtx, Audited, CurrentStaff, Roles } from '../access/decorators';
import { respond } from '../access/respond';
import { DESK_ROLES } from '../access/roles';
import { StaffGuard } from '../access/staff.guard';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';
import { StepUpService } from '../auth/step-up.service';
import { AdminQueryPipe, decodeCursor, type ListQuery, pageOf } from '../desks/paging';
import { StaffService } from './staff.service';

const StaffCursor = z.object({ e: z.string().max(254), i: Uuid });
const uuid = new ZodValidationPipe(Uuid);
const stepUpBody = new ZodValidationPipe(AdminStaffStepUpBody);

/**
 * GET /admin/me for every staff member; staff management for SUPER_ADMIN only (ADR-0025 D5).
 * Creating an account is deliberately not @Idempotent: its answer holds the temporary password,
 * which must never be stored (a replay store would keep it for 24 h). The unique email stops a
 * double create.
 *
 * Audit M3: creating an account, granting a role, deactivating, and resetting someone's
 * authenticator or password each need a fresh code from the caller's own authenticator
 * (StepUpService, as pricing publish — ADR-0026 D4), checked before anything changes. The code is
 * taken off the body here, so it never reaches the service, its stored data or the audit row.
 * Revoking a grant only takes access away and needs none.
 */
@Controller('admin')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
export class AdminStaffController {
  constructor(
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(StepUpService) private readonly stepUp: StepUpService,
  ) {}

  @Get('me')
  @Roles(...DESK_ROLES.bookings)
  async me(@CurrentStaff() caller: StaffCaller) {
    return respond(StaffProfile, await this.staff.profile(caller.id));
  }

  /** Every role: the caller's grant cities (all cities with an all-cities grant). */
  @Get('cities')
  @Roles(...DESK_ROLES.bookings)
  async cities(@CurrentStaff() caller: StaffCaller) {
    return respond(AdminCityList, await this.staff.cities(caller.scope));
  }

  @Get('staff')
  @Roles(...DESK_ROLES.staff)
  async list(@Query(new AdminQueryPipe(AdminListQuery)) q: ListQuery) {
    const cursor = decodeCursor(StaffCursor, q.cursor);
    const after = cursor ? { email: cursor.e, id: cursor.i } : undefined;
    const rows = await this.staff.page(after, q.limit + 1);
    return respond(
      AdminStaffPage,
      pageOf(rows, q.limit, (s) => ({ e: s.email, i: s.id })),
    );
  }

  @Post('staff')
  @Roles(...DESK_ROLES.staff)
  @Audited('staff.create')
  async create(
    @Body(new ZodValidationPipe(AdminCreateStaffBody)) body: AdminCreateStaffBody,
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
  ) {
    const { code, ...account } = body;
    await this.stepUp.verify(caller.id, code, ctx, 'staff.create');
    return respond(AdminCreateStaffResponse, await this.staff.create(ctx, account));
  }

  @Post('staff/:staffId/grants')
  @HttpCode(200)
  @Roles(...DESK_ROLES.staff)
  @Audited('staff.grant')
  @Idempotent()
  async grant(
    @Param('staffId', uuid) staffId: string,
    @Body(new ZodValidationPipe(AdminGrantBody)) body: AdminGrantBody,
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
  ) {
    const { code, ...grant } = body;
    await this.stepUp.verify(caller.id, code, ctx, 'staff.grant');
    return respond(AdminStaffChangeResponse, await this.staff.grant(ctx, staffId, grant));
  }

  @Post('staff/:staffId/grants/:grantId/revoke')
  @HttpCode(200)
  @Roles(...DESK_ROLES.staff)
  @Audited('staff.revoke_grant')
  @Idempotent()
  async revoke(
    @Param('staffId', uuid) staffId: string,
    @Param('grantId', uuid) grantId: string,
    @AuditCtx() ctx: AuditContext,
  ) {
    return respond(AdminStaffChangeResponse, await this.staff.revokeGrant(ctx, staffId, grantId));
  }

  @Post('staff/:staffId/deactivate')
  @HttpCode(200)
  @Roles(...DESK_ROLES.staff)
  @Audited('staff.deactivate')
  @Idempotent()
  async deactivate(
    @Param('staffId', uuid) staffId: string,
    @Body(stepUpBody) body: AdminStaffStepUpBody,
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
  ) {
    await this.stepUp.verify(caller.id, body.code, ctx, 'staff.deactivate');
    return respond(AdminStaffChangeResponse, await this.staff.deactivate(ctx, staffId));
  }

  @Post('staff/:staffId/reset-totp')
  @HttpCode(200)
  @Roles(...DESK_ROLES.staff)
  @Audited('staff.reset_totp')
  @Idempotent()
  async resetTotp(
    @Param('staffId', uuid) staffId: string,
    @Body(stepUpBody) body: AdminStaffStepUpBody,
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
  ) {
    await this.stepUp.verify(caller.id, body.code, ctx, 'staff.reset_totp');
    return respond(AdminStaffChangeResponse, await this.staff.resetTotp(ctx, staffId));
  }

  /**
   * ADR-0026 D7: a new temporary password (72 h), shown once; their sessions end. Like create,
   * deliberately not @Idempotent — a replay store would keep the password for 24 h.
   */
  @Post('staff/:staffId/reset-password')
  @HttpCode(200)
  @Roles(...DESK_ROLES.staff)
  @Audited('staff.reset_password')
  async resetPassword(
    @Param('staffId', uuid) staffId: string,
    @Body(stepUpBody) body: AdminStaffStepUpBody,
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
  ) {
    await this.stepUp.verify(caller.id, body.code, ctx, 'staff.reset_password');
    return respond(AdminResetPasswordResponse, await this.staff.resetPassword(ctx, staffId));
  }
}
