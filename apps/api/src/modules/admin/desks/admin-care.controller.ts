import {
  AdminApproveClaimBody,
  AdminAssessClaimBody,
  AdminClaimItem,
  AdminClaimPage,
  AdminClaimQuery,
  AdminCreateClaimBody,
  AdminCreateTicketBody,
  AdminOpenQualityBody,
  AdminQualityItem,
  AdminQualityPage,
  AdminQualityQuery,
  AdminRejectClaimBody,
  AdminResolveQualityBody,
  AdminResolveTicketBody,
  AdminTicketDetail,
  AdminTicketMessageBody,
  AdminTicketPage,
  AdminTicketQuery,
  CARE_ACTION_ROLES,
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
  type AssessClaimBody,
  ClaimDeskService,
  type ClaimQuery,
  type CreateClaimBody,
} from './claim-desk.service';
import { AdminQueryPipe } from './paging';
import { QualityIssuesDeskService, type QualityQuery } from './quality-issues-desk.service';
import { TicketDeskService, type TicketQuery } from './ticket-desk.service';

const uuid = new ZodValidationPipe(Uuid);

/**
 * Customer care (ADR-0026 D6): the Quality Manager's queue, grievance tickets (SA-02) and
 * equipment claims (SA-01). Desks open to ADMIN_DESK_ROLES; decisions to CARE_ACTION_ROLES. Every
 * change is @Audited and idempotent under the panel's Idempotency-Key. No money moves here:
 * credits, refunds and claim payments leave as review items for "To settle".
 */
@Controller('admin/care')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
export class AdminCareController {
  constructor(
    @Inject(QualityIssuesDeskService) private readonly quality: QualityIssuesDeskService,
    @Inject(TicketDeskService) private readonly tickets: TicketDeskService,
    @Inject(ClaimDeskService) private readonly claims: ClaimDeskService,
  ) {}

  // ── Quality issues ────────────────────────────────────────────────────────

  @Get('quality')
  @Roles(...DESK_ROLES.quality)
  async qualityList(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminQualityQuery)) q: QualityQuery,
  ) {
    return respond(AdminQualityPage, await this.quality.list(caller, q));
  }

  @Post('quality')
  @HttpCode(201)
  @Roles(...CARE_ACTION_ROLES.openQuality)
  @Audited('quality.open')
  @Idempotent()
  async openQuality(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Body(new ZodValidationPipe(AdminOpenQualityBody)) body: AdminOpenQualityBody,
  ) {
    return respond(AdminQualityItem, await this.quality.open(caller, ctx, body));
  }

  @Post('quality/:id/take')
  @HttpCode(200)
  @Roles(...CARE_ACTION_ROLES.decideQuality)
  @Audited('quality.take')
  @Idempotent()
  async takeQuality(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
  ) {
    return respond(AdminQualityItem, await this.quality.take(caller, ctx, id));
  }

  @Post('quality/:id/resolve')
  @HttpCode(200)
  @Roles(...CARE_ACTION_ROLES.decideQuality)
  @Audited('quality.resolve')
  @Idempotent()
  async resolveQuality(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AdminResolveQualityBody)) body: AdminResolveQualityBody,
  ) {
    return respond(AdminQualityItem, await this.quality.resolve(caller, ctx, id, body));
  }

  // ── Support tickets ───────────────────────────────────────────────────────

  @Get('tickets')
  @Roles(...DESK_ROLES.tickets)
  async ticketList(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminTicketQuery)) q: TicketQuery,
  ) {
    return respond(AdminTicketPage, await this.tickets.list(caller, q));
  }

  @Get('tickets/:id')
  @Roles(...DESK_ROLES.tickets)
  async ticket(@CurrentStaff() caller: StaffCaller, @Param('id', uuid) id: string) {
    return respond(AdminTicketDetail, await this.tickets.detail(caller, id));
  }

  @Post('tickets')
  @HttpCode(201)
  @Roles(...CARE_ACTION_ROLES.workTickets)
  @Audited('ticket.create')
  @Idempotent()
  async createTicket(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Body(new ZodValidationPipe(AdminCreateTicketBody)) body: AdminCreateTicketBody,
  ) {
    return respond(AdminTicketDetail, await this.tickets.create(caller, ctx, body));
  }

  @Post('tickets/:id/messages')
  @HttpCode(200)
  @Roles(...CARE_ACTION_ROLES.workTickets)
  @Audited('ticket.message')
  @Idempotent()
  async ticketMessage(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AdminTicketMessageBody)) body: AdminTicketMessageBody,
  ) {
    return respond(AdminTicketDetail, await this.tickets.message(caller, ctx, id, body));
  }

  @Post('tickets/:id/acknowledge')
  @HttpCode(200)
  @Roles(...CARE_ACTION_ROLES.workTickets)
  @Audited('ticket.acknowledge')
  @Idempotent()
  async acknowledgeTicket(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
  ) {
    return respond(AdminTicketDetail, await this.tickets.acknowledge(caller, ctx, id));
  }

  @Post('tickets/:id/assign-to-me')
  @HttpCode(200)
  @Roles(...CARE_ACTION_ROLES.workTickets)
  @Audited('ticket.assign')
  @Idempotent()
  async assignTicket(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
  ) {
    return respond(AdminTicketDetail, await this.tickets.assignToMe(caller, ctx, id));
  }

  @Post('tickets/:id/resolve')
  @HttpCode(200)
  @Roles(...CARE_ACTION_ROLES.workTickets)
  @Audited('ticket.resolve')
  @Idempotent()
  async resolveTicket(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AdminResolveTicketBody)) body: AdminResolveTicketBody,
  ) {
    return respond(AdminTicketDetail, await this.tickets.resolve(caller, ctx, id, body));
  }

  // ── Equipment claims ──────────────────────────────────────────────────────

  @Get('claims')
  @Roles(...DESK_ROLES.claims)
  async claimList(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminClaimQuery)) q: ClaimQuery,
  ) {
    return respond(AdminClaimPage, await this.claims.list(caller, q));
  }

  @Post('claims')
  @HttpCode(201)
  @Roles(...CARE_ACTION_ROLES.workClaims)
  @Audited('claim.create')
  @Idempotent()
  async createClaim(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Body(new ZodValidationPipe(AdminCreateClaimBody)) body: CreateClaimBody,
  ) {
    return respond(AdminClaimItem, await this.claims.create(caller, ctx, body));
  }

  @Post('claims/:id/assess')
  @HttpCode(200)
  @Roles(...CARE_ACTION_ROLES.workClaims)
  @Audited('claim.assess')
  @Idempotent()
  async assessClaim(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AdminAssessClaimBody)) body: AssessClaimBody,
  ) {
    return respond(AdminClaimItem, await this.claims.assess(caller, ctx, id, body));
  }

  @Post('claims/:id/approve')
  @HttpCode(200)
  @Roles(...CARE_ACTION_ROLES.decideClaims)
  @Audited('claim.approve')
  @Idempotent()
  async approveClaim(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AdminApproveClaimBody)) body: AdminApproveClaimBody,
  ) {
    return respond(AdminClaimItem, await this.claims.approve(caller, ctx, id, body));
  }

  @Post('claims/:id/reject')
  @HttpCode(200)
  @Roles(...CARE_ACTION_ROLES.decideClaims)
  @Audited('claim.reject')
  @Idempotent()
  async rejectClaim(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AdminRejectClaimBody)) body: AdminRejectClaimBody,
  ) {
    return respond(AdminClaimItem, await this.claims.reject(caller, ctx, id, body));
  }
}
