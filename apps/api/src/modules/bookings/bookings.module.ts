import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingReadsRepository } from './repositories/booking-reads.repository';
import { BookingsRepository } from './repositories/bookings.repository';

/** No controllers: checkout owns the HTTP surface and orchestrates bookings + payments (ADR-0009). */
@Module({
  providers: [BookingsRepository, BookingReadsRepository, BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
