import { Inject, Injectable } from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service';
import type { UploadBookingFacts } from './media.types';

/** Media's view of bookings — always through BookingsService (Invariant 12), never its tables. */
@Injectable()
export class UploadBookings {
  constructor(@Inject(BookingsService) private readonly bookings: BookingsService) {}

  async many(bookingIds: readonly string[]): Promise<Map<string, UploadBookingFacts>> {
    if (bookingIds.length === 0) return new Map();
    const summaries = await this.bookings.offerSummaries(bookingIds);
    return new Map(
      summaries.map((s) => [
        s.bookingId,
        {
          bookingId: s.bookingId,
          reference: s.reference,
          status: s.status,
          cityId: s.cityId,
          categoryCode: s.categoryCode,
          tier: s.tier,
          scheduledStart: s.scheduledStart,
        },
      ]),
    );
  }

  async one(bookingId: string): Promise<UploadBookingFacts | null> {
    return (await this.many([bookingId])).get(bookingId) ?? null;
  }

  /** T0: the most recent CHECKED_OUT transition (Invariant 2 — never anything else). */
  async checkedOutAt(bookingId: string): Promise<Date | null> {
    const timeline = await this.bookings.timeline(bookingId);
    const checkouts = timeline.filter((t) => t.toStatus === 'CHECKED_OUT');
    return checkouts.at(-1)?.occurredAt ?? null;
  }
}
