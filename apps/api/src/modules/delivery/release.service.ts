import { randomBytes } from 'node:crypto';
import type { DeliveryLinkKind } from '@clickco/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { STORAGE_PORT, type StoragePort } from '../../infra/storage/storage.port';
import { BookingsService } from '../bookings/bookings.service';
import { SYSTEM_ACTOR } from '../bookings/bookings.types';
import { MediaRetentionService } from '../media/media-retention.service';
import { SLA_CONFIG } from '../sla/sla.config';
import { DELIVERY_CONFIG, STORAGE_KIND_OF } from './delivery.config';
import type { DeliveryRecord } from './delivery.types';
import { balanceDue } from './delivery-views';
import { DeliveriesRepository } from './repositories/deliveries.repository';
import { DeliveryLinksRepository } from './repositories/delivery-links.repository';

export type ReleaseOutcome = 'RELEASED' | 'ALREADY_RELEASED' | 'NOT_READY';

interface CreatedLink {
  readonly kind: DeliveryLinkKind;
  readonly url: string;
  readonly linkId: string;
  readonly expiresAt: Date;
}

const kindsIn = (d: DeliveryRecord): DeliveryLinkKind[] => [
  ...(d.jpeg.files > 0 ? (['JPEG_PHOTO'] as const) : []),
  ...(d.raw.files > 0 ? (['RAW_PHOTO'] as const) : []),
  ...(d.video.files > 0 ? (['VIDEO'] as const) : []),
];

/**
 * BALANCE_PENDING → DELIVERED (ADR-0016 D5): Clickco issues the links (Invariant 10) once
 * everything charged is paid (Invariant 9). Driven by the outbox, so a crash is retried; links
 * already on record are reused. Provider calls happen outside the transaction.
 */
@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name);

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(MediaRetentionService) private readonly media: MediaRetentionService,
    @Inject(DeliveriesRepository) private readonly deliveries: DeliveriesRepository,
    @Inject(DeliveryLinksRepository) private readonly links: DeliveryLinksRepository,
  ) {}

  async release(bookingId: string): Promise<ReleaseOutcome> {
    const facts = await this.bookings.deliveryFacts(this.sql, bookingId);
    if (facts.deliveredAt) return 'ALREADY_RELEASED';
    if (facts.status !== 'BALANCE_PENDING' || balanceDue(facts) > 0n) return 'NOT_READY';
    const delivery = await this.deliveries.find(this.sql, bookingId);
    if (delivery?.qaStatus !== 'PASSED') return 'NOT_READY';

    const now = this.clock();
    const rawExpiresAt = new Date(now.getTime() + SLA_CONFIG.rawRetentionMs);
    const jpegExpiresAt = new Date(now.getTime() + SLA_CONFIG.jpegRetentionMs);
    const existing = await this.links.forBooking(this.sql, bookingId);
    const created: CreatedLink[] = [];
    for (const kind of kindsIn(delivery)) {
      if (existing.some((l) => l.kind === kind)) continue;
      const expiresAt = kind === 'RAW_PHOTO' ? rawExpiresAt : jpegExpiresAt;
      const link = await this.storage.createDeliveryLink(
        bookingId,
        STORAGE_KIND_OF[kind],
        expiresAt,
      );
      created.push({ kind, url: link.url, linkId: link.linkId, expiresAt });
    }

    const outcome = await this.sql.begin(async (tx) => {
      const booking = await this.bookings.lock(tx, bookingId);
      if (booking.status !== 'BALANCE_PENDING' || balanceDue(booking) > 0n) return 'NOT_READY';
      const linkIds = existing.map((l) => l.id);
      for (const c of created) {
        linkIds.push(
          await this.links.insert(tx, {
            deliveryId: delivery.id,
            bookingId,
            kind: c.kind,
            publicToken: randomBytes(DELIVERY_CONFIG.tokenBytes).toString('base64url'),
            providerLink: c.url,
            providerLinkId: c.linkId,
            expiresAt: c.expiresAt,
          }),
        );
      }
      await this.deliveries.markReleased(tx, delivery.id, now, rawExpiresAt, jpegExpiresAt);
      await this.media.schedulePurge(tx, bookingId, rawExpiresAt, jpegExpiresAt);
      await this.bookings.recordDelivered(tx, bookingId, now);
      await this.bookings.transition(tx, {
        bookingId,
        to: 'DELIVERED',
        actor: SYSTEM_ACTOR,
        occurredAt: now,
        reason: 'Balance cleared: delivery links issued',
        payload: {
          delivery_id: delivery.id,
          raw_expires_at: rawExpiresAt.toISOString(),
          jpeg_expires_at: jpegExpiresAt.toISOString(),
          link_ids: linkIds,
        },
      });
      return 'RELEASED';
    });
    if (outcome !== 'RELEASED') await this.revokeQuietly(created.map((c) => c.linkId));
    return outcome;
  }

  /** Links made for a release that lost a race: never left live at the provider. */
  private async revokeQuietly(linkIds: readonly string[]): Promise<void> {
    for (const id of linkIds) {
      await this.storage
        .revokeDeliveryLink(id)
        .catch((error: unknown) =>
          this.logger.warn(`Could not revoke link ${id}: ${String(error)}`),
        );
    }
  }
}
