import {
  AdminPricingCreateDraftBody,
  AdminPricingDiff,
  AdminPricingEditBody,
  AdminPricingOverview,
  AdminPricingPreview,
  AdminPricingPreviewQuery,
  AdminPricingPublishBody,
  AdminPricingPublishResponse,
  AdminPricingRuleset,
  AdminPricingRulesetChange,
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
import { AuditCtx, Audited, CurrentStaff, Roles } from '../access/decorators';
import { respond } from '../access/respond';
import { DESK_ROLES } from '../access/roles';
import { StaffGuard } from '../access/staff.guard';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';
import {
  type CreateBody,
  type EditBody,
  PRICING_EDITOR_ROLES,
  PricingDeskService,
  type PublishBody,
} from './pricing-desk.service';

const uuid = new ZodValidationPipe(Uuid);
const EDITORS = [...PRICING_EDITOR_ROLES];

/**
 * The pricing editor (ADR-0026 D4, doc 05 §11). Rulesets are global (not city-scoped). Viewing,
 * the diff and the calculator: the pricing desk's roles (finance, city managers, read-only).
 * Drafting, editing, discarding and publishing: FINANCE (and SUPER_ADMIN); publishing also needs
 * a fresh authenticator code in the request. Every change is @Audited and idempotent.
 */
@Controller('admin/pricing')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
export class AdminPricingController {
  constructor(@Inject(PricingDeskService) private readonly desk: PricingDeskService) {}

  @Get('rulesets')
  @Roles(...DESK_ROLES.pricing)
  async overview() {
    return respond(AdminPricingOverview, await this.desk.overview());
  }

  @Post('rulesets/drafts')
  @HttpCode(200)
  @Roles(...EDITORS)
  @Audited('pricing.draft_create')
  @Idempotent()
  async createDraft(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Body(new ZodValidationPipe(AdminPricingCreateDraftBody)) body: CreateBody,
  ) {
    return respond(AdminPricingRuleset, await this.desk.createDraft(caller, ctx, body));
  }

  @Get('rulesets/:id')
  @Roles(...DESK_ROLES.pricing)
  async detail(@Param('id', uuid) id: string) {
    return respond(AdminPricingRuleset, await this.desk.detail(id));
  }

  @Post('rulesets/:id/edits')
  @HttpCode(200)
  @Roles(...EDITORS)
  @Audited('pricing.draft_edit')
  @Idempotent()
  async edit(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AdminPricingEditBody)) body: EditBody,
  ) {
    return respond(AdminPricingRuleset, await this.desk.edit(caller, ctx, id, body));
  }

  @Post('rulesets/:id/discard')
  @HttpCode(200)
  @Roles(...EDITORS)
  @Audited('pricing.draft_discard')
  @Idempotent()
  async discard(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
  ) {
    return respond(AdminPricingRulesetChange, await this.desk.discard(caller, ctx, id));
  }

  @Get('rulesets/:id/diff')
  @Roles(...DESK_ROLES.pricing)
  async diff(@Param('id', uuid) id: string) {
    return respond(AdminPricingDiff, await this.desk.diff(id));
  }

  /** The live calculator: a read, so a GET (nothing is created). */
  @Get('rulesets/:id/preview')
  @Roles(...DESK_ROLES.pricing)
  async preview(
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(AdminPricingPreviewQuery)) query: AdminPricingPreviewQuery,
  ) {
    return respond(AdminPricingPreview, await this.desk.preview(id, query));
  }

  @Post('rulesets/:id/publish')
  @HttpCode(200)
  @Roles(...EDITORS)
  @Audited('pricing.publish')
  @Idempotent()
  async publish(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AdminPricingPublishBody)) body: PublishBody,
  ) {
    return respond(AdminPricingPublishResponse, await this.desk.publish(caller, ctx, id, body));
  }

  @Post('rulesets/:id/cancel-schedule')
  @HttpCode(200)
  @Roles(...EDITORS)
  @Audited('pricing.schedule_cancel')
  @Idempotent()
  async cancelSchedule(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
  ) {
    return respond(AdminPricingRulesetChange, await this.desk.cancelSchedule(caller, ctx, id));
  }
}
