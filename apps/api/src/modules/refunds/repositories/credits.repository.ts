import { Injectable } from '@nestjs/common';
import type { IdSubquery } from '../../../infra/db/id-subquery';
import type { CreditReasonCode } from '../refunds.config';
import type { CreditRecord, Db, Tx } from '../refunds.types';

const pg = (paise: bigint): string => paise.toString();

interface Row {
  id: string;
  user_id: string;
  amount_paise: string;
  consumed_paise: string;
  reason_code: CreditReasonCode;
  reason_note: string | null;
  source_booking_id: string | null;
  issued_by: string | null;
  expires_at: Date;
  created_at: Date;
}

const toRecord = (r: Row): CreditRecord => ({
  id: r.id,
  userId: r.user_id,
  amountPaise: BigInt(r.amount_paise),
  consumedPaise: BigInt(r.consumed_paise),
  reasonCode: r.reason_code,
  reasonNote: r.reason_note,
  sourceBookingId: r.source_booking_id,
  issuedBy: r.issued_by,
  expiresAt: r.expires_at,
  createdAt: r.created_at,
});

export interface NewCredit {
  readonly userId: string;
  readonly bookingId: string;
  readonly amountPaise: bigint;
  readonly reasonCode: CreditReasonCode;
  readonly reasonNote: string;
  readonly issuedBy: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface CreditPageQuery {
  readonly bookings: IdSubquery | null;
  readonly bookingId?: string;
  readonly after?: { readonly createdAt: Date; readonly id: string };
  readonly limit: number;
}

/** client_credits (schema §11 + addendum 0006). Issued once; the terms never change. */
@Injectable()
export class CreditsRepository {
  async insert(tx: Tx, c: NewCredit): Promise<CreditRecord> {
    const [row] = await tx<Row[]>`
      INSERT INTO client_credits (user_id, amount_paise, reason_code, reason_note,
                                  source_booking_id, issued_by, expires_at, created_at)
      VALUES (${c.userId}, ${pg(c.amountPaise)}, ${c.reasonCode}, ${c.reasonNote}, ${c.bookingId},
              ${c.issuedBy}, ${c.expiresAt}, ${c.createdAt})
      RETURNING *`;
    if (!row) throw new Error('client_credits.insert: no row returned');
    return toRecord(row);
  }

  async forBooking(db: Db, bookingId: string): Promise<CreditRecord[]> {
    const rows = await db<Row[]>`
      SELECT * FROM client_credits WHERE source_booking_id = ${bookingId}
      ORDER BY created_at, id`;
    return rows.map(toRecord);
  }

  async byIds(db: Db, ids: readonly string[]): Promise<CreditRecord[]> {
    if (ids.length === 0) return [];
    const rows = await db<Row[]>`
      SELECT * FROM client_credits WHERE id IN ${db([...new Set(ids)])}`;
    return rows.map(toRecord);
  }

  /** Credits issued from a booking (the approver ceiling counts them with refunds). */
  async totalForBooking(db: Db, bookingId: string): Promise<bigint> {
    const [row] = await db<{ total: string }[]>`
      SELECT coalesce(sum(amount_paise), 0) AS total FROM client_credits
      WHERE source_booking_id = ${bookingId}`;
    return BigInt(row?.total ?? 0);
  }

  /** Newest first, in the caller's cities. */
  async page(db: Db, q: CreditPageQuery): Promise<CreditRecord[]> {
    const scope = q.bookings ? db`source_booking_id IN (${q.bookings})` : db`TRUE`;
    const booking = q.bookingId ? db`source_booking_id = ${q.bookingId}` : db`TRUE`;
    const after = q.after
      ? db`(created_at, id) < (${q.after.createdAt}, ${q.after.id}::uuid)`
      : db`TRUE`;
    const rows = await db<Row[]>`
      SELECT * FROM client_credits WHERE ${scope} AND ${booking} AND ${after}
      ORDER BY created_at DESC, id DESC LIMIT ${q.limit}`;
    return rows.map(toRecord);
  }
}
