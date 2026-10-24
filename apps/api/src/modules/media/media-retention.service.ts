import type { AssetKind } from '@clickco/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { STORAGE_PORT, type StoragePort } from '../../infra/storage/storage.port';
import type { DeliveryInventory, Tx } from './media.types';
import { MediaAssetsRepository } from './repositories/media-assets.repository';

/**
 * What delivery asks of media (ADR-0016): the inventory a delivery holds, the purge schedule from
 * delivery (Invariant 7), and the permanent purge itself (Invariant 6). media_assets stays owned
 * here; bytes only move through StoragePort.
 */
@Injectable()
export class MediaRetentionService {
  private readonly logger = new Logger(MediaRetentionService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(MediaAssetsRepository) private readonly assets: MediaAssetsRepository,
  ) {}

  inventory(bookingId: string): Promise<DeliveryInventory> {
    return this.assets.inventory(this.sql, bookingId);
  }

  /** In the caller's release transaction. */
  async schedulePurge(tx: Tx, bookingId: string, rawAt: Date, jpegAt: Date): Promise<void> {
    await this.assets.schedulePurge(tx, bookingId, rawAt, jpegAt);
  }

  /**
   * Permanently deletes the booking's files of these kinds (all kinds when empty), then marks
   * them purged. Delete first: a failure leaves them unmarked, and the retry deletes again (the
   * port ignores ids already gone). Returns how many were purged.
   */
  async purge(bookingId: string, kinds: readonly AssetKind[]): Promise<number> {
    const doomed = await this.assets.unpurgedOfKinds(this.sql, bookingId, kinds);
    if (doomed.length === 0) return 0;
    await this.storage.permanentlyDelete(doomed.map((a) => a.storageObjectId));
    const now = this.clock();
    await this.sql.begin((tx) =>
      this.assets.markPurged(
        tx,
        doomed.map((a) => a.id),
        now,
      ),
    );
    this.logger.log(`Purged ${doomed.length} file(s) of booking ${bookingId}`);
    return doomed.length;
  }
}
