import type { BookingStatus } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { IdSubquery } from '../../../infra/db/id-subquery';
import type { Db, Tx } from '../bookings.types';

export interface ClientBookingFacts {
  readonly bookingId: string;
  readonly reference: string;
  readonly status: BookingStatus;
}

interface Row {
  id: string;
  reference: string;
  status: BookingStatus;
}

const toFacts = (r: Row): ClientBookingFacts => ({
  bookingId: r.id,
  reference: r.reference,
  status: r.status,
});

/**
 * What an erased booking says instead of the client's details (ADR-0030). NOT NULL columns get a
 * fixed marker; nullable ones become NULL. The pincode, schedule and prices stay: they are what
 * the kept invoices and the ledger describe, and they identify no one on their own.
 */
export const ERASED_BOOKING = {
  bookerName: 'Deleted account',
  bookerPhone: '',
  venueAddress: 'Erased: the client deleted their account',
} as const;

/** bookings rows of one client, for account deletion (ADR-0030). */
@Injectable()
export class BookingPrivacyRepository {
  async forClient(db: Db, userId: string): Promise<ClientBookingFacts[]> {
    const rows = await db<Row[]>`
      SELECT id, reference, status FROM bookings WHERE user_id = ${userId}
      ORDER BY created_at, id`;
    return rows.map(toFacts);
  }

  /** Every booking of the client under FOR UPDATE (id order, the same as any other locker). */
  async lockForClient(tx: Tx, userId: string): Promise<ClientBookingFacts[]> {
    const rows = await tx<Row[]>`
      SELECT id, reference, status FROM bookings WHERE user_id = ${userId}
      ORDER BY id FOR UPDATE`;
    return rows.map(toFacts);
  }

  idsForClient(db: Db, userId: string): IdSubquery {
    return db`SELECT id FROM bookings WHERE user_id = ${userId}`;
  }

  /** Clears the client's personal details from every one of their bookings; returns how many. */
  async erase(tx: Tx, userId: string): Promise<number> {
    const rows = await tx`
      UPDATE bookings
      SET booker_name = ${ERASED_BOOKING.bookerName},
          booker_phone = ${ERASED_BOOKING.bookerPhone},
          subject_name = NULL,
          subject_phone = NULL,
          gallery_recipient = 'BOOKER',
          venue_address = ${ERASED_BOOKING.venueAddress},
          venue_landmark = NULL,
          venue_location = NULL,
          special_requirements = NULL
      WHERE user_id = ${userId}`;
    return rows.count;
  }
}
