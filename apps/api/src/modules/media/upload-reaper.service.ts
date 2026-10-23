import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { STORAGE_PORT, type StoragePort } from '../../infra/storage/storage.port';
import { MEDIA_CONFIG } from './media.config';
import type { UploadSessionRecord } from './media.types';
import { appendMediaAlert } from './ops-alert';
import { UploadSessionsRepository } from './repositories/upload-sessions.repository';
import { stagedFiles } from './session-doc';
import { storageSessionInput } from './storage-files';
import { UploadBookings } from './upload-bookings';

export interface ReapResult {
  readonly sessions: number;
  readonly files: number;
}

/**
 * Security review M5: staged parts of an upload session nobody has touched for 24 h are dropped
 * (each such file restarts on a fresh storage session; verified files are never touched) and ops
 * is told. The session stays open: the photographer can still resume — the affected files start
 * over. Bytes only move through StoragePort.
 */
@Injectable()
export class UploadReaperService {
  private readonly logger = new Logger(UploadReaperService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(UploadBookings) private readonly bookings: UploadBookings,
    @Inject(UploadSessionsRepository) private readonly sessions: UploadSessionsRepository,
  ) {}

  async sweep(): Promise<ReapResult> {
    const now = this.clock();
    const before = new Date(now.getTime() - MEDIA_CONFIG.idleSessionReclaimHours * 3_600_000);
    const idle = await this.sessions.idleOpen(this.sql, before, MEDIA_CONFIG.reaperBatch);
    let sessions = 0;
    let files = 0;
    for (const session of idle) {
      const reclaimed = await this.reclaim(session, now);
      if (reclaimed === 0) continue;
      sessions += 1;
      files += reclaimed;
    }
    return { sessions, files };
  }

  private async reclaim(session: UploadSessionRecord, now: Date): Promise<number> {
    const staged = stagedFiles(session.doc);
    if (staged.length === 0) return 0;
    const booking = await this.bookings.one(session.bookingId);
    if (!booking) return 0;
    let reclaimed = 0;
    for (const [fileId, file] of staged) {
      const handle = await this.storage.createUploadSession(
        storageSessionInput(booking, file, session.doc.partSizeBytes),
      );
      const restarted = await this.sessions.restartFile(this.sql, {
        sessionId: session.id,
        fileId,
        oldStorageSessionId: file.storageSessionId,
        newStorageSessionId: handle.sessionId,
        now,
      });
      // The loser of a race with a live upload (or the old session) is the one aborted.
      await this.abortQuietly(restarted ? file.storageSessionId : handle.sessionId);
      if (restarted) reclaimed += 1;
    }
    if (reclaimed > 0) {
      await this.sql.begin((tx) =>
        appendMediaAlert(tx, {
          aggregateKind: 'booking',
          aggregateId: session.bookingId,
          severity: 'MEDIUM',
          sourceEventType: 'media.upload_session_idle',
          dedupeKey: `upload-idle:${session.id}:${now.toISOString().slice(0, 10)}`,
          details: {
            upload_session_id: session.id,
            photographer_id: session.photographerId,
            last_activity_at: session.lastActivityAt.toISOString(),
            files_restarted: reclaimed,
          },
          occurredAt: now,
        }),
      );
    }
    return reclaimed;
  }

  private async abortQuietly(storageSessionId: string): Promise<void> {
    await this.storage
      .abortUpload(storageSessionId)
      .catch((error: unknown) =>
        this.logger.warn(`Could not abort storage session ${storageSessionId}: ${String(error)}`),
      );
  }
}
