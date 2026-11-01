import { Injectable } from '@nestjs/common';
import type { Db, ReviewDirection, ReviewRecord, Tx } from '../reviews.types';

interface Row {
  id: string;
  booking_id: string;
  direction: ReviewDirection;
  photographer_id: string | null;
  rating: number;
  comment: string | null;
  is_published: boolean;
  moderated_by: string | null;
  moderation_note: string | null;
  created_at: Date;
  updated_at: Date;
}

const toRecord = (r: Row): ReviewRecord => ({
  id: r.id,
  bookingId: r.booking_id,
  direction: r.direction,
  photographerId: r.photographer_id,
  rating: r.rating,
  comment: r.comment,
  isPublished: r.is_published,
  moderatedBy: r.moderated_by,
  moderationNote: r.moderation_note,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const COLUMNS = (db: Db) => db`
  id, booking_id, direction, photographer_id, rating, comment, is_published, moderated_by,
  moderation_note, created_at, updated_at`;

/** All SQL on `reviews` (schema §12, addendum 0016). Only the reviews module reads it. */
@Injectable()
export class ReviewsRepository {
  async clientReviewOf(db: Db, bookingId: string): Promise<ReviewRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${COLUMNS(db)} FROM reviews
      WHERE booking_id = ${bookingId} AND direction = 'CLIENT_TO_PRO'`;
    return row ? toRecord(row) : null;
  }

  /** The booking's CLIENT_TO_PRO review, held FOR UPDATE for the rest of the transaction. */
  async lockClientReview(tx: Tx, bookingId: string): Promise<ReviewRecord | null> {
    const [row] = await tx<Row[]>`
      SELECT ${COLUMNS(tx)} FROM reviews
      WHERE booking_id = ${bookingId} AND direction = 'CLIENT_TO_PRO' FOR UPDATE`;
    return row ? toRecord(row) : null;
  }

  /** Held FOR SHARE: no edit lands until the caller's transaction (a report) commits. */
  async shareById(tx: Tx, id: string): Promise<ReviewRecord | null> {
    const [row] = await tx<Row[]>`SELECT ${COLUMNS(tx)} FROM reviews WHERE id = ${id} FOR SHARE`;
    return row ? toRecord(row) : null;
  }

  async byId(db: Db, id: string): Promise<ReviewRecord | null> {
    const [row] = await db<Row[]>`SELECT ${COLUMNS(db)} FROM reviews WHERE id = ${id}`;
    return row ? toRecord(row) : null;
  }

  async lockById(tx: Tx, id: string): Promise<ReviewRecord | null> {
    const [row] = await tx<Row[]>`SELECT ${COLUMNS(tx)} FROM reviews WHERE id = ${id} FOR UPDATE`;
    return row ? toRecord(row) : null;
  }

  async insertClientReview(
    tx: Tx,
    r: {
      readonly bookingId: string;
      readonly photographerId: string;
      readonly rating: number;
      readonly comment: string | null;
      readonly at: Date;
    },
  ): Promise<ReviewRecord> {
    const [row] = await tx<Row[]>`
      INSERT INTO reviews (booking_id, direction, photographer_id, rating, comment, created_at,
                           updated_at)
      VALUES (${r.bookingId}, 'CLIENT_TO_PRO', ${r.photographerId}, ${r.rating}, ${r.comment},
              ${r.at}, ${r.at})
      RETURNING ${COLUMNS(tx)}`;
    if (!row) throw new Error('insertClientReview: no row');
    return toRecord(row);
  }

  /** The author's edit; null when the review is no longer published (never edits a hidden one). */
  async edit(
    tx: Tx,
    id: string,
    e: { readonly rating: number; readonly comment: string | null; readonly at: Date },
  ): Promise<ReviewRecord | null> {
    const [row] = await tx<Row[]>`
      UPDATE reviews SET rating = ${e.rating}, comment = ${e.comment}, updated_at = ${e.at}
      WHERE id = ${id} AND is_published RETURNING ${COLUMNS(tx)}`;
    return row ? toRecord(row) : null;
  }

  /** A staff decision: published or hidden, by whom, why. */
  async moderate(
    tx: Tx,
    id: string,
    m: { readonly published: boolean; readonly staffId: string; readonly note: string },
  ): Promise<ReviewRecord> {
    const [row] = await tx<Row[]>`
      UPDATE reviews SET is_published = ${m.published}, moderated_by = ${m.staffId},
                         moderation_note = ${m.note}
      WHERE id = ${id} RETURNING ${COLUMNS(tx)}`;
    if (!row) throw new Error(`moderate: review ${id} vanished`);
    return toRecord(row);
  }
}
