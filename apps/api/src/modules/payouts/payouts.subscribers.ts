import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxSubscribers } from '../../infra/outbox/outbox-subscribers';
import { PayoutsService } from './payouts.service';

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * The events that leave a photographer owed (ADR-0026 D3, ADR-0027 D5, a client's late
 * cancellation — CLIENT_CANCELLATION_PAYOUT). Every handler is
 * idempotent: one payout per booking and photographer, whatever the redelivery.
 */
@Injectable()
export class PayoutsSubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(PayoutsService) private readonly payouts: PayoutsService,
  ) {}

  onModuleInit(): void {
    this.subscribers.subscribe('booking.delivered', 'payouts.accrue', async (e) => {
      await this.payouts.accrueForDelivery(e.aggregateId);
    });
    // Staff confirmed the files were lost before delivery (DOMAIN §2).
    this.subscribers.subscribe('booking.data_loss', 'payouts.accrue-data-loss', async (e) => {
      await this.payouts.accrueForOutcome(e.aggregateId, 'DATA_LOSS', e.occurredAt);
    });
    // Staff confirmed the venue refused access (ADR-0013 D10, T&C §7.2).
    this.subscribers.subscribe(
      'booking.access_denied',
      'payouts.accrue-access-denied',
      async (e) => {
        await this.payouts.accrueForOutcome(e.aggregateId, 'ACCESS_DENIED', e.occurredAt);
      },
    );
    // The client cancelled after a photographer accepted (T&C §3): their share of what was kept.
    // Only the client's own cancellation; the figures are read from the recorded cancellation,
    // never from this payload (security review L2).
    this.subscribers.subscribe(
      'booking.cancelled_client',
      'payouts.accrue-client-cancelled',
      async (e) => {
        if (e.payload.reason !== 'CLIENT_CANCELLED' || !str(e.payload.photographer_id)) return;
        await this.payouts.accrueForClientCancellation(e.aggregateId);
      },
    );
    // The client did not attend (T&C §3.8): the photographer's report is paid once staff have
    // settled its CLIENT_NON_ATTENDANCE review (refunds module, ADR-0026 D2).
    this.subscribers.subscribe('review.settled', 'payouts.accrue-client-absent', async (e) => {
      const bookingId = e.payload.booking_id;
      if (e.payload.reason !== 'CLIENT_NON_ATTENDANCE' || typeof bookingId !== 'string') return;
      await this.payouts.accrueForClientAbsence(bookingId);
    });
  }
}
