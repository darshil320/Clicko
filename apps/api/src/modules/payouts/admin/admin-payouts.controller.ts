import {
  AdminCreatePayoutBatchBody,
  AdminExportPayoutBatchBody,
  AdminListQuery,
  AdminMarkPayoutFailedBody,
  AdminMarkPayoutsPaidBody,
  AdminPayoutBankFileBody,
  AdminPayoutBatchDetail,
  AdminPayoutBatchDiscarded,
  AdminPayoutBatchPage,
  AdminPayoutFile,
  AdminPayoutsDue,
  AdminRetryPayoutBody,
  AdminTdsQuery,
  AdminTdsSummary,
  TdsMonth,
  Uuid,
} from '@clickco/contracts';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../../common/clock';
import { ok } from '../../../common/envelope';
import { Idempotent } from '../../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuditCtx, Audited, CurrentStaff, Roles } from '../../admin/access/decorators';
import { DESK_ROLES } from '../../admin/access/roles';
import { StaffGuard } from '../../admin/access/staff.guard';
import type { AuditContext, StaffCaller } from '../../admin/access/staff-context';
import { AuditService } from '../../admin/audit/audit.service';
import { AuditLogInterceptor } from '../../admin/audit/audit-log.interceptor';
import { StepUpService } from '../../admin/auth/step-up.service';
import { AdminQueryPipe, decodeCursor, encodeCursor, TimeCursor } from '../../admin/desks/paging';
import { StaffNames } from '../../admin/money/staff-names';
import { PayoutBatchesService } from '../payout-batches.service';
import { PayoutFilesService } from '../payout-files.service';
import { PayoutReadsService } from '../payout-reads.service';

const uuid = new ZodValidationPipe(Uuid);
const month = new ZodValidationPipe(TdsMonth);

/**
 * Validates the wire (input) form against the contract and sends it as is: aggregates are
 * decimal strings (ADR-0007) and must not be turned into bigint before JSON.
 */
function respondWire<S extends z.ZodType>(schema: S, data: z.input<S>) {
  schema.parse(data);
  return ok(data);
}

/** Payouts span every city (one bank file): a city-limited grant cannot run them. */
function allCities(caller: StaffCaller): void {
  if (caller.scope !== 'ALL') {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Payouts need a finance role that covers every city',
    });
  }
}

/**
 * The payouts desk (ADR-0026 D3). FINANCE and SUPER_ADMIN only, every city. Every mutation is
 * @Audited (the row commits with the change) and idempotent; every file download is audited.
 * Audit H2: export, bank file, mark paid, mark failed and send again need a fresh authenticator
 * code (step-up); mark failed and send again are maker–checker (never the bank file's maker),
 * checked before the code is spent.
 */
@Controller('admin/payouts')
@UseGuards(StaffGuard)
@UseInterceptors(AuditLogInterceptor)
export class AdminPayoutsController {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PayoutReadsService) private readonly reads: PayoutReadsService,
    @Inject(PayoutBatchesService) private readonly batches: PayoutBatchesService,
    @Inject(PayoutFilesService) private readonly files: PayoutFilesService,
    @Inject(StepUpService) private readonly stepUp: StepUpService,
    @Inject(StaffNames) private readonly staffNames: StaffNames,
  ) {}

  private hook(ctx: AuditContext) {
    return (batchId: string) => this.audit.hook(ctx, 'payout_batch', batchId);
  }

  private detailOf(batchId: string) {
    return this.reads.detail(batchId, (ids) => this.staffNames.of(ids));
  }

  @Get('due')
  @Roles(...DESK_ROLES.payouts)
  async due(@CurrentStaff() caller: StaffCaller) {
    allCities(caller);
    return respondWire(AdminPayoutsDue, await this.reads.due(this.clock()));
  }

  @Get('batches')
  @Roles(...DESK_ROLES.payouts)
  async list(
    @CurrentStaff() caller: StaffCaller,
    @Query(new AdminQueryPipe(AdminListQuery)) q: z.output<typeof AdminListQuery>,
  ) {
    allCities(caller);
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const page = await this.reads.page(
      cursor ? { createdAt: new Date(cursor.t), id: cursor.i } : undefined,
      q.limit,
    );
    return respondWire(AdminPayoutBatchPage, {
      items: page.rows,
      nextCursor:
        page.more && page.last
          ? encodeCursor({ t: page.last.createdAt.toISOString(), i: page.last.id })
          : null,
    });
  }

  @Post('batches')
  @HttpCode(201)
  @Roles(...DESK_ROLES.payouts)
  @Audited('payout_batch.create')
  @Idempotent()
  async create(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Body(new ZodValidationPipe(AdminCreatePayoutBatchBody)) body: AdminCreatePayoutBatchBody,
  ) {
    allCities(caller);
    const id = await this.batches.create(body.kind, this.clock(), this.hook(ctx));
    return respondWire(AdminPayoutBatchDetail, await this.detailOf(id));
  }

  @Get('batches/:batchId')
  @Roles(...DESK_ROLES.payouts)
  async detail(@CurrentStaff() caller: StaffCaller, @Param('batchId', uuid) batchId: string) {
    allCities(caller);
    return respondWire(AdminPayoutBatchDetail, await this.detailOf(batchId));
  }

  @Post('batches/:batchId/discard')
  @HttpCode(200)
  @Roles(...DESK_ROLES.payouts)
  @Audited('payout_batch.discard')
  @Idempotent()
  async discard(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('batchId', uuid) batchId: string,
  ) {
    allCities(caller);
    const batch = await this.batches.discard(batchId, this.clock(), this.hook(ctx));
    return respondWire(AdminPayoutBatchDiscarded, {
      id: batch.id,
      reference: batch.reference,
      discarded: true,
    });
  }

  @Post('batches/:batchId/export')
  @HttpCode(200)
  @Roles(...DESK_ROLES.payouts)
  @Audited('payout_batch.export')
  @Idempotent()
  async export(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('batchId', uuid) batchId: string,
    @Body(new ZodValidationPipe(AdminExportPayoutBatchBody)) body: AdminExportPayoutBatchBody,
  ) {
    allCities(caller);
    await this.stepUp.verify(caller.id, body.code, ctx, 'payout_batch.export');
    await this.batches.export(batchId, caller.id, this.clock(), this.hook(ctx));
    return respondWire(AdminPayoutBatchDetail, await this.detailOf(batchId));
  }

  @Post('batches/:batchId/mark-paid')
  @HttpCode(200)
  @Roles(...DESK_ROLES.payouts)
  @Audited('payout_batch.mark_paid')
  @Idempotent()
  async markPaid(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('batchId', uuid) batchId: string,
    @Body(new ZodValidationPipe(AdminMarkPayoutsPaidBody)) body: AdminMarkPayoutsPaidBody,
  ) {
    allCities(caller);
    await this.stepUp.verify(caller.id, body.code, ctx, 'payout_batch.mark_paid');
    await this.batches.markPaid(batchId, body.transfers, this.clock(), this.hook(ctx));
    return respondWire(AdminPayoutBatchDetail, await this.detailOf(batchId));
  }

  @Post('batches/:batchId/mark-failed')
  @HttpCode(200)
  @Roles(...DESK_ROLES.payouts)
  @Audited('payout_batch.mark_failed')
  @Idempotent()
  async markFailed(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('batchId', uuid) batchId: string,
    @Body(new ZodValidationPipe(AdminMarkPayoutFailedBody)) body: AdminMarkPayoutFailedBody,
  ) {
    allCities(caller);
    await this.batches.assertSecondPerson(batchId, body.photographerId, caller.id);
    await this.stepUp.verify(caller.id, body.code, ctx, 'payout_batch.mark_failed');
    await this.batches.markFailed(
      batchId,
      body.photographerId,
      { reason: body.reason, bankReference: body.bankReference },
      caller.id,
      this.clock(),
      this.hook(ctx),
    );
    return respondWire(AdminPayoutBatchDetail, await this.detailOf(batchId));
  }

  @Post('batches/:batchId/retry')
  @HttpCode(200)
  @Roles(...DESK_ROLES.payouts)
  @Audited('payout_batch.retry')
  @Idempotent()
  async retry(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('batchId', uuid) batchId: string,
    @Body(new ZodValidationPipe(AdminRetryPayoutBody)) body: AdminRetryPayoutBody,
  ) {
    allCities(caller);
    await this.batches.assertSecondPerson(batchId, body.photographerId, caller.id);
    await this.stepUp.verify(caller.id, body.code, ctx, 'payout_batch.retry');
    await this.batches.retry(batchId, body.photographerId, caller.id, this.clock(), this.hook(ctx));
    return respondWire(AdminPayoutBatchDetail, await this.detailOf(batchId));
  }

  /**
   * The next bank file: every transfer not yet in one (each is written into exactly one file, so
   * no file pays anyone twice). Full account numbers, so deliberately NOT @Idempotent — the
   * idempotency store keeps responses, and this one must never be stored. A repeat answers
   * 409 NOTHING_NEW instead of a second file. Audited with the references, in the same tx.
   */
  @Post('batches/:batchId/bank-file')
  @HttpCode(200)
  @Roles(...DESK_ROLES.payouts)
  @Audited('payout_batch.bank_file')
  async bankFile(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('batchId', uuid) batchId: string,
    @Body(new ZodValidationPipe(AdminPayoutBankFileBody)) body: AdminPayoutBankFileBody,
  ) {
    allCities(caller);
    await this.stepUp.verify(caller.id, body.code, ctx, 'payout_batch.bank_file');
    const f = await this.files.createBankFile(
      batchId,
      caller.id,
      this.clock(),
      this.audit.hook(ctx, 'payout_batch', batchId),
    );
    return respondWire(AdminPayoutFile, f);
  }

  @Get('batches/:batchId/statements/:photographerId')
  @Roles(...DESK_ROLES.payouts)
  async statement(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('batchId', uuid) batchId: string,
    @Param('photographerId', uuid) photographerId: string,
  ) {
    allCities(caller);
    const f = await this.files.statement(batchId, photographerId);
    await this.audit.recordAlone(ctx, {
      action: 'payout.statement_downloaded',
      entityKind: 'payout_batch',
      entityId: batchId,
      after: { photographer_id: photographerId },
    });
    return respondWire(AdminPayoutFile, f);
  }

  @Get('tds')
  @Roles(...DESK_ROLES.payouts)
  async tds(
    @CurrentStaff() caller: StaffCaller,
    @Query(new ZodValidationPipe(AdminTdsQuery)) q: AdminTdsQuery,
  ) {
    allCities(caller);
    return respondWire(AdminTdsSummary, await this.files.tdsSummary(q.fy, this.clock()));
  }

  @Get('tds/:month/report')
  @Roles(...DESK_ROLES.payouts)
  async tdsReport(
    @CurrentStaff() caller: StaffCaller,
    @AuditCtx() ctx: AuditContext,
    @Param('month', month) m: string,
  ) {
    allCities(caller);
    const f = await this.files.tdsReport(m);
    await this.audit.recordAlone(ctx, {
      action: 'payout.tds_report_downloaded',
      entityKind: 'tds_report',
      entityId: null,
      after: { month: m, rows: f.rowCount },
    });
    return respondWire(AdminPayoutFile, f);
  }
}
