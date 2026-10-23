import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { TokenModule } from '../auth/token.module';
import { BookingsModule } from '../bookings/bookings.module';
import { OnsiteModule } from '../onsite/onsite.module';
import { PaymentsModule } from '../payments/payments.module';
import { PricingModule } from '../pricing/pricing.module';
import { ServiceabilityModule } from '../serviceability/serviceability.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { PaymentFlowService } from './payment-flow.service';
import { PaymentWebhooksController } from './payment-webhooks.controller';

/**
 * Orchestrates pricing → bookings → payments and owns their HTTP surface. Only DevToolsModule
 * imports it (the development payment simulator drives PaymentFlowService).
 */
@Module({
  imports: [
    TokenModule,
    IdempotencyModule,
    ServiceabilityModule,
    PricingModule,
    BookingsModule,
    PaymentsModule,
    OnsiteModule,
  ],
  controllers: [CheckoutController, PaymentWebhooksController],
  providers: [CheckoutService, PaymentFlowService],
  exports: [PaymentFlowService],
})
export class CheckoutModule {}
