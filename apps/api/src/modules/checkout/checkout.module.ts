import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { DevPaymentsController } from './dev-payments.controller';
import { PaymentFlowService } from './payment-flow.service';
import { PaymentWebhooksController } from './payment-webhooks.controller';

/** Orchestrates pricing → bookings → payments and owns their HTTP surface. Nothing imports it. */
@Module({
  imports: [
    TokenModule,
    IdempotencyModule,
    ServiceabilityModule,
    PricingModule,
    BookingsModule,
    PaymentsModule,
  ],
  controllers: [CheckoutController, PaymentWebhooksController, DevPaymentsController],
  providers: [CheckoutService, PaymentFlowService],
})
export class CheckoutModule {}
