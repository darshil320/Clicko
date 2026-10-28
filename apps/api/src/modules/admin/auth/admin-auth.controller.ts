import {
  AdminLogoutResponse,
  RefreshBody,
  StaffLoginBody,
  StaffLoginChallenge,
  StaffSessionResponse,
  StaffTotpBody,
  TokenPair,
} from '@clickco/contracts';
import { Body, Controller, HttpCode, Inject, Post, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuditCtx, Audited } from '../access/decorators';
import { respond } from '../access/respond';
import type { AuditContext } from '../access/staff-context';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';
import { StaffAuthService } from './staff-auth.service';

/**
 * Staff sign-in (ADR-0025 D2). Public routes: no StaffGuard. Per-IP throttled on top of the
 * per-email / per-IP lockout. Each route writes its own audit rows (login, failures, enrolment,
 * refresh, logout); @Audited names the route's primary action.
 */
@Controller('admin/auth')
@UseInterceptors(AuditLogInterceptor)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
export class AdminAuthController {
  constructor(@Inject(StaffAuthService) private readonly auth: StaffAuthService) {}

  /** Step 1: email + password → a TOTP challenge (or an enrolment, shown once). */
  @Post('login')
  @HttpCode(200)
  @Audited('staff.login')
  async login(
    @Body(new ZodValidationPipe(StaffLoginBody)) body: StaffLoginBody,
    @AuditCtx() ctx: AuditContext,
  ) {
    return respond(StaffLoginChallenge, await this.auth.login(body, ctx));
  }

  /** Step 2: the 6-digit code → a STAFF session and the profile. */
  @Post('totp')
  @HttpCode(200)
  @Audited('staff.login')
  async totp(
    @Body(new ZodValidationPipe(StaffTotpBody)) body: StaffTotpBody,
    @AuditCtx() ctx: AuditContext,
  ) {
    return respond(StaffSessionResponse, await this.auth.verify(body, ctx));
  }

  @Post('refresh')
  @HttpCode(200)
  @Audited('staff.refresh')
  async refresh(
    @Body(new ZodValidationPipe(RefreshBody)) body: RefreshBody,
    @AuditCtx() ctx: AuditContext,
  ) {
    return respond(TokenPair, await this.auth.refresh(body.refreshToken, ctx));
  }

  /** Always 200: the refresh token stops working at once. */
  @Post('logout')
  @HttpCode(200)
  @Audited('staff.logout')
  async logout(
    @Body(new ZodValidationPipe(RefreshBody)) body: RefreshBody,
    @AuditCtx() ctx: AuditContext,
  ) {
    await this.auth.logout(body.refreshToken, ctx);
    return respond(AdminLogoutResponse, { loggedOut: true });
  }
}
