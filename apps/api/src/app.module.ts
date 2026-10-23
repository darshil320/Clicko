import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CLOCK, systemClock } from './common/clock';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ENV, loadEnv } from './config/env';
import { devOnlyModules } from './dev/dev-tools.module';
import { HealthModule } from './health/health.module';
import { DbModule } from './infra/db/db.module';
import { OutboxModule } from './infra/outbox/outbox.module';
import { QueuesModule } from './infra/queues/queues.module';
import { JobsModule } from './jobs/jobs.module';
import { AuthModule } from './modules/auth/auth.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { OpsModule } from './modules/ops/ops.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { ServiceabilityModule } from './modules/serviceability/serviceability.module';
import { UsersModule } from './modules/users/users.module';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv(process.env) },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [ENV, CLOCK],
})
class CoreModule {}

@Module({
  imports: [
    CoreModule,
    // Per-IP backstop for every route (in-memory: fine for one instance; move to Redis storage
    // before scaling out). OTP and waitlist have their own per-phone limits on top.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    DbModule,
    QueuesModule,
    OutboxModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ServiceabilityModule,
    PricingModule,
    CheckoutModule,
    DispatchModule,
    OpsModule,
    JobsModule,
    ...devOnlyModules(process.env.NODE_ENV),
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
