import { ClientBookingMoney, Uuid } from '@clickco/contracts';
import { Controller, Get, Inject, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { UserGuard } from '../../common/guards/user.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { BookingsService } from '../bookings/bookings.service';
import { BookingMoneyReader } from './booking-money.reader';

const BookingId = new ZodValidationPipe(Uuid);

/**
 * ADR-0027 D5: the client sees the refunds and credits on their own booking. Someone else's
 * booking answers 404, exactly like a missing one. Read-only.
 */
@Controller('bookings')
// Audit L1: USER sessions of accounts that are not blocked, checked on every request.
@UseGuards(UserGuard)
export class ClientBookingMoneyController {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(BookingMoneyReader) private readonly money: BookingMoneyReader,
  ) {}

  @Get(':id/money')
  async mine(@CurrentSubject() s: Subject, @Param('id', BookingId) id: string) {
    const booking = await this.bookings.findForUser(s.id, id);
    if (!booking) {
      throw new NotFoundException({ code: 'BOOKING_NOT_FOUND', message: 'Booking not found' });
    }
    return ok(ClientBookingMoney.parse(await this.money.forClient(s.id, id, this.clock())));
  }
}
