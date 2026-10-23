import type { UploadSessionStatus } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { Db, Tx, UploadSessionRecord } from '../media.types';
import type { SessionDoc } from '../session-doc';

interface Row {
  id: string;
  booking_id: string;
  photographer_id: string;
  origin: string;
  status: UploadSessionStatus;
  declared_file_count: number;
  declared_bytes: string;
  received_file_count: number;
  received_bytes: string;
  completed_parts: SessionDoc;
  last_activity_at: Date;
  failure_reason: string | null;
  started_at: Date;
  completed_at: Date | null;
}

const COLUMNS = `id, booking_id, photographer_id, origin, status, declared_file_count, declared_bytes,
  received_file_count, received_bytes, completed_parts, last_activity_at, failure_reason, started_at,
  completed_at`;

const toRecord = (r: Row): UploadSessionRecord => ({
  id: r.id,
  bookingId: r.booking_id,
  photographerId: r.photographer_id,
  origin: r.origin,
  status: r.status,
  declaredFileCount: r.declared_file_count,
  declaredBytes: Number(r.declared_bytes),
  receivedFileCount: r.received_file_count,
  receivedBytes: Number(r.received_bytes),
  doc: r.completed_parts,
  lastActivityAt: r.last_activity_at,
  failureReason: r.failure_reason,
  startedAt: r.started_at,
  completedAt: r.completed_at,
});

/** Sessions a booking can have at most one of at a time (ADR-0014 D2). */
const ACTIVE: readonly UploadSessionStatus[] = ['OPEN', 'UPLOADING'];

export interface NewUploadSession {
  readonly bookingId: string;
  readonly photographerId: string;
  readonly declaredFileCount: number;
  readonly declaredBytes: number;
  readonly doc: SessionDoc;
  readonly now: Date;
}

/**
 * upload_sessions — owned by media. The resumability document is updated with single-statement
 * jsonb_set UPDATEs: Postgres re-evaluates them against the latest row version under the row lock, so
 * four concurrent part PUTs never lose each other's writes.
 */
@Injectable()
export class UploadSessionsRepository {
  async insert(tx: Tx, s: NewUploadSession): Promise<UploadSessionRecord> {
    const [row] = await tx<Row[]>`
      INSERT INTO upload_sessions (booking_id, photographer_id, origin, status, declared_file_count,
                                   declared_bytes, completed_parts, last_activity_at, started_at)
      VALUES (${s.bookingId}, ${s.photographerId}, 'WEB_PORTAL', 'OPEN', ${s.declaredFileCount},
              ${s.declaredBytes}, ${tx.json(s.doc as unknown as postgres.JSONValue)}, ${s.now}, ${s.now})
      RETURNING ${tx.unsafe(COLUMNS)}`;
    if (!row) throw new Error('upload_sessions.insert: no row returned');
    return toRecord(row);
  }

  async activeForBooking(db: Db, bookingId: string): Promise<UploadSessionRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM upload_sessions
      WHERE booking_id = ${bookingId} AND status IN ${db([...ACTIVE])}
      ORDER BY started_at DESC LIMIT 1`;
    return row ? toRecord(row) : null;
  }

  async activeForBookings(db: Db, bookingIds: readonly string[]): Promise<UploadSessionRecord[]> {
    if (bookingIds.length === 0) return [];
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM upload_sessions
      WHERE booking_id IN ${db([...bookingIds])} AND status IN ${db([...ACTIVE])}`;
    return rows.map(toRecord);
  }

  /** null for a missing session AND for someone else's. */
  async findForPhotographer(
    db: Db,
    sessionId: string,
    photographerId: string,
  ): Promise<UploadSessionRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM upload_sessions
      WHERE id = ${sessionId} AND photographer_id = ${photographerId}`;
    return row ? toRecord(row) : null;
  }

  async lockForPhotographer(
    tx: Tx,
    sessionId: string,
    photographerId: string,
  ): Promise<UploadSessionRecord | null> {
    const [row] = await tx<Row[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM upload_sessions
      WHERE id = ${sessionId} AND photographer_id = ${photographerId} FOR UPDATE`;
    return row ? toRecord(row) : null;
  }

  /**
   * Records a stored part. Only while the session is open, the file is still PENDING and still on the
   * same storage session (a restarted file ignores a stale part). Returns false when nothing matched.
   */
  async recordPart(
    db: Db,
    p: {
      sessionId: string;
      fileId: string;
      storageSessionId: string;
      partNumber: number;
      sha256: string;
      now: Date;
    },
  ): Promise<boolean> {
    const rows = await db`
      UPDATE upload_sessions
      SET completed_parts = jsonb_set(completed_parts,
            ${db.array(['files', p.fileId, 'parts', String(p.partNumber)])}::text[],
            to_jsonb(${p.sha256}::text)),
          status = CASE WHEN status = 'OPEN' THEN 'UPLOADING'::upload_session_status ELSE status END,
          last_activity_at = ${p.now}
      WHERE id = ${p.sessionId} AND status IN ('OPEN', 'UPLOADING')
        AND completed_parts->'files'->${p.fileId}::text->>'status' = 'PENDING'
        AND completed_parts->'files'->${p.fileId}::text->>'storageSessionId' = ${p.storageSessionId}
      RETURNING id`;
    return rows.length > 0;
  }

  /** Forgets parts the storage adapter no longer has (resume state must stay honest). */
  async forgetParts(db: Db, sessionId: string, fileId: string, parts: readonly number[]) {
    for (const n of parts) {
      await db`
        UPDATE upload_sessions
        SET completed_parts = completed_parts #- ${db.array(['files', fileId, 'parts', String(n)])}::text[]
        WHERE id = ${sessionId}`;
    }
  }

  /** Bytes the open sessions have declared but not yet delivered (the capacity reservation, M5). */
  async outstandingBytes(db: Db): Promise<number> {
    const [row] = await db<{ n: string }[]>`
      SELECT coalesce(sum(greatest(declared_bytes - received_bytes, 0)), 0)::text AS n
      FROM upload_sessions WHERE status IN ('OPEN', 'UPLOADING')`;
    return Number(row?.n ?? 0);
  }

  /** Open sessions with no activity since `before`, longest idle first (the reaper, M5). */
  async idleOpen(db: Db, before: Date, limit: number): Promise<UploadSessionRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM upload_sessions
      WHERE status IN ('OPEN', 'UPLOADING') AND last_activity_at < ${before}
      ORDER BY last_activity_at, id
      LIMIT ${limit}`;
    return rows.map(toRecord);
  }

  /** A checksum mismatch: the file starts again on a new storage session with no parts. */
  async restartFile(
    db: Db,
    p: {
      sessionId: string;
      fileId: string;
      oldStorageSessionId: string;
      newStorageSessionId: string;
      now: Date;
    },
  ): Promise<boolean> {
    const rows = await db`
      UPDATE upload_sessions
      SET completed_parts = jsonb_set(completed_parts, ${db.array(['files', p.fileId])}::text[],
            (completed_parts->'files'->${p.fileId}::text)
              || jsonb_build_object('parts', '{}'::jsonb, 'storageSessionId', ${p.newStorageSessionId}::text)),
          last_activity_at = ${p.now}
      WHERE id = ${p.sessionId} AND status IN ('OPEN', 'UPLOADING')
        AND completed_parts->'files'->${p.fileId}::text->>'status' = 'PENDING'
        AND completed_parts->'files'->${p.fileId}::text->>'storageSessionId' = ${p.oldStorageSessionId}
      RETURNING id`;
    return rows.length > 0;
  }

  async markFileVerified(
    tx: Tx,
    p: {
      sessionId: string;
      fileId: string;
      sha256: string;
      assetId: string;
      sizeBytes: number;
      now: Date;
    },
  ): Promise<void> {
    await tx`
      UPDATE upload_sessions
      SET completed_parts = jsonb_set(completed_parts, ${tx.array(['files', p.fileId])}::text[],
            (completed_parts->'files'->${p.fileId}::text)
              || jsonb_build_object('status', 'VERIFIED', 'sha256', ${p.sha256}::text,
                                    'assetId', ${p.assetId}::text)),
          received_file_count = received_file_count + 1,
          received_bytes = received_bytes + ${p.sizeBytes},
          status = CASE WHEN status = 'OPEN' THEN 'UPLOADING'::upload_session_status ELSE status END,
          last_activity_at = ${p.now}
      WHERE id = ${p.sessionId}`;
  }

  async finish(
    tx: Tx,
    sessionId: string,
    status: 'COMPLETED' | 'FAILED' | 'ABORTED',
    reason: string | null,
    now: Date,
  ): Promise<void> {
    await tx`
      UPDATE upload_sessions
      SET status = ${status}, failure_reason = ${reason}, last_activity_at = ${now},
          completed_at = ${status === 'COMPLETED' ? now : null}
      WHERE id = ${sessionId}`;
  }

  /** Σ declared files over COMPLETED sessions (the integrity audit's expectation). */
  async declaredCompleted(db: Db, bookingId: string): Promise<number> {
    const [row] = await db<{ n: string | null }[]>`
      SELECT sum(declared_file_count) AS n FROM upload_sessions
      WHERE booking_id = ${bookingId} AND status = 'COMPLETED'`;
    return Number(row?.n ?? 0);
  }

  /** Bookings with a completed session and media still stored — what the weekly audit walks. */
  async bookingsToAudit(db: Db, limit: number): Promise<string[]> {
    const rows = await db<{ booking_id: string }[]>`
      SELECT DISTINCT s.booking_id FROM upload_sessions s
      WHERE s.status = 'COMPLETED'
        AND EXISTS (SELECT 1 FROM media_assets a WHERE a.booking_id = s.booking_id AND a.purged_at IS NULL)
      LIMIT ${limit}`;
    return rows.map((r) => r.booking_id);
  }
}
