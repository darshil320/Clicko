import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { STORAGE_PORT, type StoragePort } from '../../infra/storage/storage.port';
import { MEDIA_CONFIG } from './media.config';
import { MediaRetentionService } from './media-retention.service';
import { UploadSessionsRepository } from './repositories/upload-sessions.repository';
import { UploadBookings } from './upload-bookings';

export type DataLossPurgeResult =
  | { readonly kind: 'NOT_LOST'; readonly status: string | null }
  | {
      readonly kind: 'PURGED';
      readonly sessionsClosed: number;
      readonly stagedSessions: number;
      readonly files: number;
      /** Objects the provider still held for the booking without a media_assets row. */
      readonly orphans: number;
    };

const SESSION_REASON = 'The shoot was recorded as lost; nothing more is kept';

/**
 * ADR-0030 follow-up: a lost shoot (DATA_LOSS, staff-confirmed) keeps no files. Its retention
 * clocks are cancelled, so nothing else would ever purge them. Runs as a BullMQ job
 * (`media.data-loss-purge`, src/jobs/), once per booking, and is safe to run again:
 *  1. every open upload session is closed (a part or file still arriving is refused, and a file
 *     verified in flight drops its own copy);
 *  2. every staged part is dropped (its storage session aborted; aborting a gone one is a no-op);
 *  3. every stored file of the booking — RAW and JPEG originals, exports, video — is permanently
 *     deleted, then marked purged; passes repeat until one finds nothing, since an export that was
 *     writing when the loss was confirmed can land one more file (lockDerivation refuses it after);
 *  4. whatever the provider still lists for the booking (an object stored before a crash wrote its
 *     row, or a surplus copy whose delete failed) is deleted too — that booking's objects only.
 * Bytes move only through StoragePort (Invariants 24, 25); a provider's own limits (Drive's
 * queue) live in its adapter. Only a booking that IS lost is purged: a stray job does nothing.
 */
@Injectable()
export class DataLossPurgeService {
  private readonly logger = new Logger(DataLossPurgeService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(UploadBookings) private readonly bookings: UploadBookings,
    @Inject(UploadSessionsRepository) private readonly sessions: UploadSessionsRepository,
    @Inject(MediaRetentionService) private readonly retention: MediaRetentionService,
  ) {}

  async purge(bookingId: string): Promise<DataLossPurgeResult> {
    const booking = await this.bookings.one(bookingId);
    if (booking?.status !== 'DATA_LOSS') {
      return { kind: 'NOT_LOST', status: booking?.status ?? null };
    }
    const now = this.clock();
    const sessionsClosed = await this.sql.begin((tx) =>
      this.sessions.abortOpenForBooking(tx, bookingId, SESSION_REASON, now),
    );
    const staged = await this.sessions.pendingStorageSessions(this.sql, bookingId);
    for (const storageSessionId of staged) await this.storage.abortUpload(storageSessionId);
    let files = 0;
    for (let pass = 0; pass < MEDIA_CONFIG.dataLossPurgePasses; pass += 1) {
      const purged = await this.retention.purge(bookingId, []);
      files += purged;
      if (purged === 0) {
        const orphans = await this.purgeOrphans(bookingId);
        this.logger.log(
          `Lost booking ${bookingId}: ${files} file(s) and ${orphans} orphan(s) purged, ${staged.length} staged upload(s) dropped`,
        );
        return { kind: 'PURGED', sessionsClosed, stagedSessions: staged.length, files, orphans };
      }
    }
    // Throws so BullMQ retries; the last failure reaches ops (job-failure).
    throw new Error(`Lost booking ${bookingId}: files still appearing after every purge pass`);
  }

  /** Permanent delete of every object still listed under this booking (and only this booking). */
  private async purgeOrphans(bookingId: string): Promise<number> {
    const left = (await this.storage.listObjects(bookingId)).filter(
      (o) => o.bookingId === bookingId,
    );
    if (left.length > 0) await this.storage.permanentlyDelete(left.map((o) => o.objectId));
    return left.length;
  }
}
