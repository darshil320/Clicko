import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import type { IdSubquery } from '../../infra/db/id-subquery';
import { BookingsService } from './bookings.service';
import type { Tx } from './bookings.types';
import {
  BookingPrivacyRepository,
  type ClientBookingFacts,
} from './repositories/booking-privacy.repository';

export type { ClientBookingFacts } from './repositories/booking-privacy.repository';
export { ERASED_BOOKING } from './repositories/booking-privacy.repository';

/** Unpaid: nothing was charged, and the deletion cancels them (DOMAIN §2: pre-shoot cancel). */
const UNPAID = new Set(['DRAFT', 'QUOTED']);

export interface ClientErasure {
  /** Bookings whose personal details were cleared. */
  readonly erased: number;
  /** DRAFT / QUOTED bookings moved to CANCELLED_CLIENT. */
  readonly cancelled: number;
}

/**
 * A client's bookings for account deletion (ADR-0030), owned here because bookings owns the
 * table: the client's bookings and their statuses, a lock on all of them, and the erasure itself.
 * Invoices, payments and the ledger reference these rows, so they stay; only the personal
 * details go.
 */
@Injectable()
export class BookingPrivacyService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(BookingPrivacyRepository) private readonly repo: BookingPrivacyRepository,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  forClient(userId: string): Promise<ClientBookingFacts[]> {
    return this.repo.forClient(this.sql, userId);
  }

  /** The client's booking ids, for another module's SQL filter (refunds, credits). */
  idsForClient(userId: string): IdSubquery {
    return this.repo.idsForClient(this.sql, userId);
  }

  /**
   * Locks every booking of the client for the rest of the transaction, so nothing can be paid,
   * moved or cancelled under the deletion; returns them as they stand under the lock.
   */
  lockForClient(tx: Tx, userId: string): Promise<ClientBookingFacts[]> {
    return this.repo.lockForClient(tx, userId);
  }

  /**
   * Caller holds the locks (lockForClient). Unpaid DRAFT / QUOTED bookings are cancelled by the
   * client's own act (status event + `booking.cancelled_client`), so a payment already on its
   * way can no longer start; then every booking's personal details are cleared.
   */
  async eraseClient(
    tx: Tx,
    userId: string,
    locked: readonly ClientBookingFacts[],
    at: Date,
  ): Promise<ClientErasure> {
    const unpaid = locked.filter((b) => UNPAID.has(b.status));
    for (const b of unpaid) {
      await this.bookings.transition(tx, {
        bookingId: b.bookingId,
        to: 'CANCELLED_CLIENT',
        actor: { kind: 'USER', id: userId },
        occurredAt: at,
        reason: 'The client deleted their account before paying',
        cancellationReason: 'ACCOUNT_DELETED',
        // The key the cancellation subscribers read (payments, payouts).
        payload: { reason: 'ACCOUNT_DELETED' },
      });
    }
    return { erased: await this.repo.erase(tx, userId), cancelled: unpaid.length };
  }
}
