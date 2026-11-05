import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { RefundsModule } from '../refunds/refunds.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { CancellationsController } from './cancellations.controller';
import { CancellationsService } from './cancellations.service';

/**
 * Client cancellation (DOMAIN §2, T&C §3). Owns no tables: it orchestrates bookings, dispatch,
 * refunds, payments (holds) and pricing (Peak Season) through their exported services. The
 * follow-ups subscribe to `booking.cancelled_client` in their own modules: payments (hold
 * release), payouts (the photographer's share), dispatch, calls, SLA and notifications.
 */
@Module({
  imports: [
    TokenModule,
    IdempotencyModule,
    BookingsModule,
    DispatchModule,
    PaymentsModule,
    PricingModule,
    RefundsModule,
    ServiceabilityModule,
  ],
  controllers: [CancellationsController],
  providers: [CancellationsService],
})
export class CancellationsModule {}
