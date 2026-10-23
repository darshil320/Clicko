import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingDispatchRepository } from './repositories/booking-dispatch.repository';
import { BookingOnsiteRepository } from './repositories/booking-onsite.repository';
import { BookingReadsRepository } from './repositories/booking-reads.repository';
import { BookingsRepository } from './repositories/bookings.repository';

/**
 * No controllers: checkout (client flow) and dispatch (photographer flow) own the HTTP surfaces and
 * orchestrate bookings + payments (ADR-0009, ADR-0010).
 */
@Module({
  providers: [
    BookingsRepository,
    BookingReadsRepository,
    BookingDispatchRepository,
    BookingOnsiteRepository,
    BookingsService,
  ],
  exports: [BookingsService],
})
export class BookingsModule {}
