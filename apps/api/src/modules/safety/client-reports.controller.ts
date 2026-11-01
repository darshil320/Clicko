import { ReportBody } from '@clickco/contracts';
import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CLOCK, type Clock } from '../../common/clock';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { UserGuard } from '../../common/guards/user.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { ReportsService } from './reports.service';
import { SAFETY_CONFIG } from './safety-rules';
import { toReceipt } from './views';

/** A client reports a review, or the photographer of one of their bookings (ADR-0027 D4). */
@Controller('reports')
// Audit L1: USER sessions of accounts that are not blocked, checked on every request.
@UseGuards(UserGuard)
@Throttle({ default: { limit: SAFETY_CONFIG.reportsPerMinutePerIp, ttl: 60_000 } })
export class ClientReportsController {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  @Post()
  @HttpCode(201)
  async report(
    @CurrentSubject() s: Subject,
    @Body(new ZodValidationPipe(ReportBody)) body: ReportBody,
  ) {
    return ok(toReceipt(await this.reports.open({ kind: 'USER', id: s.id }, body, this.clock())));
  }
}
