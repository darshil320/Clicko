import { Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module';
import { DevOtpController } from '../modules/auth/dev-otp.controller';
import { CheckoutModule } from '../modules/checkout/checkout.module';
import { DevPaymentsController } from '../modules/checkout/dev-payments.controller';
import { DeliveryModule } from '../modules/delivery/delivery.module';
import { DevDeliveryController } from '../modules/delivery/dev-delivery.controller';
import { DevDispatchController } from '../modules/dispatch/dev-dispatch.controller';
import { DispatchModule } from '../modules/dispatch/dispatch.module';
import { DevOnsiteController } from '../modules/onsite/dev-onsite.controller';
import { OnsiteModule } from '../modules/onsite/onsite.module';
import { PaymentsModule } from '../modules/payments/payments.module';
import { DevSlaController } from '../modules/sla/dev-sla.controller';
import { SlaModule } from '../modules/sla/sla.module';

/**
 * Development-only HTTP surface for the ops console: OTP peek, payment simulator, dispatch desk,
 * on-site assignment view and incident confirmation (ADR-0013), the QA decision and the SLA
 * timeline (ADR-0016).
 * AppModule mounts it only when NODE_ENV=development (ADR-0012), so in test, staging and
 * production these routes do not exist at all; each controller also re-checks NODE_ENV.
 */
@Module({
  imports: [
    AuthModule,
    PaymentsModule,
    CheckoutModule,
    DispatchModule,
    OnsiteModule,
    DeliveryModule,
    SlaModule,
  ],
  controllers: [
    DevOtpController,
    DevPaymentsController,
    DevDispatchController,
    DevOnsiteController,
    DevDeliveryController,
    DevSlaController,
  ],
})
export class DevToolsModule {}

/** Read at module definition: main.ts loads .env before AppModule is imported. */
export const devOnlyModules = (nodeEnv: string | undefined) =>
  nodeEnv === 'development' ? [DevToolsModule] : [];
