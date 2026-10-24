import type { QaStatus } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { Db, DeliveryRecord, KindCount, Tx } from '../delivery.types';

interface Row {
  id: string;
  booking_id: string;
  raw_file_count: number;
  raw_bytes: string;
  jpeg_file_count: number;
  jpeg_bytes: string;
  video_file_count: number;
  video_bytes: string;
  qa_status: QaStatus;
  qa_at: Date | null;
  qa_note: string | null;
  released_at: Date | null;
  raw_expires_at: Date | null;
  jpeg_expires_at: Date | null;
}

const COLUMNS = `id, booking_id, raw_file_count, raw_bytes, jpeg_file_count, jpeg_bytes, video_file_count,
  video_bytes, qa_status, qa_at, qa_note, released_at, raw_expires_at, jpeg_expires_at`;

const toRecord = (r: Row): DeliveryRecord => ({
  id: r.id,
  bookingId: r.booking_id,
  raw: { files: r.raw_file_count, bytes: Number(r.raw_bytes) },
  jpeg: { files: r.jpeg_file_count, bytes: Number(r.jpeg_bytes) },
  video: { files: r.video_file_count, bytes: Number(r.video_bytes) },
  qaStatus: r.qa_status,
  qaAt: r.qa_at,
  qaNote: r.qa_note,
  releasedAt: r.released_at,
  rawExpiresAt: r.raw_expires_at,
  jpegExpiresAt: r.jpeg_expires_at,
});

export interface QaRecord {
  readonly bookingId: string;
  readonly raw: KindCount;
  readonly jpeg: KindCount;
  readonly video: KindCount;
  readonly status: 'PASSED' | 'FAILED';
  readonly note: string | null;
  readonly at: Date;
}

/** deliveries (schema §9): one per booking, written at QA and at release. */
@Injectable()
export class DeliveriesRepository {
  async find(db: Db, bookingId: string): Promise<DeliveryRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM deliveries WHERE booking_id = ${bookingId}`;
    return row ? toRecord(row) : null;
  }

  /** The QA decision with the inventory it was made on; a later decision replaces it. */
  async recordQa(tx: Tx, q: QaRecord): Promise<DeliveryRecord> {
    const [row] = await tx<Row[]>`
      INSERT INTO deliveries (booking_id, raw_file_count, raw_bytes, jpeg_file_count, jpeg_bytes,
                              video_file_count, video_bytes, qa_status, qa_at, qa_note)
      VALUES (${q.bookingId}, ${q.raw.files}, ${q.raw.bytes}, ${q.jpeg.files}, ${q.jpeg.bytes},
              ${q.video.files}, ${q.video.bytes}, ${q.status}, ${q.at}, ${q.note})
      ON CONFLICT (booking_id) DO UPDATE
        SET raw_file_count = EXCLUDED.raw_file_count, raw_bytes = EXCLUDED.raw_bytes,
            jpeg_file_count = EXCLUDED.jpeg_file_count, jpeg_bytes = EXCLUDED.jpeg_bytes,
            video_file_count = EXCLUDED.video_file_count, video_bytes = EXCLUDED.video_bytes,
            qa_status = EXCLUDED.qa_status, qa_at = EXCLUDED.qa_at, qa_note = EXCLUDED.qa_note
      RETURNING ${tx.unsafe(COLUMNS)}`;
    if (!row) throw new Error('deliveries.recordQa: no row returned');
    return toRecord(row);
  }

  async markReleased(
    tx: Tx,
    id: string,
    at: Date,
    rawExpiresAt: Date,
    jpegExpiresAt: Date,
  ): Promise<void> {
    await tx`
      UPDATE deliveries SET released_at = ${at}, raw_expires_at = ${rawExpiresAt},
                            jpeg_expires_at = ${jpegExpiresAt}
       WHERE id = ${id} AND released_at IS NULL`;
  }
}
