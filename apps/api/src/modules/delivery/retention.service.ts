import type { AssetKind, DeliveryLinkKind, SlaKind } from '@clickco/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { StorageNotFoundError } from '../../infra/storage/storage.errors';
import { STORAGE_PORT, type StoragePort } from '../../infra/storage/storage.port';
import { BookingsService } from '../bookings/bookings.service';
import { SYSTEM_ACTOR } from '../bookings/bookings.types';
import { MediaRetentionService } from '../media/media-retention.service';
import { DeliveryLinksRepository } from './repositories/delivery-links.repository';

const PURGED_BY: Partial<Record<SlaKind, readonly AssetKind[]>> = {
  RAW_PURGE: ['RAW_PHOTO'],
  JPEG_PURGE: ['JPEG_PHOTO', 'VIDEO'],
};

/**
 * ADR-0016 D8/D10: what a retention clock does when it is due. The file purge is permanent
 * (Invariant 6); a purged kind's link is revoked with it; LINK_REVOKE revokes the rest and closes
 * the booking. ABANDONED purges everything. All idempotent (outbox at-least-once).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(MediaRetentionService) private readonly media: MediaRetentionService,
    @Inject(DeliveryLinksRepository) private readonly links: DeliveryLinksRepository,
  ) {}

  async due(bookingId: string, kind: SlaKind): Promise<void> {
    const kinds = PURGED_BY[kind];
    if (kinds) {
      await this.media.purge(bookingId, kinds);
      await this.revokeLinks(bookingId, kinds as readonly DeliveryLinkKind[]);
      return;
    }
    if (kind !== 'LINK_REVOKE') return;
    await this.revokeLinks(bookingId, null);
    await this.close(bookingId);
  }

  /** T&C §2.3: an abandoned booking keeps nothing. */
  async abandoned(bookingId: string): Promise<void> {
    await this.media.purge(bookingId, []);
    await this.revokeLinks(bookingId, null);
  }

  private async revokeLinks(bookingId: string, kinds: readonly DeliveryLinkKind[] | null) {
    const now = this.clock();
    for (const link of await this.links.forBooking(this.sql, bookingId)) {
      if (link.revokedAt || (kinds && !kinds.includes(link.kind))) continue;
      if (link.providerLinkId) {
        await this.storage.revokeDeliveryLink(link.providerLinkId).catch((error: unknown) => {
          if (!(error instanceof StorageNotFoundError)) throw error;
        });
      }
      await this.links.markRevoked(this.sql, link.id, now);
    }
  }

  /** DELIVERED → CLOSED at +30 d (DOMAIN §2). An open escalation closes through its own path. */
  private async close(bookingId: string): Promise<void> {
    const now = this.clock();
    await this.sql.begin(async (tx) => {
      const booking = await this.bookings.lock(tx, bookingId);
      if (booking.status !== 'DELIVERED') return;
      await this.bookings.recordClosed(tx, bookingId, now);
      await this.bookings.transition(tx, {
        bookingId,
        to: 'CLOSED',
        actor: SYSTEM_ACTOR,
        occurredAt: now,
        reason: 'Retention period over: links revoked, files purged',
        payload: {},
      });
    });
    this.logger.log(`Booking ${bookingId} closed`);
  }
}
