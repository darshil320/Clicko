import { ReportBody } from '@clickco/contracts';
import { Body, Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CLOCK, type Clock } from '../../common/clock';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { ProGuard } from '../../common/guards/pro.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { ReportsService } from './reports.service';
import { SAFETY_CONFIG } from './safety-rules';
import { toReceipt } from './views';

/** A photographer reports a review, or the client of a booking they worked on (ADR-0027 D4). */
@Controller('pro/reports')
@UseGuards(ProGuard)
@Throttle({ default: { limit: SAFETY_CONFIG.reportsPerMinutePerIp, ttl: 60_000 } })
export class ProReportsController {
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
    const reporter = { kind: 'PHOTOGRAPHER', id: s.id } as const;
    return ok(toReceipt(await this.reports.open(reporter, body, this.clock())));
  }
}
