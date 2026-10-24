import { type SlaTimelineView, Uuid } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import type postgres from 'postgres';
import { ok } from '../../common/envelope';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ENV, type Env } from '../../config/env';
import { SQL } from '../../infra/db/db.module';
import { SlaBreachesRepository } from './repositories/sla-breaches.repository';
import { effectiveDueAt } from './rules/schedule';
import { SlaService } from './sla.service';

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Not found' };

/** The console's SLA timeline for one booking (ADR-0016). Development only. */
@Controller('dev/bookings')
export class DevSlaController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(SlaService) private readonly sla: SlaService,
    @Inject(SlaBreachesRepository) private readonly breaches: SlaBreachesRepository,
  ) {}

  @Get(':id/sla')
  async timeline(@Param('id', new ZodValidationPipe(Uuid)) id: string) {
    if (this.env.NODE_ENV !== 'development') throw new NotFoundException(NOT_FOUND);
    const [clocks, breaches] = await Promise.all([
      this.sla.clocksFor(id),
      this.breaches.forBooking(this.sql, id),
    ]);
    const view: SlaTimelineView = {
      bookingId: id,
      clocks: clocks.map((c) => ({
        kind: c.kind,
        state: c.state,
        dueAt: c.dueAt.toISOString(),
        effectiveDueAt: effectiveDueAt(c.dueAt, c.pausedMs).toISOString(),
        paused: c.pausedAt !== null,
        metAt: c.metAt?.toISOString() ?? null,
        breachedAt: c.breachedAt?.toISOString() ?? null,
      })),
      breaches: breaches.map((b) => ({
        kind: b.kind,
        delayMinutes: b.delayMinutes,
        band: b.band,
        remedyKind: b.remedyKind,
        remedyPaise: fromPaiseBigint(b.remedyPaise),
        payoutDeductionBps: b.payoutDeductionBps,
        attributedTo: b.attributedTo,
        applied: b.appliedAt !== null,
      })),
    };
    return ok(view);
  }
}
