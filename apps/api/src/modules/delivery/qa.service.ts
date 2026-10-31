import type { DeliveryView, QaResult } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import type { Actor } from '../bookings/bookings.types';
import { MediaRetentionService } from '../media/media-retention.service';
import { balanceDue, toDeliveryView } from './delivery-views';
import { conflict } from './http-errors';
import { DeliveryLinkTokens } from './link-tokens';
import { DeliveriesRepository } from './repositories/deliveries.repository';
import { DeliveryLinksRepository } from './repositories/delivery-links.repository';

/**
 * The QA gate (ADR-0016 D1): pass → deliveries row + QA → BALANCE_PENDING; fail → recorded and
 * alerted, the booking stays in QA. STAFF from the admin QA desk (ADR-0025, with the staff id in
 * deliveries.qa_by); SYSTEM from the dev console. `audit` runs inside the decision's transaction.
 */
@Injectable()
export class QaService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(MediaRetentionService) private readonly media: MediaRetentionService,
    @Inject(DeliveriesRepository) private readonly deliveries: DeliveriesRepository,
    @Inject(DeliveryLinksRepository) private readonly links: DeliveryLinksRepository,
    @Inject(DeliveryLinkTokens) private readonly tokens: DeliveryLinkTokens,
  ) {}

  async decide(
    bookingId: string,
    result: QaResult,
    note: string | null,
    actor: Actor,
    audit?: TxHook,
  ): Promise<DeliveryView> {
    const inventory = await this.media.inventory(bookingId);
    const now = this.clock();
    await this.sql.begin(async (tx) => {
      const booking = await this.bookings.lock(tx, bookingId);
      if (booking.status !== 'QA') {
        throw conflict(
          'WRONG_STAGE',
          `QA cannot be decided while the booking is ${booking.status}`,
        );
      }
      const total = inventory.raw.files + inventory.jpeg.files + inventory.video.files;
      if (result === 'PASS' && total === 0) {
        throw conflict('NOTHING_TO_DELIVER', 'This booking has no verified files to deliver');
      }
      const previous = await this.deliveries.find(tx, bookingId);
      const delivery = await this.deliveries.recordQa(tx, {
        bookingId,
        ...inventory,
        status: result === 'PASS' ? 'PASSED' : 'FAILED',
        note,
        at: now,
        by: actor.kind === 'STAFF' ? actor.id : null,
      });
      await audit?.(tx, {
        before: { status: booking.status, qa_status: previous?.qaStatus ?? null },
        after: {
          status: result === 'PASS' ? 'BALANCE_PENDING' : 'QA',
          qa_status: delivery.qaStatus,
          note,
          files: total,
        },
      });
      if (result === 'FAIL') {
        await appendDomainEvent(tx, {
          eventType: 'delivery.qa_failed',
          aggregateKind: 'booking',
          aggregateId: bookingId,
          occurredAt: now,
          payload: { booking_id: bookingId, delivery_id: delivery.id, note },
        });
        return;
      }
      await this.bookings.transition(tx, {
        bookingId,
        to: 'BALANCE_PENDING',
        actor,
        occurredAt: now,
        reason: 'QA passed',
        payload: {
          delivery_id: delivery.id,
          raw_files: inventory.raw.files,
          jpeg_files: inventory.jpeg.files,
          video_files: inventory.video.files,
          balance_due_paise: fromPaiseBigint(balanceDue(booking)),
        },
      });
    });
    return this.view(bookingId);
  }

  async view(bookingId: string): Promise<DeliveryView> {
    const [facts, delivery, links] = await Promise.all([
      this.bookings.deliveryFacts(this.sql, bookingId),
      this.deliveries.find(this.sql, bookingId),
      this.links.forBooking(this.sql, bookingId),
    ]);
    return toDeliveryView(facts, delivery, links, (l) =>
      this.tokens.tokenIfCurrent(l.id, l.tokenSha256),
    );
  }
}
