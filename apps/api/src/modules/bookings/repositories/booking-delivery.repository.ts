import type { BookingStatus } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { Db, DeliveryBookingFacts, Tx } from '../bookings.types';

interface Row {
  id: string;
  reference: string;
  status: BookingStatus;
  user_id: string;
  scheduled_start: Date;
  total_paise: string;
  advance_paise: string;
  balance_paise: string;
  amount_paid_paise: string;
  sla_t0: Date | null;
  delivery_due_at: Date | null;
  delivered_at: Date | null;
  gallery_recipient: 'BOOKER' | 'SUBJECT';
  has_rush: boolean;
}

/** The delivery/SLA columns of bookings (ADR-0016). Writes only in the caller's transaction. */
@Injectable()
export class BookingDeliveryRepository {
  async facts(db: Db, bookingId: string): Promise<DeliveryBookingFacts | null> {
    const [r] = await db<Row[]>`
      SELECT b.id, b.reference, b.status, b.user_id, b.scheduled_start, b.total_paise,
             b.advance_paise, b.balance_paise, b.amount_paid_paise, b.sla_t0, b.delivery_due_at,
             b.delivered_at, b.gallery_recipient,
             EXISTS (SELECT 1 FROM booking_addons ba JOIN addons a ON a.id = ba.addon_id
                     WHERE ba.booking_id = b.id AND a.code = 'RUSH_24H') AS has_rush
      FROM bookings b WHERE b.id = ${bookingId}`;
    if (!r) return null;
    return {
      bookingId: r.id,
      reference: r.reference,
      status: r.status,
      userId: r.user_id,
      scheduledStart: r.scheduled_start,
      totalPaise: BigInt(r.total_paise),
      advancePaise: BigInt(r.advance_paise),
      balancePaise: BigInt(r.balance_paise),
      amountPaidPaise: BigInt(r.amount_paid_paise),
      slaT0: r.sla_t0,
      deliveryDueAt: r.delivery_due_at,
      deliveredAt: r.delivered_at,
      galleryRecipient: r.gallery_recipient,
      hasRushDelivery: r.has_rush,
    };
  }

  /** A T0 that is not a check-out (unsafe site, ADR-0016 D11). Once: never overwrites. */
  async setSlaAnchor(tx: Tx, bookingId: string, t0: Date, deliveryDueAt: Date): Promise<boolean> {
    const rows = await tx`
      UPDATE bookings SET sla_t0 = ${t0}, delivery_due_at = ${deliveryDueAt}
       WHERE id = ${bookingId} AND sla_t0 IS NULL
       RETURNING id`;
    return rows.length === 1;
  }

  async setDelivered(tx: Tx, bookingId: string, at: Date): Promise<void> {
    await tx`UPDATE bookings SET delivered_at = ${at} WHERE id = ${bookingId} AND delivered_at IS NULL`;
  }

  async setClosed(tx: Tx, bookingId: string, at: Date): Promise<void> {
    await tx`UPDATE bookings SET closed_at = ${at} WHERE id = ${bookingId} AND closed_at IS NULL`;
  }
}
