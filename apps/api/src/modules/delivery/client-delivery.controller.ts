import { Uuid } from '@clickco/contracts';
import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import type postgres from 'postgres';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SQL } from '../../infra/db/db.module';
import type { Subject } from '../auth/token.service';
import { BookingsService } from '../bookings/bookings.service';
import { bookingNotFound } from './http-errors';
import { QaService } from './qa.service';

/** The client's delivery screen (doc 01 Screen 9): balance due, then the links. Owner only. */
@Controller('bookings')
@UseGuards(AuthGuard)
export class ClientDeliveryController {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(QaService) private readonly qa: QaService,
  ) {}

  @Get(':id/delivery')
  async delivery(
    @CurrentSubject() s: Subject,
    @Param('id', new ZodValidationPipe(Uuid)) id: string,
  ) {
    const facts = await this.bookings.deliveryFacts(this.sql, id).catch(() => null);
    if (!facts || s.kind !== 'USER' || facts.userId !== s.id) throw bookingNotFound();
    return ok(await this.qa.view(id));
  }
}
