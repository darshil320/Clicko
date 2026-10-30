import { StaffChangePasswordBody, StaffChangePasswordResponse } from '@clickco/contracts';
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuditCtx, Audited, CurrentStaff, Roles } from '../access/decorators';
import { respond } from '../access/respond';
import { DESK_ROLES } from '../access/roles';
import { StaffGuard } from '../access/staff.guard';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';
import { StaffPasswordService } from './staff-password.service';

/**
 * The signed-in person's own account (ADR-0026 D7). Every staff role may use it. Not
 * @Idempotent: the answer is a new session, and tokens must never sit in a replay store.
 */
@Controller('admin/me')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AdminAccountController {
  constructor(@Inject(StaffPasswordService) private readonly passwords: StaffPasswordService) {}

  /** Current password + new password + authenticator code → every session ends, a new one. */
  @Post('password')
  @HttpCode(200)
  @Roles(...DESK_ROLES.bookings)
  @Audited('staff.password_changed')
  async changePassword(
    @Body(new ZodValidationPipe(StaffChangePasswordBody)) body: StaffChangePasswordBody,
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
  ) {
    return respond(StaffChangePasswordResponse, await this.passwords.change(caller, body, ctx));
  }
}
