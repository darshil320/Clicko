import { Readable } from 'node:stream';
import {
  AdminApplicationBoard,
  AdminApplicationCard,
  AdminApplicationDetail,
  AdminApplicationQuery,
  AdminCreateApplicantBody,
  AdminDocumentLink,
  AdminKycDecisionBody,
  AdminKycDecisionResponse,
  AdminKycPage,
  AdminListQuery,
  AdminMoveApplicationBody,
  AdminPenalty,
  AdminPhotographerPage,
  AdminPhotographerProfile,
  AdminPhotographerQuery,
  AdminPhotographerStatusBody,
  AdminWaivePenaltyBody,
  SUPPLY_ACTION_ROLES,
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
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuditCtx, Audited, CurrentStaff, Roles } from '../access/decorators';
import { respond } from '../access/respond';
import { DESK_ROLES } from '../access/roles';
import { StaffGuard } from '../access/staff.guard';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditLogInterceptor } from '../audit/audit-log.interceptor';
import { AdminQueryPipe, type ListQuery } from './paging';
import { type DirectoryQuery, SupplyDeskService } from './supply-desk.service';

const uuid = new ZodValidationPipe(Uuid);

/** A KYC document link per staff member per minute: enough to work, too few to bulk-scrape. */
const KYC_LINKS_PER_MINUTE = 20;

/** Types a browser may render inline from a KYC open; anything else is sent as a download. */
const INLINE_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * The photographers desk (ADR-0026 D5): onboarding kanban, KYC queue, directory, penalty waivers
 * and status changes. The desk opens to ADMIN_DESK_ROLES.photographers; each decision has its own
 * roles (SUPPLY_ACTION_ROLES) and is @Audited + idempotent. Entities are city-checked in the
 * service: another city's id answers 404, exactly like a missing one.
 */
@Controller('admin/supply')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
export class AdminSupplyController {
  constructor(@Inject(SupplyDeskService) private readonly desk: SupplyDeskService) {}

  @Get('applications')
  @Roles(...DESK_ROLES.photographers)
  async board(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminApplicationQuery)) q: AdminApplicationQuery,
  ) {
    return respond(AdminApplicationBoard, await this.desk.board(caller, q));
  }

  @Get('applications/:id')
  @Roles(...DESK_ROLES.photographers)
  async application(@CurrentStaff() caller: StaffCaller, @Param('id', uuid) id: string) {
    return respond(AdminApplicationDetail, await this.desk.application(caller, id));
  }

  @Post('applications/:id/move')
  @HttpCode(200)
  @Roles(...SUPPLY_ACTION_ROLES.moveApplication)
  @Audited('application.move')
  @Idempotent()
  async move(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AdminMoveApplicationBody)) body: AdminMoveApplicationBody,
  ) {
    return respond(AdminApplicationCard, await this.desk.move(caller, ctx, id, body));
  }

  @Post('applicants')
  @HttpCode(201)
  @Roles(...SUPPLY_ACTION_ROLES.createApplicant)
  @Audited('application.create')
  @Idempotent()
  async createApplicant(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Body(new ZodValidationPipe(AdminCreateApplicantBody)) body: AdminCreateApplicantBody,
  ) {
    return respond(AdminApplicationCard, await this.desk.createApplicant(caller, ctx, body));
  }

  @Get('kyc')
  @Roles(...DESK_ROLES.photographers)
  async kycQueue(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminListQuery)) q: ListQuery,
  ) {
    return respond(AdminKycPage, await this.desk.kycQueue(caller, q));
  }

  /** Every link is an audited view (`kyc.document_view`); never cached, never replayed. */
  @Post('kyc/:documentId/view-link')
  @HttpCode(200)
  @Roles(...SUPPLY_ACTION_ROLES.viewKycDocument)
  @Audited('kyc.document_view')
  @Throttle({ default: { limit: KYC_LINKS_PER_MINUTE, ttl: 60_000 } })
  async documentLink(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('documentId', uuid) documentId: string,
  ) {
    return respond(AdminDocumentLink, await this.desk.documentLink(caller, ctx, documentId));
  }

  /**
   * Audit M2: opens a document with a single-use token from `view-link` (same staff member, within
   * 5 minutes). Streams the bytes from StoragePort with no-store; every open is audited
   * (`kyc.document_opened`). A GET that changes nothing but the token, so not @Audited itself.
   */
  @Get('kyc/view/:token')
  @Roles(...SUPPLY_ACTION_ROLES.viewKycDocument)
  @Throttle({ default: { limit: KYC_LINKS_PER_MINUTE, ttl: 60_000 } })
  async openDocument(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { document, body } = await this.desk.openDocument(caller, ctx, token);
    const type =
      document.mimeType && INLINE_TYPES.has(document.mimeType) ? document.mimeType : null;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Referrer-Policy', 'no-referrer');
    return new StreamableFile(Readable.from(body), {
      type: type ?? 'application/octet-stream',
      disposition: type ? 'inline' : 'attachment',
    });
  }

  @Post('kyc/:documentId/decide')
  @HttpCode(200)
  @Roles(...SUPPLY_ACTION_ROLES.decideKyc)
  @Audited('kyc.decide')
  @Idempotent()
  async decideKyc(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('documentId', uuid) documentId: string,
    @Body(new ZodValidationPipe(AdminKycDecisionBody)) body: AdminKycDecisionBody,
  ) {
    return respond(
      AdminKycDecisionResponse,
      await this.desk.decideKyc(caller, ctx, documentId, body),
    );
  }

  @Get('photographers')
  @Roles(...DESK_ROLES.photographers)
  async directory(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminPhotographerQuery)) q: DirectoryQuery,
  ) {
    return respond(AdminPhotographerPage, await this.desk.directoryPage(caller, q));
  }

  @Get('photographers/:id')
  @Roles(...DESK_ROLES.photographers)
  async profile(@CurrentStaff() caller: StaffCaller, @Param('id', uuid) id: string) {
    return respond(AdminPhotographerProfile, await this.desk.profile(caller, id));
  }

  @Post('photographers/:id/status')
  @HttpCode(200)
  @Roles(...SUPPLY_ACTION_ROLES.changeStatus)
  @Audited('photographer.status')
  @Idempotent()
  async changeStatus(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(AdminPhotographerStatusBody)) body: AdminPhotographerStatusBody,
  ) {
    return respond(AdminPhotographerProfile, await this.desk.changeStatus(caller, ctx, id, body));
  }

  @Post('penalties/:penaltyId/waive')
  @HttpCode(200)
  @Roles(...SUPPLY_ACTION_ROLES.waivePenalty)
  @Audited('penalty.waive')
  @Idempotent()
  async waivePenalty(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('penaltyId', uuid) penaltyId: string,
    @Body(new ZodValidationPipe(AdminWaivePenaltyBody)) body: AdminWaivePenaltyBody,
  ) {
    return respond(AdminPenalty, await this.desk.waivePenalty(caller, ctx, penaltyId, body));
  }
}
